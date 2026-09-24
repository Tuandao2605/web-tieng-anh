import { redisClient } from "../utils/redis";
import { cacheService } from "./cache.service";
import { hasErrorCode, UpdatedError } from "../errors/app.error";
import type { Card } from "../generated/prisma/client";
import studyRepository, {
  CreateSetInput,
  UpdateSetInput,
} from "../repositories/study.repository";
import type { CreateCardInput } from "../repositories/card.repository";
import userProgressRepository from "../repositories/user-progress.repository";
import { elasticsearchService } from "./elasticsearch.service";
import { enqueueDeckSync } from "../queues/search-index.queue";
import {
  QuizQuestion,
  SessionProgressState,
  BatchSubmitAnswersInput,
  SubmitAnswerInput,
} from "../types/study";
import { randomUUID } from "node:crypto";

const positiveNumberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const SESSION_LOCK_TTL_MS = positiveNumberFromEnv(
  process.env.STUDY_SESSION_LOCK_TTL_MS,
  10_000,
);
const SESSION_LOCK_WAIT_MS = positiveNumberFromEnv(
  process.env.STUDY_SESSION_LOCK_WAIT_MS,
  SESSION_LOCK_TTL_MS + 1_000,
);
const sleep = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const PUBLIC_SETS_VERSION_KEY = "cache:version:sets:public";
const userSetsVersionKey = (userId: string) =>
  `cache:version:sets:user:${userId}`;
const setDetailVersionKey = (setId: string) =>
  `cache:version:sets:detail:${setId}`;

// Redis executes this script atomically, so concurrent submissions on any Node
// instance cannot overwrite each other. A sync lock makes submissions retry
// instead of racing the Redis -> MongoDB handoff.
const UPDATE_STUDY_SESSION_SCRIPT = `
if redis.call("EXISTS", KEYS[2]) == 1 then
  return redis.error_reply("STUDY_SESSION_BUSY")
end

local raw_session = redis.call("GET", KEYS[1])
local session
if raw_session then
  session = cjson.decode(raw_session)
else
  session = {
    sessionId = ARGV[1],
    userId = ARGV[2],
    setId = ARGV[3],
    mode = ARGV[4],
    totalCards = 0,
    correctCount = 0,
    wrongCount = 0,
    cardProgressMap = {}
  }
end

session.setId = ARGV[3]
session.mode = ARGV[4]
if type(session.cardProgressMap) ~= "table" then
  session.cardProgressMap = {}
end

local answers = cjson.decode(ARGV[5])
local now_ms = tonumber(ARGV[6])
local day_ms = 86400000
local results = {}

for index, answer in ipairs(answers) do
  if answer.isCorrect then
    session.correctCount = (session.correctCount or 0) + 1
  else
    session.wrongCount = (session.wrongCount or 0) + 1
  end

  local previous = session.cardProgressMap[answer.cardId]
  if not previous then
    previous = {
      cardId = answer.cardId,
      streak = 0,
      correctCount = 0,
      wrongCount = 0,
      status = "NEW",
      nextReviewAt = now_ms,
      lastReviewedAt = now_ms
    }
  end

  if answer.isCorrect then
    previous.correctCount = (previous.correctCount or 0) + 1
    previous.streak = (previous.streak or 0) + 1
  else
    previous.wrongCount = (previous.wrongCount or 0) + 1
    previous.streak = 0
  end

  if previous.streak >= 2 then
    previous.status = "MASTERED"
    previous.nextReviewAt = now_ms + previous.streak * 3 * day_ms
  else
    previous.status = "LEARNING"
    previous.nextReviewAt = now_ms + previous.streak * day_ms
  end
  previous.lastReviewedAt = now_ms
  session.cardProgressMap[answer.cardId] = previous

  results[index] = {
    sessionId = ARGV[1],
    cardId = answer.cardId,
    isCorrect = answer.isCorrect,
    cardProgress = {
      cardId = previous.cardId,
      streak = previous.streak,
      correctCount = previous.correctCount,
      wrongCount = previous.wrongCount,
      status = previous.status,
      nextReviewAt = previous.nextReviewAt,
      lastReviewedAt = previous.lastReviewedAt
    },
    sessionSummary = {
      correctCount = session.correctCount,
      wrongCount = session.wrongCount
    }
  }
end

local total_cards = 0
for _ in pairs(session.cardProgressMap) do
  total_cards = total_cards + 1
end
session.totalCards = total_cards

redis.call("SET", KEYS[1], cjson.encode(session), "EX", ARGV[7])
return cjson.encode(results)
`;

