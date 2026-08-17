import { FlashcardSet } from "../generated/prisma/client";
import { BaseRepository } from "./base.repository";
import { CreateCardInput } from "./card.repository";
import { prisma } from "../libs/prisma";

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

class StudyRepository extends BaseRepository<FlashcardSet> {
  constructor() {
    super("flashcardSet");
  }

  async listSets(userId?: string) {
    return this.model.findMany({
      where: userId
        ? { OR: [{ isPublic: true }, { userId }] }
        : { isPublic: true },
      include: { cards: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async searchPublicSets(keyword: string, page: number, limit: number) {
    const where = {
      isPublic: true,
      title: { contains: keyword, mode: "insensitive" as const },
    };
    const [decks, total] = await Promise.all([
      this.model.findMany({
        where,
        select: {
          id: true,
          userId: true,
          title: true,
          description: true,
          updatedAt: true,
          _count: { select: { cards: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.model.count({ where }),
    ]);

    const authorIds: string[] = Array.from(
      new Set<string>(decks.map((deck: { userId: string }) => deck.userId)),
    );
    const authors = authorIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: authorIds } },
          select: { id: true, name: true },
        })
      : [];
    const authorById = new Map(authors.map((author) => [author.id, author.name]));

    return {
      decks: decks.map((deck: any) => ({
        id: deck.id,
        title: deck.title,
        description: deck.description,
        cardCount: deck._count.cards,
        author: {
          id: deck.userId,
          name: authorById.get(deck.userId) ?? "Unknown author",
        },
        updatedAt: deck.updatedAt,
      })),
      total,
    };
  }

  async createSet(input: CreateSetInput) {
    return this.model.create({
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
    return this.model.update({
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
    return this.model.update({
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
    return this.model.findUnique({
      where: { id: setId },
      include: { cards: true },
    });
  }
}

export default new StudyRepository();
