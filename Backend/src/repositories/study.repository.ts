import { prisma } from "../libs/prisma";

// ─── Input Types ──────────────────────────────────────────────────────────────

export interface CreateCardInput {
  term: string;
  definition: string;
  audioUrl?: string;
  exampleSentence?: string;
  imageUrl?: string;
}

export interface CreateSetInput {
  userId: string;
  title: string;
  description?: string;
  isPublic?: boolean;
  cards: CreateCardInput[];
}

export interface UpdateSetInput {
  title?: string;
  description?: string;
  isPublic?: boolean;
}

export interface UpdateCardProgressInput {
  userId: string;
  cardId: string;
  status: "NEW" | "LEARNING" | "MASTERED";
  streak: number;
  correctCount: number;
  wrongCount: number;
  nextReviewAt: Date;
  lastReviewedAt: Date;
}

// ─── Repository ───────────────────────────────────────────────────────────────

// Shorthand để cast prisma sang any (model chưa generate type đầy đủ)
const db = prisma as any;

class StudyRepository {
  async listSets(userId?: string) {
    return db.flashcardSet.findMany({
      where: userId ? { OR: [{ isPublic: true }, { userId }] } : { isPublic: true },
      include: { cards: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async createSet(input: CreateSetInput) {
    return db.flashcardSet.create({
      data: {
        userId: input.userId,
        title: input.title,
        description: input.description,
        isPublic: input.isPublic ?? true,
        cards: {
          create: input.cards.map((card) => ({
            term: card.term,
            definition: card.definition,
            audioUrl: card.audioUrl,
            exampleSentence: card.exampleSentence,
            imageUrl: card.imageUrl,
          })),
        },
      },
      include: { cards: true },
    });
  }

  async updateSet(setId: string, input: UpdateSetInput) {
    return db.flashcardSet.update({
      where: { id: setId },
      data: {
        title: input.title,
        description: input.description,
        isPublic: input.isPublic,
      },
      include: { cards: true },
    });
  }

  async addCardsToSet(setId: string, cards: CreateCardInput[]) {
    return db.flashcardSet.update({
      where: { id: setId },
      data: {
        cards: {
          create: cards.map((card) => ({
            term: card.term,
            definition: card.definition,
            audioUrl: card.audioUrl,
            exampleSentence: card.exampleSentence,
            imageUrl: card.imageUrl,
          })),
        },
      },
      include: { cards: true },
    });
  }

  async findSetById(setId: string) {
    return db.flashcardSet.findUnique({
      where: { id: setId },
      include: { cards: true },
    });
  }

  /** Lấy các card ngẫu nhiên để làm distractor cho quiz */
  async getRandomDistractors(setId: string, excludeCardId: string, limit: number = 3) {
    // Ưu tiên lấy trong cùng set
    const sameSetCards: { id: string; definition: string }[] = await db.card.findMany({
      where: { setId, id: { not: excludeCardId } },
      select: { id: true, definition: true },
      take: limit * 2,
    });

    if (sameSetCards.length >= limit) {
      return sameSetCards.sort(() => 0.5 - Math.random()).slice(0, limit);
    }

    // Fallback: lấy từ global pool
    const fallbackCards: { id: string; definition: string }[] = await db.card.findMany({
      where: { id: { notIn: [excludeCardId, ...sameSetCards.map((c) => c.id)] } },
      select: { id: true, definition: true },
      take: limit - sameSetCards.length,
    });

    return [...sameSetCards, ...fallbackCards];
  }

  async getUserProgressForCards(userId: string, cardIds: string[]) {
    return db.userCardProgress.findMany({
      where: { userId, cardId: { in: cardIds } },
    });
  }

  async syncSessionProgress(
    userId: string,
    setId: string,
    mode: string,
    score: number,
    totalCards: number,
    progressUpdates: UpdateCardProgressInput[]
  ) {
    return (prisma as any).$transaction(async (tx: any) => {
      // 1. Ghi lại Study Session
      const session = await tx.studySession.create({
        data: { userId, setId, mode, score, totalCards, completedAt: new Date() },
      });

      // 2. Bulk upsert tiến trình từng card
      await Promise.all(
        progressUpdates.map((item) =>
          tx.userCardProgress.upsert({
            where: { userId_cardId: { userId: item.userId, cardId: item.cardId } },
            update: {
              status: item.status,
              streak: item.streak,
              correctCount: item.correctCount,
              wrongCount: item.wrongCount,
              nextReviewAt: item.nextReviewAt,
              lastReviewedAt: item.lastReviewedAt,
            },
            create: {
              userId: item.userId,
              cardId: item.cardId,
              status: item.status,
              streak: item.streak,
              correctCount: item.correctCount,
              wrongCount: item.wrongCount,
              nextReviewAt: item.nextReviewAt,
              lastReviewedAt: item.lastReviewedAt,
            },
          })
        )
      );

      return session;
    });
  }
}

export default new StudyRepository();
