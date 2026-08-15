import { UserCardProgress } from "../generated/prisma/client";
import { BaseRepository } from "./base.repository";
import { prisma } from "../libs/prisma";

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

class UserProgressRepository extends BaseRepository<UserCardProgress> {
    constructor() {
        super("userCardProgress");
    }

    async getUserProgressForCards(userId: string, cardIds: string[]) {
        return this.model.findMany({
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

export default new UserProgressRepository();