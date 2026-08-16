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

            // 2. MongoDB bulk update: một lệnh thay cho 3 query × mỗi card
            // (find + upsert + refetch) mà Prisma upsert tạo ra.
            if (progressUpdates.length > 0) {
                const updates = progressUpdates.map((item) => ({
                    q: {
                        userId: { $oid: item.userId },
                        cardId: { $oid: item.cardId },
                    },
                    u: {
                        $set: {
                            status: item.status,
                            streak: item.streak,
                            correctCount: item.correctCount,
                            wrongCount: item.wrongCount,
                            nextReviewAt: { $date: item.nextReviewAt.toISOString() },
                            lastReviewedAt: { $date: item.lastReviewedAt.toISOString() },
                        },
                        $setOnInsert: {
                            userId: { $oid: item.userId },
                            cardId: { $oid: item.cardId },
                        },
                    },
                    upsert: true,
                    multi: false,
                }));

                await tx.$runCommandRaw({
                    update: "user_card_progress",
                    updates,
                    ordered: false,
                });
            }

            return session;
        });
    }
}

export default new UserProgressRepository();