// ─── Service ──────────────────────────────────────────────────────────────────

export class StudyService {
  private get redis() {
    return redisClient.getInstance();
  }

  private async invalidateSetCaches(
    userId: string,
    setId: string | undefined,
    affectsPublic: boolean,
  ) {
    const trackers = [
      cacheService.invalidateGetTracker(userSetsVersionKey(userId)),
    ];
    if (setId) {
      trackers.push(
        cacheService.invalidateGetTracker(setDetailVersionKey(setId)),
      );
    }
    if (affectsPublic) {
      trackers.push(cacheService.invalidateGetTracker(PUBLIC_SETS_VERSION_KEY));
    }
    await Promise.all(trackers);
  }

  private async scheduleDeckSync(deckId: string, mutationVersion: number) {
    try {
      await enqueueDeckSync(deckId, mutationVersion);
    } catch (error) {
      // The MongoDB write is already committed. Do not turn a temporary queue
      // outage into a misleading failed write response; the reindex command is
      // the operational recovery path for jobs that could not be enqueued.
      console.warn("Unable to enqueue Elasticsearch deck sync", error);
    }
  }

  /**
   * Serialize mutations for one study session across every Node instance.
   * The token-checked release cannot delete a lock that expired and was
   * acquired by another request; the TTL is the crash-safety fallback.
   */
  private async withSessionLock<T>(
    sessionKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockKey = `${sessionKey}:lock`;
    const lockToken = randomUUID();
    const deadline = Date.now() + SESSION_LOCK_WAIT_MS;

    while (Date.now() < deadline) {
      const acquired = await this.redis.set(lockKey, lockToken, {
        NX: true,
        PX: SESSION_LOCK_TTL_MS,
      });
      if (acquired) {
        try {
          return await operation();
        } finally {
          await this.redis
            .eval(
              `if redis.call("GET", KEYS[1]) == ARGV[1] then
                 return redis.call("DEL", KEYS[1])
               end
               return 0`,
              { keys: [lockKey], arguments: [lockToken] },
            )
            .catch((error: unknown) => {
              // The lock TTL prevents a permanent deadlock if Redis becomes
              // unavailable while the request is releasing its lock.
              console.warn("Unable to release study-session lock", error);
            });
        }
      }

      await sleep(15 + Math.floor(Math.random() * 20));
    }

    throw new UpdatedError("Study session is busy, please retry", 409);
  }

  // ── 1. List Sets ────────────────────────────────────────────────────────────

  async listSetsRaw(
    userId: string | undefined,
    cursor: string | undefined,
    limit: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const [publicVersion, userVersion] = await Promise.all([
      cacheService.getTracker(PUBLIC_SETS_VERSION_KEY),
      userId
        ? cacheService.getTracker(userSetsVersionKey(userId))
        : Promise.resolve("anonymous"),
    ]);
    const scope = userId ? `user:${userId}:v${userVersion}` : "public";
    const pageCursor = cursor ?? "first";
    const cacheKey = `sets:list:summary:v2:${scope}:public-v${publicVersion}:limit:${limit}:cursor:${pageCursor}`;

    return cacheService.getOrSetRawWithTag(
      cacheKey,
      () => studyRepository.listSets(userId, cursor, limit),
      [],
      300,
      (data) => ({
        obj: {
          success: true,
          data,
          message: "Flashcard sets retrieved successfully",
        },
      }),
      signal,
    );
  }

