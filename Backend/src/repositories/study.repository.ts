import { prisma } from "../libs/prisma";

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

class StudyRepository {
  private get db(): any {
    return prisma as any;
  }

  async createSet(input: CreateSetInput) {
    return this.db.flashcardSet.create({
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
      include: {
        cards: true,
      },
    });
  }

  async findSetById(setId: string) {
    return this.db.flashcardSet.findUnique({
      where: { id: setId },
      include: {
        cards: true,
      },
    });
  }

  async listSets(userId?: string) {
    return this.db.flashcardSet.findMany({
      where: userId
        ? { OR: [{ userId }, { isPublic: true }] }
        : { isPublic: true },
      include: {
        cards: true,
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  }

  async updateSet(setId: string, userId: string, input: CreateSetInput) {
    const existing = await this.db.flashcardSet.findUnique({
      where: { id: setId },
      select: { userId: true },
    });

    if (!existing) {
      throw new Error("Flashcard set not found");
    }
    if (existing.userId !== userId) {
      throw new Error("Forbidden");
    }

    return (prisma as any).$transaction(async (tx: any) => {
      await tx.card.deleteMany({ where: { setId } });
      return tx.flashcardSet.update({
        where: { id: setId },
        data: {
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
    });
  }

  async getRandomDistractors(setId: string, excludeCardId: string, limit: number = 3) {
    // Top priority: distractors from the same set
    const sameSetCards: any[] = await this.db.card.findMany({
      where: {
        setId,
        id: { not: excludeCardId },
      },
      take: limit * 2,
    });

    if (sameSetCards.length >= limit) {
      return sameSetCards.sort(() => 0.5 - Math.random()).slice(0, limit);
    }

    // Fallback: pull cards from global public sets
    const fallbackCards: any[] = await this.db.card.findMany({
      where: {
        id: { notIn: [excludeCardId, ...sameSetCards.map((c: any) => c.id)] },
      },
      take: limit - sameSetCards.length,
    });

    return [...sameSetCards, ...fallbackCards];
  }

  async getUserProgressForCards(userId: string, cardIds: string[]) {
    return this.db.userCardProgress.findMany({
      where: {
        userId,
        cardId: { in: cardIds },
      },
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
      // 1. Record Study Session
      const session = await tx.studySession.create({
        data: {
          userId,
          setId,
          mode,
          score,
          totalCards,
          completedAt: new Date(),
        },
      });

      // 2. Bulk upsert card progress
      for (const item of progressUpdates) {
        await tx.userCardProgress.upsert({
          where: {
            userId_cardId: {
              userId: item.userId,
              cardId: item.cardId,
            },
          },
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
        });
      }

      return session;
    });
  }
}

export default new StudyRepository();
