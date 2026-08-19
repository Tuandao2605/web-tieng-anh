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
  cards?: Array<CreateCardInput & { id?: string }>;
}

class StudyRepository extends BaseRepository<FlashcardSet> {
  constructor() {
    super("flashcardSet");
  }

  async listSets(userId?: string) {
    const sets = await prisma.flashcardSet.findMany({
      where: userId
        ? { OR: [{ isPublic: true }, { userId }] }
        : { isPublic: true },
      select: {
        id: true,
        userId: true,
        title: true,
        description: true,
        isPublic: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { cards: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return sets.map(({ _count, ...set }) => ({
      ...set,
      cardCount: _count.cards,
    }));
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
    return prisma.$transaction(async (tx) => {
      const existingSet = await tx.flashcardSet.findUnique({
        where: { id: setId },
        select: { id: true },
      });
      if (!existingSet) {
        const error = new Error("Flashcard set not found") as Error & { code: string };
        error.code = "P2025";
        throw error;
      }

      await tx.flashcardSet.update({
        where: { id: setId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        },
      });

      if (input.cards) {
        const existingCards = await tx.card.findMany({
          where: { setId },
          select: { id: true },
        });
        const existingIds = new Set(existingCards.map((card) => card.id));
        const submittedExistingCards = input.cards.filter((card) => card.id);

        const foreignCard = submittedExistingCards.find(
          (card) => !existingIds.has(card.id as string),
        );
        if (foreignCard) {
          throw new Error("A submitted card does not belong to this flashcard set");
        }

        const retainedIds = submittedExistingCards.map((card) => card.id as string);
        await tx.card.deleteMany({
          where: {
            setId,
            ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
          },
        });

        await Promise.all(
          submittedExistingCards.map((card) =>
            tx.card.update({
              where: { id: card.id as string },
              data: {
                term: card.term,
                definition: card.definition,
                exampleSentence: card.exampleSentence || null,
                imageUrl: card.imageUrl || null,
              },
            }),
          ),
        );

        const newCards = input.cards.filter((card) => !card.id);
        if (newCards.length > 0) {
          await tx.card.createMany({
            data: newCards.map((card) => ({
              setId,
              term: card.term,
              definition: card.definition,
              audioUrl: card.audioUrl || null,
              exampleSentence: card.exampleSentence || null,
              imageUrl: card.imageUrl || null,
            })),
          });
        }
      }

      return tx.flashcardSet.findUniqueOrThrow({
        where: { id: setId },
        include: { cards: true },
      });
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