  async searchPublicDecks(
    keyword: string,
    page: number,
    limit: number,
    signal?: AbortSignal,
  ) {
    const normalizedKeyword = keyword.trim();
    let result;
    try {
      result = await elasticsearchService.searchPublicDecks(
        normalizedKeyword,
        page,
        limit,
        signal,
      );
    } catch (error) {
      // Client disconnect không phải lỗi Elasticsearch; không chạy thêm query
      // fallback khi kết quả không còn người nhận.
      signal?.throwIfAborted();
      if (process.env.ELASTICSEARCH_FALLBACK_TO_MONGO !== "true") {
        throw new UpdatedError(
          "Search service is temporarily unavailable",
          503,
          error,
        );
      }
      result = await studyRepository.searchPublicSets(
        normalizedKeyword,
        page,
        limit,
      );
    }
    return {
      decks: result.decks.map((deck) => ({
        id: deck.id,
        title: deck.title,
        description: deck.description,
        cardCount: deck.cardCount,
        author:
          "author" in deck
            ? deck.author
            : { id: deck.userId, name: deck.authorName },
        updatedAt: deck.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    };
  }

  // ── 2. Create Set ───────────────────────────────────────────────────────────

  async createSet(input: CreateSetInput) {
    const newSet = await studyRepository.createSet(input);
    await this.invalidateSetCaches(input.userId, undefined, newSet.isPublic);
    await this.scheduleDeckSync(newSet.id, newSet.updatedAt.getTime());
    return newSet;
  }

  // ── 3. Update Set ───────────────────────────────────────────────────────────

  async updateSet(setId: string, userId: string, input: UpdateSetInput) {
    const updateResult = await studyRepository
      .updateSet(setId, userId, input)
      .catch((error: unknown) => {
        if (hasErrorCode(error, "P2025"))
          throw new UpdatedError("Flashcard set not found", 404, error);
        throw new UpdatedError("Failed to update flashcard set", 500, error);
      });

    await this.invalidateSetCaches(
      userId,
      setId,
      updateResult.wasPublic || updateResult.set.isPublic,
    );
    await this.scheduleDeckSync(setId, updateResult.set.updatedAt.getTime());
    return updateResult.set;
  }

  // ── 4. Add Cards to Set ─────────────────────────────────────────────────────

  async deleteSet(setId: string, userId: string) {
    const deleted = await studyRepository
      .deleteSet(setId, userId)
      .catch((error: unknown) => {
        if (hasErrorCode(error, "P2025")) {
          throw new UpdatedError("Flashcard set not found", 404, error);
        }
        throw new UpdatedError("Failed to delete flashcard set", 500, error);
      });

    await this.invalidateSetCaches(userId, setId, deleted.isPublic);
    await this.scheduleDeckSync(
      setId,
      Math.max(Date.now(), deleted.updatedAt.getTime() + 1),
    );

    return { id: deleted.id };
  }

  async addCardsToSet(setId: string, userId: string, cards: CreateCardInput[]) {
    const updated = await studyRepository
      .addCardsToSet(setId, userId, cards)
      .catch((error: unknown) => {
        if (hasErrorCode(error, "P2025"))
          throw new UpdatedError("Flashcard set not found", 404, error);
        throw new UpdatedError("Failed to add cards", 500, error);
      });

    await this.invalidateSetCaches(userId, setId, updated.isPublic);
    await this.scheduleDeckSync(setId, updated.updatedAt.getTime());
    return updated;
  }

  // ── 5. Get Set by ID (Cache-Aside, TTL 1h) ──────────────────────────────────

  async getSetById(setId: string, userId?: string, signal?: AbortSignal) {
    const version = await cacheService.getTracker(setDetailVersionKey(setId));
    const set = await cacheService.getOrSetWithTag(
      `set:${setId}:v${version}:cards`,
      async () => {
        const set = await studyRepository.findSetById(setId);
        if (!set) throw new UpdatedError("Flashcard set not found", 404);
        return set;
      },
      [],
      3600,
      signal,
    );

    if (!set.isPublic && set.userId !== userId) {
      // Do not reveal whether a private deck exists.
      throw new UpdatedError("Flashcard set not found", 404);
    }

    return set;
  }

  // ── 6. Generate Multiple-Choice Quiz ────────────────────────────────────────

  async generateQuiz(
    setId: string,
    limit: number = 10,
    userId?: string,
    signal?: AbortSignal,
  ): Promise<QuizQuestion[]> {
    const set = await this.getSetById(setId, userId, signal);
    if (!set?.cards?.length) {
      throw new UpdatedError("Set has no cards to generate quiz", 422);
    }

    const allCards: Card[] = set.cards;

    const cardsToQuiz = [...allCards]
      .sort(() => 0.5 - Math.random())
      .slice(0, limit);

    // `getSetById` đã lấy toàn bộ cards ở trên (và cache chúng). Chọn distractor
    // trong RAM để tránh N query DB cho N câu hỏi.
    const questions = cardsToQuiz.map((card) => {
      const distractors = [...allCards]
        .filter((candidate) => candidate.id !== card.id)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);

      const options = [
        { definition: card.definition, isCorrect: true },
        ...distractors.map((d) => ({
          definition: d.definition,
          isCorrect: false,
        })),
      ].sort(() => 0.5 - Math.random());

      return {
        cardId: card.id,
        term: card.term,
        audioUrl: card.audioUrl ?? null,
        exampleSentence: card.exampleSentence ?? null,
        imageUrl: card.imageUrl ?? null,
        options,
      } satisfies QuizQuestion;
    });

    return questions;
  }

  // ── 7. Submit Answer (state kept in Redis, TTL 24h) ─────────────────────────

  private async updateSessionAtomically(input: BatchSubmitAnswersInput) {
    const { userId, sessionId, setId, mode, answers } = input;
    const sessionKey = `user:${userId}:session:${sessionId}`;
    try {
      const rawResults = await this.redis.eval(UPDATE_STUDY_SESSION_SCRIPT, {
        keys: [sessionKey, `${sessionKey}:lock`],
        arguments: [
          sessionId,
          userId,
          setId,
          mode,
          JSON.stringify(answers),
          String(Date.now()),
          "86400",
        ],
      });
      const results = JSON.parse(String(rawResults)) as Array<{
        sessionId: string;
        cardId: string;
        isCorrect: boolean;
        cardProgress: {
          cardId: string;
          streak: number;
          correctCount: number;
          wrongCount: number;
          status: "NEW" | "LEARNING" | "MASTERED";
          nextReviewAt: string | number;
          lastReviewedAt: string | number;
        };
        sessionSummary: { correctCount: number; wrongCount: number };
      }>;

      return results.map((result) => ({
        ...result,
        cardProgress: {
          ...result.cardProgress,
          nextReviewAt: new Date(
            result.cardProgress.nextReviewAt,
          ).toISOString(),
          lastReviewedAt: new Date(
            result.cardProgress.lastReviewedAt,
          ).toISOString(),
        },
      }));
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("STUDY_SESSION_BUSY")
      ) {
        throw new UpdatedError("Study session is busy, please retry", 409);
      }
      throw error;
    }
  }

  async submitAnswers(input: BatchSubmitAnswersInput) {
    return this.updateSessionAtomically(input);
  }

  async submitAnswer(input: SubmitAnswerInput) {
    const [result] = await this.updateSessionAtomically({
      userId: input.userId,
      sessionId: input.sessionId,
      setId: input.setId,
      mode: input.mode,
      answers: [{ cardId: input.cardId, isCorrect: input.isCorrect }],
    });
    return result;
  }

  // ── 8. Sync Session Progress (Redis → DB) ────────────────────────────────────

  async syncProgress(userId: string, sessionId: string) {
    const sessionKey = `user:${userId}:session:${sessionId}`;
    return this.withSessionLock(sessionKey, async () => {
      // MongoDB is the durable idempotency authority. This check also covers the
      // crash window where the transaction committed but Redis cleanup did not.
      const existingSession = await userProgressRepository.findSyncedSession(
        userId,
        sessionId,
      );
      if (existingSession) {
        await this.redis.del(sessionKey);
        return existingSession;
      }

      const rawSession = await this.redis.get(sessionKey);

      if (!rawSession) {
        throw new UpdatedError("Study session expired or not found", 404);
      }

      const sessionState: SessionProgressState = JSON.parse(rawSession);
      const updates = Object.values(sessionState.cardProgressMap).map(
        (item) => ({
          userId,
          cardId: item.cardId,
          status: item.status,
          streak: item.streak,
          correctCount: item.correctCount,
          wrongCount: item.wrongCount,
          nextReviewAt: new Date(item.nextReviewAt),
          lastReviewedAt: new Date(item.lastReviewedAt),
        }),
      );

      const totalCards = updates.length;
      const score =
        totalCards > 0
          ? Math.round((sessionState.correctCount / totalCards) * 100)
          : 0;

      const savedSession = await userProgressRepository.syncSessionProgress(
        userId,
        sessionId,
        sessionState.setId,
        sessionState.mode,
        score,
        totalCards,
        updates,
      );

      // Xóa session khỏi Redis sau khi sync thành công
      await this.redis.del(sessionKey);

      return savedSession;
    });
  }
}

export default new StudyService();
