import { Request, Response } from "express";
import studyService from "../../../services/study.service";
import { UpdatedError } from "../../../errors/app.error";
import { errorResponse, successResponse } from "../../../utils/response";

export class StudyController {
  async searchPublicDecks(req: Request, res: Response) {
    try {
      const { q, page, limit } = req.query as unknown as {
        q: string;
        page: number;
        limit: number;
      };
      const result = await studyService.searchPublicDecks(q, page, limit);
      return successResponse(
        res,
        result,
        "Public decks retrieved successfully",
      );
    } catch (error: any) {
      const status = error instanceof UpdatedError ? error.status : 500;
      return errorResponse(
        res,
        error.message || "Failed to search public decks",
        error,
        status,
      );
    }
  }

  // ── GET /api/v1/sets ────────────────────────────────────────────────────────

  async listSets(req: Request, res: Response) {
    try {
      const userId = (req.user as any)?.id as string | undefined;
      const rawJson = await studyService.listSetsRaw(userId);
      return res
        .setHeader("Content-Type", "application/json")
        .status(200)
        .send(rawJson);
    } catch (error: any) {
      const status = error instanceof UpdatedError ? error.status : 500;
      return errorResponse(
        res,
        error.message || "Failed to retrieve flashcard sets",
        error,
        status,
      );
    }
  }

  // ── POST /api/v1/sets ───────────────────────────────────────────────────────

  async createSet(req: Request, res: Response) {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return errorResponse(res, "Unauthorized", {}, 401);

      const newSet = await studyService.createSet({ userId, ...req.body });
      return successResponse(
        res,
        newSet,
        "Flashcard set created successfully",
        201,
      );
    } catch (error: any) {
      const status = error instanceof UpdatedError ? error.status : 500;
      return errorResponse(
        res,
        error.message || "Failed to create flashcard set",
        error,
        status,
      );
    }
  }

  // ── GET /api/v1/sets/:id ────────────────────────────────────────────────────

  async getSet(req: Request, res: Response) {
    try {
      const set = await studyService.getSetById(
        req.params.id as string,
        req.user?.id,
      );
      return successResponse(res, set, "Flashcard set retrieved successfully");
    } catch (error: any) {
      const status = error instanceof UpdatedError ? error.status : 404;
      return errorResponse(
        res,
        error.message || "Flashcard set not found",
        error,
        status,
      );
    }
  }

  // ── PUT /api/v1/sets/:id ────────────────────────────────────────────────────

  async updateSet(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return errorResponse(res, "Unauthorized", {}, 401);

      const updated = await studyService.updateSet(
        req.params.id as string,
        userId,
        req.body,
      );
      return successResponse(
        res,
        updated,
        "Flashcard set updated successfully",
      );
    } catch (error: any) {
      const status = error instanceof UpdatedError ? error.status : 500;
      return errorResponse(
        res,
        error.message || "Failed to update flashcard set",
        error,
        status,
      );
    }
  }

  // ── POST /api/v1/sets/:id/cards/bulk ────────────────────────────────────────

  async addCardsToSet(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId) return errorResponse(res, "Unauthorized", {}, 401);

      const updated = await studyService.addCardsToSet(
        req.params.id as string,
        userId,
        req.body.cards,
      );
      return successResponse(res, updated, "Cards added successfully", 201);
    } catch (error: any) {
      const status = error instanceof UpdatedError ? error.status : 500;
      return errorResponse(
        res,
        error.message || "Failed to add cards",
        error,
        status,
      );
    }
  }

  // ── POST /api/v1/sets/:id/quiz ───────────────────────────────────────────────

  async generateQuiz(req: Request, res: Response) {
    try {
      const setId = req.params.id as string;
      const limit = req.query.limit
        ? parseInt(req.query.limit as string, 10)
        : 10;
      const questions = await studyService.generateQuiz(
        setId,
        limit,
        req.user?.id,
      );

      return successResponse(
        res,
        { setId, questionCount: questions.length, questions },
        "Quiz generated successfully",
      );
    } catch (error: any) {
      const status = error instanceof UpdatedError ? error.status : 500;
      return errorResponse(
        res,
        error.message || "Failed to generate quiz",
        error,
        status,
      );
    }
  }

  // ── POST /api/v1/study/submit-answer ────────────────────────────────────────

  async submitAnswer(req: Request, res: Response) {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return errorResponse(res, "Unauthorized", {}, 401);

      const { sessionId, setId, mode, cardId, isCorrect } = req.body;
      const result = await studyService.submitAnswer({
        userId,
        sessionId,
        setId,
        mode,
        cardId,
        isCorrect,
      });

      return successResponse(res, result, "Answer recorded successfully");
    } catch (error: any) {
      const status = error instanceof UpdatedError ? error.status : 500;
      return errorResponse(
        res,
        error.message || "Failed to record answer",
        error,
        status,
      );
    }
  }

  // ── POST /api/v1/study/submit-answers (batch) ─────────────────────────────
  async submitAnswers(req: Request, res: Response) {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return errorResponse(res, "Unauthorized", {}, 401);

      const { sessionId, setId, mode, answers } = req.body;
      const results = await studyService.submitAnswers({
        userId,
        sessionId,
        setId,
        mode,
        answers,
      });
      return successResponse(res, results, "Answers recorded successfully");
    } catch (error: any) {
      const status = error instanceof UpdatedError ? error.status : 500;
      return errorResponse(
        res,
        error.message || "Failed to record answers",
        error,
        status,
      );
    }
  }

  // ── POST /api/v1/study/sync-progress ────────────────────────────────────────

  async syncProgress(req: Request, res: Response) {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) return errorResponse(res, "Unauthorized", {}, 401);

      const { sessionId } = req.body;
      const syncedSession = await studyService.syncProgress(userId, sessionId);

      return successResponse(
        res,
        syncedSession,
        "Study session progress synced to database successfully",
      );
    } catch (error: any) {
      const status = error instanceof UpdatedError ? error.status : 500;
      return errorResponse(
        res,
        error.message || "Failed to sync study progress",
        error,
        status,
      );
    }
  }
}

export default new StudyController();
