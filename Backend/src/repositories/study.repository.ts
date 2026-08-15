import { FlashcardSet } from "../generated/prisma/client";
import { BaseRepository } from "./base.repository";
import { CreateCardInput } from "./card.repository";

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
