import { redisClient } from "../utils/redis";
import { cacheService } from "./cache.service";
import { UpdatedError } from "../errors/app.error";
import studyRepository, {
  CreateSetInput,
  UpdateSetInput,
} from "../repositories/study.repository";
import type { CreateCardInput } from "../repositories/card.repository";
import userProgressRepository from "../repositories/user-progress.repository";
import {
  CardProgressEntry,
  CardStatus,
  QuizQuestion,
  SessionProgressState,
  BatchSubmitAnswersInput,
  SubmitAnswerInput,
} from "../types/study";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Leitner-based spaced repetition:
 * - streak >= 2 → MASTERED  (review sau streak × 3 ngày)
 * - streak == 1 → LEARNING  (review sau 1 ngày)
 * - streak == 0 → LEARNING  (review hôm nay)
 */
function computeNextReview(streak: number): {
  status: CardStatus;
  nextReviewAt: Date;
} {
  if (streak >= 2) {
    return {
      status: "MASTERED",
      nextReviewAt: new Date(Date.now() + streak * 3 * 24 * 60 * 60 * 1000),
    };
  }
  return {
    status: "LEARNING",
    nextReviewAt: new Date(Date.now() + streak * 24 * 60 * 60 * 1000),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class StudyService {
  private get redis() {
    return redisClient.getInstance();
  }

  // ── 1. List Sets ────────────────────────────────────────────────────────────

  async listSets(userId?: string) {
    const cacheKey = userId ? `sets:user:${userId}` : "sets:public";
    const tags = userId ? ["sets", `user:${userId}:sets`] : ["sets", "public"];

    return cacheService.getOrSetWithTag(
      cacheKey,
      () => studyRepository.listSets(userId),
      tags,
      300, // 5 min TTL (list changes frequently)
    );
  }

  // ── 2. Create Set ───────────────────────────────────────────────────────────

  async createSet(input: CreateSetInput) {
    const newSet = await studyRepository.createSet(input);
    await cacheService.invalidateTag(["sets", "public"]);
    return newSet;
  }

  // ── 3. Update Set ───────────────────────────────────────────────────────────

  async updateSet(setId: string, input: UpdateSetInput) {
    const updated = await studyRepository
      .updateSet(setId, input)
      .catch((err: any) => {
        if (err?.code === "P2025")
          throw new UpdatedError("Flashcard set not found", 404, err);
        throw new UpdatedError("Failed to update flashcard set", 500, err);
      });

    await cacheService.invalidateTag(["sets", `set:${setId}`]);
    return updated;
  }

  // ── 4. Add Cards to Set ─────────────────────────────────────────────────────

  async addCardsToSet(setId: string, cards: CreateCardInput[]) {
    const updated = await studyRepository
      .addCardsToSet(setId, cards)
      .catch((err: any) => {
        if (err?.code === "P2025")
          throw new UpdatedError("Flashcard set not found", 404, err);
        throw new UpdatedError("Failed to add cards", 500, err);
      });

    await cacheService.invalidateTag([`set:${setId}`]);
    return updated;
  }

  // ── 5. Get Set by ID (Cache-Aside, TTL 1h) ──────────────────────────────────

  async getSetById(setId: string) {
    return cacheService.getOrSetWithTag(
      `set:${setId}:cards`,
      async () => {
        const set = await studyRepository.findSetById(setId);
        if (!set) throw new UpdatedError("Flashcard set not found", 404);
        return set;
      },
      ["sets", `set:${setId}`],
      3600,
    );
  }

  // ── 6. Generate Multiple-Choice Quiz ────────────────────────────────────────

  async generateQuiz(
    setId: string,
    limit: number = 10,
  ): Promise<QuizQuestion[]> {
    const set: any = await this.getSetById(setId);
    if (!set?.cards?.length) {
      throw new UpdatedError("Set has no cards to generate quiz", 422);
    }

    const allCards: any[] = set.cards;

    const cardsToQuiz = [...allCards]
      .sort(() => 0.5 - Math.random())
      .slice(0, limit);

    // `getSetById` đã lấy toàn bộ cards ở trên (và cache chúng). Chọn distractor
    // trong RAM để tránh N query DB cho N câu hỏi.
    const questions = cardsToQuiz.map((card: any) => {
      const distractors = [...allCards]
        .filter((candidate) => candidate.id !== card.id)
        .sort(() => 0.5 - Math.random())
        .slice(0, 3);

      const options = [
        { definition: card.definition, isCorrect: true },
        ...distractors.map((d) => ({ definition: d.definition, isCorrect: false })),
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

  /**
   * Lưu cả lượt trả lời bằng đúng một Redis GET và một Redis SET. Đây là đường
   * chính cho UI học; submitAnswer bên dưới được giữ lại để tương thích API cũ.
   */
  async submitAnswers(input: BatchSubmitAnswersInput) {
    const { userId, sessionId, setId, mode, answers } = input;
    const sessionKey = `user:${userId}:session:${sessionId}`;
    const rawSession = await this.redis.get(sessionKey);
    const sessionState: SessionProgressState = rawSession
      ? JSON.parse(rawSession)
      : {
          sessionId, userId, setId, mode, totalCards: 0,
          correctCount: 0, wrongCount: 0, cardProgressMap: {},
        };

    sessionState.setId = setId;
    sessionState.mode = mode;
    const results = answers.map(({ cardId, isCorrect }) => {
      if (isCorrect) sessionState.correctCount += 1;
      else sessionState.wrongCount += 1;

      const now = new Date();
      const previous = sessionState.cardProgressMap[cardId] ?? {
        cardId, streak: 0, correctCount: 0, wrongCount: 0, status: "NEW" as CardStatus,
        nextReviewAt: now.toISOString(), lastReviewedAt: now.toISOString(),
      };
      if (isCorrect) {
        previous.correctCount += 1;
        previous.streak += 1;
      } else {
        previous.wrongCount += 1;
        previous.streak = 0;
      }
      const { status, nextReviewAt } = computeNextReview(previous.streak);
      previous.status = status;
      previous.nextReviewAt = nextReviewAt.toISOString();
      previous.lastReviewedAt = now.toISOString();
      sessionState.cardProgressMap[cardId] = previous;

      return {
        sessionId, cardId, isCorrect, cardProgress: previous,
        sessionSummary: {
          correctCount: sessionState.correctCount,
          wrongCount: sessionState.wrongCount,
        },
      };
    });

    await this.redis.set(sessionKey, JSON.stringify(sessionState), { EX: 86400 });
    return results;
  }

  async submitAnswer(input: SubmitAnswerInput) {
    const { userId, sessionId, setId, mode, cardId, isCorrect } = input;
    const sessionKey = `user:${userId}:session:${sessionId}`;
    const rawSession = await this.redis.get(sessionKey);

    const sessionState: SessionProgressState = rawSession
      ? JSON.parse(rawSession)
      : {
          sessionId,
          userId,
          setId,
          mode,
          totalCards: 0,
          correctCount: 0,
          wrongCount: 0,
          cardProgressMap: {},
        };

    // Giữ metadata nhất quán khi answer đầu tiên đến muộn
    sessionState.setId = setId;
    sessionState.mode = mode;

    // Cập nhật đếm toàn phiên
    if (isCorrect) sessionState.correctCount += 1;
    else sessionState.wrongCount += 1;

    // Cập nhật tiến trình của card cụ thể
    const now = new Date();
    const prev: CardProgressEntry = sessionState.cardProgressMap[cardId] ?? {
      cardId,
      streak: 0,
      correctCount: 0,
      wrongCount: 0,
      status: "NEW",
      nextReviewAt: now.toISOString(),
      lastReviewedAt: now.toISOString(),
    };

    if (isCorrect) {
      prev.correctCount += 1;
      prev.streak += 1;
    } else {
      prev.wrongCount += 1;
      prev.streak = 0;
    }

    const { status, nextReviewAt } = computeNextReview(prev.streak);
    prev.status = status;
    prev.nextReviewAt = nextReviewAt.toISOString();
    prev.lastReviewedAt = now.toISOString();

    sessionState.cardProgressMap[cardId] = prev;

    await this.redis.set(sessionKey, JSON.stringify(sessionState), {
      EX: 86400,
    });

    return {
      sessionId,
      cardId,
      isCorrect,
      cardProgress: prev,
      sessionSummary: {
        correctCount: sessionState.correctCount,
        wrongCount: sessionState.wrongCount,
      },
    };
  }

  // ── 8. Sync Session Progress (Redis → DB) ────────────────────────────────────

  async syncProgress(userId: string, sessionId: string) {
    const sessionKey = `user:${userId}:session:${sessionId}`;
    const rawSession = await this.redis.get(sessionKey);

    if (!rawSession) {
      throw new UpdatedError("Study session expired or not found", 404);
    }

    const sessionState: SessionProgressState = JSON.parse(rawSession);
    const updates = Object.values(sessionState.cardProgressMap).map((item) => ({
      userId,
      cardId: item.cardId,
      status: item.status,
      streak: item.streak,
      correctCount: item.correctCount,
      wrongCount: item.wrongCount,
      nextReviewAt: new Date(item.nextReviewAt),
      lastReviewedAt: new Date(item.lastReviewedAt),
    }));

    const totalCards = updates.length;
    const score =
      totalCards > 0
        ? Math.round((sessionState.correctCount / totalCards) * 100)
        : 0;

    const savedSession = await userProgressRepository.syncSessionProgress(
      userId,
      sessionState.setId,
      sessionState.mode,
      score,
      totalCards,
      updates,
    );

    // Xóa session khỏi Redis sau khi sync thành công
    await this.redis.del(sessionKey);

    return savedSession;
  }
}

export default new StudyService();
