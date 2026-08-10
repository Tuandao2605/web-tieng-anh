import { Request, Response } from "express";
import studyService from "../../../services/study.service";
import { errorResponse, successResponse } from "../../../utils/response";

export class StudyController {
  /**
   * GET /api/v1/sets
   */
  async listSets(req: Request, res: Response) {
    try {
      const userId = (req.user as any)?.id as string | undefined;
      const sets = await studyService.listSets(userId);
      return successResponse(res, sets, "Flashcard sets retrieved successfully");
    } catch (error: any) {
      return errorResponse(res, error.message || "Failed to retrieve flashcard sets", error);
    }
  }

  /**
   * POST /api/v1/sets
   */
  async createSet(req: Request, res: Response) {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) {
        return errorResponse(res, "Unauthorized", {}, 401);
      }

      const newSet = await studyService.createSet({
        userId,
        ...req.body,
      });

      return successResponse(res, newSet, "Flashcard set created successfully", 201);
    } catch (error: any) {
      return errorResponse(res, error.message || "Failed to create flashcard set", error);
    }
  }

  /**
   * PUT /api/v1/sets/:id
   */
  async updateSet(req: Request, res: Response) {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) {
        return errorResponse(res, "Unauthorized", {}, 401);
      }

      const setId = req.params.id as string;
      const updatedSet = await studyService.updateSet(setId, userId, req.body);
      return successResponse(res, updatedSet, "Flashcard set updated successfully");
    } catch (error: any) {
      if (error.message === "Forbidden") {
        return errorResponse(res, "Forbidden", {}, 403);
      }
      if (error.message === "Flashcard set not found") {
        return errorResponse(res, error.message, {}, 404);
      }
      return errorResponse(res, error.message || "Failed to update flashcard set", error);
    }
  }

  /**
   * POST /api/v1/sets/:id/cards/bulk
   */
  async addCardsToSet(req: Request, res: Response) {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) {
        return errorResponse(res, "Unauthorized", {}, 401);
      }

      const setId = req.params.id as string;
      const updatedSet = await studyService.addCardsToSet(setId, userId, req.body.cards);
      return successResponse(
        res,
        updatedSet,
        `${req.body.cards.length} cards added successfully`,
        201
      );
    } catch (error: any) {
      if (error.message === "Forbidden") {
        return errorResponse(res, "Forbidden", {}, 403);
      }
      if (error.message === "Flashcard set not found") {
        return errorResponse(res, error.message, {}, 404);
      }
      return errorResponse(res, error.message || "Failed to add cards", error);
    }
  }

  /**
   * GET /api/v1/sets/:id
   */
  async getSet(req: Request, res: Response) {
    try {
      const setId = req.params.id as string;
      const set = await studyService.getSetById(setId);

      return successResponse(res, set, "Flashcard set retrieved successfully");
    } catch (error: any) {
      return errorResponse(res, error.message || "Flashcard set not found", error, 404);
    }
  }

  /**
   * POST /api/v1/sets/:id/quiz
   */
  async generateQuiz(req: Request, res: Response) {
    try {
      const setId = req.params.id as string;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

      const questions = await studyService.generateQuiz(setId, limit);

      return successResponse(
        res,
        {
          setId,
          questionCount: questions.length,
          questions,
        },
        "Quiz generated successfully"
      );
    } catch (error: any) {
      return errorResponse(res, error.message || "Failed to generate quiz", error);
    }
  }

  /**
   * POST /api/v1/study/submit-answer
   */
  async submitAnswer(req: Request, res: Response) {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) {
        return errorResponse(res, "Unauthorized", {}, 401);
      }

      const { sessionId, setId, mode, cardId, isCorrect } = req.body;

      const result = await studyService.submitAnswer(
        userId,
        sessionId,
        setId,
        mode,
        cardId,
        isCorrect
      );

      return successResponse(res, result, "Answer recorded successfully");
    } catch (error: any) {
      return errorResponse(res, error.message || "Failed to record answer", error);
    }
  }

  /**
   * POST /api/v1/study/sync-progress
   */
  async syncProgress(req: Request, res: Response) {
    try {
      const userId = (req.user as any)?.id;
      if (!userId) {
        return errorResponse(res, "Unauthorized", {}, 401);
      }

      const { sessionId } = req.body;

      const syncedSession = await studyService.syncProgress(userId, sessionId);

      return successResponse(
        res,
        syncedSession,
        "Study session progress synced to database successfully"
      );
    } catch (error: any) {
      return errorResponse(res, error.message || "Failed to sync study progress", error);
    }
  }
}

export default new StudyController();
