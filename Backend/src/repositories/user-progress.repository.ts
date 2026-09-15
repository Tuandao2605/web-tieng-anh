import { createHash } from "node:crypto";
import { Prisma, UserCardProgress } from "../generated/prisma/client";
import { BaseRepository } from "./base.repository";
import { prisma } from "../libs/prisma";

// StudySession.id is a MongoDB ObjectId string. Deriving it from the authenticated
// user and client session makes retries converge on the same database document
// without requiring a schema migration or trusting a globally unique client ID.
export const getStudySessionDocumentId = (
  userId: string,
  clientSessionId: string,
) =>
  createHash("sha256")
    .update(`study-session:v1:${userId}:${clientSessionId}`)
    .digest("hex")
    .slice(0, 24);

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

class UserProgressRepository extends BaseRepository<
  UserCardProgress,
  typeof prisma.userCardProgress
> {
  constructor() {
    super(prisma.userCardProgress);
  }

  async getUserProgressForCards(userId: string, cardIds: string[]) {
    return this.model.findMany({
      where: { userId, cardId: { in: cardIds } },
    });
  }

  async findSyncedSession(userId: string, clientSessionId: string) {
    return prisma.studySession.findUnique({
      where: {
        id: getStudySessionDocumentId(userId, clientSessionId),
      },
    });
  }

  async syncSessionProgress(
    userId: string,
    clientSessionId: string,
    setId: string,
    mode: string,
    score: number,
    totalCards: number,
    progressUpdates: UpdateCardProgressInput[],
  ) {
    const sessionDocumentId = getStudySessionDocumentId(
      userId,
      clientSessionId,
    );

    return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // The deterministic _id is the durable idempotency boundary. If the
      // process commits MongoDB and crashes before deleting Redis state, a
      // retry updates the same document instead of creating a duplicate.
      const session = await tx.studySession.upsert({
        where: { id: sessionDocumentId },
        create: {
          id: sessionDocumentId,
          userId,
          setId,
          mode,
          score,
          totalCards,
          completedAt: new Date(),
        },
        update: {},
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
