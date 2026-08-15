import { Card } from "../generated/prisma/client";
import { BaseRepository } from "./base.repository";

export interface CreateCardInput {
    term: string;
    definition: string;
    audioUrl?: string;
    exampleSentence?: string;
    imageUrl?: string;
}

class CardRepository extends BaseRepository<Card> {
    constructor() {
        super("card");
    }

    /** Lấy các card ngẫu nhiên để làm distractor cho quiz */
    async getRandomDistractors(setId: string, excludeCardId: string, limit: number = 3) {
        const sameSetCards: { id: string; definition: string }[] = await this.model.findMany({
            where: { setId, id: { not: excludeCardId } },
            select: { id: true, definition: true },
            take: limit * 2,
        });

        if (sameSetCards.length >= limit) {
            return sameSetCards.sort(() => 0.5 - Math.random()).slice(0, limit);
        }

        const fallbackCards: { id: string; definition: string }[] = await this.model.findMany({
            where: { id: { notIn: [excludeCardId, ...sameSetCards.map((c) => c.id)] } },
            select: { id: true, definition: true },
            take: limit - sameSetCards.length,
        });

        return [...sameSetCards, ...fallbackCards];
    }

    async findGlobalCardsExcept(excludeCardIds: string[], limit: number) {
        return this.model.findMany({
            where: {
                id: { notIn: excludeCardIds },
            },
            take: limit,
        });
    }
}

export default new CardRepository();