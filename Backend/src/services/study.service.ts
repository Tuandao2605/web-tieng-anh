import { redisClient } from "../utils/redis";
import { cacheService } from "./cache.service";
import studyRepository, { CreateCardInput, CreateSetInput } from "../repositories/study.repository";

const redis = redisClient.getInstance();

export interface QuizQuestion {
  cardId: string;
  term: string;
  audioUrl?: string | null;
  exampleSentence?: string | null;
  imageUrl?: string | null;
  options: {
    definition: string;
    isCorrect: boolean;
  }[];
}

export interface SessionProgressState {
  sessionId: string;
  userId: string;
  setId: string;
  mode: string;
  totalCards: number;
  correctCount: number;
  wrongCount: number;
  cardProgressMap: Record<
    string,
    {
      cardId: string;
      streak: number;
      correctCount: number;
      wrongCount: number;
      status: "NEW" | "LEARNING" | "MASTERED";
      nextReviewAt: string;
      lastReviewedAt: string;
    }
  >;
}

export class StudyService {

  async createSet(input: CreateSetInput) {
    const newSet = await studyRepository.createSet(input);

    await cacheService.invalidateTag(["sets", "public"]);

    return newSet;
  }

  /**
   * 2. Get Flashcard Set with Cache-Aside Strategy
   * Redis Key: set:{setId}:cards (TTL: 1 hour)
   */

  async listSets(userId?: string) {
    return studyRepository.listSets(userId);
  }

  async getSetById(setId: string) {
    const cacheKey = `set:${setId}:cards`;

    return cacheService.getOrSetWithTag(
      cacheKey,
      async () => {
        const set = await studyRepository.findSetById(setId);
        if (!set) throw new Error("Flashcard set not found");
        return set;
      },
      ["sets", `set:${setId}`],
      3600 // 1 hour TTL
    );
  }

  async updateSet(setId: string, userId: string, input: CreateSetInput) {
    const updatedSet = await studyRepository.updateSet(setId, userId, input);
    await cacheService.invalidateTag(["sets", `set:${setId}`]);
    return updatedSet;
  }
  async addCardsToSet(setId: string, userId: string, cards: CreateCardInput[]) {
    const updatedSet = await studyRepository.addCardsToSet(setId, userId, cards);
    await cacheService.invalidateTag(["sets", `set:${setId}`]);

    return updatedSet;
  }
  /**
   * 3. Generate Multiple Choice Quiz (4 Options per card)
   */
  async generateQuiz(setId: string, limit: number = 10): Promise<QuizQuestion[]> {
    const set: any = await this.getSetById(setId);
    if (!set || !set.cards || set.cards.length === 0) {
      throw new Error("Set has no cards to generate quiz");
    }

    const allCards: any[] = set.cards;


    const cardsToQuiz = [...allCards]
      .sort(() => 0.5 - Math.random())
      .slice(0, limit);

    const questions: QuizQuestion[] = [];

    // 3. Tạo quiz hoàn toàn trên Memory (RAM) - Không query DB lặp lại
    for (const card of cardsToQuiz) {
      // Lấy các card khác trong cùng bộ set
      const sameSetCards = allCards.filter((c: any) => c.id !== card.id);

      let distractors: any[] = [];

      // Trường hợp 1: Set đủ từ (>= 4 từ) -> Bốc ngẫu nhiên 3 từ trong set
      if (sameSetCards.length >= 3) {
        distractors = [...sameSetCards]
          .sort(() => 0.5 - Math.random())
          .slice(0, 3);
      }
      // Trường hợp 2: Set quá ít từ (< 4 từ) -> Query DB 1 lần duy nhất lấy thêm từ public sets
      else {
        const excludeIds = [card.id, ...sameSetCards.map((c: any) => c.id)];
        const fallbackCards = await studyRepository.findGlobalCardsExcept(
          excludeIds,
          3 - sameSetCards.length
        );
        distractors = [...sameSetCards, ...fallbackCards];
      }

      // Ghép đáp án đúng + đáp án nhiễu và xáo trộn vị trí A, B, C, D
      const options = [
        { definition: card.definition, isCorrect: true },
        ...distractors.map((d: any) => ({
          definition: d.definition,
          isCorrect: false,
        })),
      ].sort(() => 0.5 - Math.random());

      questions.push({
        cardId: card.id,
        term: card.term,
        audioUrl: card.audioUrl,
        exampleSentence: card.exampleSentence,
        imageUrl: card.imageUrl,
        options,
      });
    }

    return questions;
  }

  /**
   * 4. Submit Answer & Track Temporary Session State in Redis
   * Redis Key: user:{userId}:session:{sessionId} (TTL: 24h)
   */
  async submitAnswer(
    userId: string,
    sessionId: string,
    setId: string,
    mode: string,
    cardId: string,
    isCorrect: boolean
  ) {
    const sessionKey = `user:${userId}:session:${sessionId}`;
    const rawSession = await redis.get(sessionKey);

    let sessionState: SessionProgressState;

    if (rawSession) {
      sessionState = JSON.parse(rawSession);
    } else {
      sessionState = {
        sessionId,
        userId,
        setId,
        mode,
        totalCards: 0,
        correctCount: 0,
        wrongCount: 0,
        cardProgressMap: {},
      };
    }

    // Keep session metadata consistent even when the first answer arrives later.
    sessionState.setId = setId;
    sessionState.mode = mode;

    // Update global session counts
    if (isCorrect) {
      sessionState.correctCount += 1;
    } else {
      sessionState.wrongCount += 1;
    }

    // Get current progress for this specific card in session
    const currentCardProg = sessionState.cardProgressMap[cardId] || {
      cardId,
      streak: 0,
      correctCount: 0,
      wrongCount: 0,
      status: "NEW",
      nextReviewAt: new Date().toISOString(),
      lastReviewedAt: new Date().toISOString(),
    };

    if (isCorrect) {
      currentCardProg.correctCount += 1;
      currentCardProg.streak += 1;
    } else {
      currentCardProg.wrongCount += 1;
      currentCardProg.streak = 0; // reset streak on wrong answer
    }

    // Spaced Repetition Logic (Leitner system simple rule)
    // Streak >= 2 -> MASTERED (Review in 3 days)
    // Streak == 1 -> LEARNING (Review in 1 day)
    // Streak == 0 -> LEARNING (Review today)
    const now = new Date();
    let reviewDays = 0;

    if (currentCardProg.streak >= 2) {
      currentCardProg.status = "MASTERED";
      reviewDays = 3 * currentCardProg.streak;
    } else {
      currentCardProg.status = "LEARNING";
      reviewDays = currentCardProg.streak === 1 ? 1 : 0;
    }

    const nextReviewDate = new Date(now.getTime() + reviewDays * 24 * 60 * 60 * 1000);
    currentCardProg.nextReviewAt = nextReviewDate.toISOString();
    currentCardProg.lastReviewedAt = now.toISOString();

    sessionState.cardProgressMap[cardId] = currentCardProg;

    // Save updated session state back to Redis with 24 hours TTL
    await redis.set(sessionKey, JSON.stringify(sessionState), { EX: 86400 });

    return {
      sessionId,
      cardId,
      isCorrect,
      cardProgress: currentCardProg,
      sessionSummary: {
        correctCount: sessionState.correctCount,
        wrongCount: sessionState.wrongCount,
      },
    };
  }

  /**
   * 5. Sync Session Progress from Redis to Database Transaction
   */
  async syncProgress(userId: string, sessionId: string) {
    const sessionKey = `user:${userId}:session:${sessionId}`;
    const rawSession = await redis.get(sessionKey);

    if (!rawSession) {
      throw new Error("Study session expired or not found in Redis");
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
    const score = totalCards > 0 ? Math.round((sessionState.correctCount / totalCards) * 100) : 0;

    // Save session & card progress into DB atomically
    const savedSession = await studyRepository.syncSessionProgress(
      userId,
      sessionState.setId,
      sessionState.mode,
      score,
      totalCards,
      updates
    );

    // Evict Redis session cache after successful sync
    await redis.del(sessionKey);

    return savedSession;
  }
}

export default new StudyService();
