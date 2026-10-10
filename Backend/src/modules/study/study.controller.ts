import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { UpdatedError } from "../../errors/app.error";
import type { AuthenticatedUser } from "../../types/auth";
import {
  addCardsToSetSchema,
  createSetSchema,
  deleteSetSchema,
  generateQuizSchema,
  listSetsSchema,
  searchPublicDecksSchema,
  submitAnswerSchema,
  submitAnswersSchema,
  syncProgressSchema,
  updateSetSchema,
} from "./study.validator";
import { ApiMessage } from "../../common/decorators/api-message.decorator";
import { apiHttpException } from "../../common/exceptions/api-http-exception";
import {
  ApiRateLimitGuard,
  HeavyRateLimitGuard,
  JwtAuthGuard,
  OptionalJwtAuthGuard,
} from "../../common/guards/api.guards";
import { STUDY_SERVICE } from "./study.tokens";
import type { StudyService } from "./study.tokens";

type AuthenticatedRequest = FastifyRequest & {
  user?: AuthenticatedUser;
};

const validationException = (
  issues: readonly { path: PropertyKey[]; message: string }[],
) =>
  apiHttpException(
    "Validated Failed",
    issues.map((issue) => ({ path: issue.path[1], message: issue.message })),
    HttpStatus.BAD_REQUEST,
  );

const isAbortError = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (("name" in error && error.name === "AbortError") ||
    ("code" in error && error.code === "ABORT_ERR"));

const createAbortSignal = (reply: FastifyReply) => {
  const controller = new AbortController();
  const onClose = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  reply.raw.once("close", onClose);
  return {
    signal: controller.signal,
    cleanup: () => reply.raw.off("close", onClose),
  };
};

const throwStudyError = (
  error: unknown,
  fallbackMessage: string,
  fallbackStatus: number,
): never => {
  if (error instanceof HttpException) throw error;
  const status = error instanceof UpdatedError ? error.status : fallbackStatus;
  const message = error instanceof Error ? error.message : fallbackMessage;
  throw apiHttpException(message || fallbackMessage, error, status);
};

type CardRequestBody = {
  term: string;
  definition: string;
  audioUrl?: string | undefined;
  exampleSentence?: string | undefined;
  imageUrl?: string | undefined;
  id?: string | undefined;
};

const toCreateCardInput = (card: CardRequestBody) => ({
  term: card.term,
  definition: card.definition,
  ...(card.audioUrl !== undefined ? { audioUrl: card.audioUrl } : {}),
  ...(card.exampleSentence !== undefined
    ? { exampleSentence: card.exampleSentence }
    : {}),
  ...(card.imageUrl !== undefined ? { imageUrl: card.imageUrl } : {}),
});

const toUpdateCardInput = (card: CardRequestBody) => ({
  ...toCreateCardInput(card),
  ...(card.id !== undefined ? { id: card.id } : {}),
});

@Controller("api/v1")
@UseGuards(ApiRateLimitGuard)
export class StudyController {
  constructor(
    @Inject(STUDY_SERVICE) private readonly study: StudyService,
  ) {}

  @Get("sets")
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async listSets(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>,
    @Res() reply: FastifyReply,
  ) {
    const abort = createAbortSignal(reply);
    try {
      const parsed = await listSetsSchema.safeParseAsync({ query });
      if (!parsed.success) throw validationException(parsed.error.issues);

      const rawJson = await this.study.listSetsRaw(
        request.user?.id,
        parsed.data.query.cursor,
        parsed.data.query.limit,
        abort.signal,
      );
      // The service caches this exact pre-serialized API envelope. Send the
      // string directly so list reads avoid JSON.parse/stringify on cache hits.
      return reply.type("application/json").code(HttpStatus.OK).send(rawJson);
    } catch (error) {
      if (abort.signal.aborted || isAbortError(error)) return;
      if (error instanceof HttpException) {
        return reply
          .code(error.getStatus())
          .send(error.getResponse());
      }
      const status = error instanceof UpdatedError ? error.status : 500;
      return reply.code(status).send({
        success: false,
        error,
        message:
          error instanceof Error
            ? error.message || "Failed to retrieve flashcard sets"
            : "Failed to retrieve flashcard sets",
      });
    } finally {
      abort.cleanup();
    }
  }

  @Post("sets")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiMessage("Flashcard set created successfully")
  async createSet(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw apiHttpException("Unauthorized", {}, HttpStatus.UNAUTHORIZED);
    }

    const parsed = await createSetSchema.safeParseAsync({ body });
    if (!parsed.success) throw validationException(parsed.error.issues);

    try {
      const { title, description, isPublic, cards } = parsed.data.body;
      return await this.study.createSet({
        userId,
        title,
        isPublic,
        ...(description !== undefined ? { description } : {}),
        cards: cards.map(toCreateCardInput),
      });
    } catch (error) {
      return throwStudyError(error, "Failed to create flashcard set", 500);
    }
  }

  @Get("sets/:id")
  @UseGuards(OptionalJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Flashcard set retrieved successfully")
  async getSet(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const abort = createAbortSignal(reply);
    try {
      return await this.study.getSetById(
        id,
        request.user?.id,
        abort.signal,
      );
    } catch (error) {
      if (abort.signal.aborted || isAbortError(error)) return;
      return throwStudyError(error, "Flashcard set not found", 404);
    } finally {
      abort.cleanup();
    }
  }

  @Put("sets/:id")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Flashcard set updated successfully")
  async updateSet(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw apiHttpException("Unauthorized", {}, HttpStatus.UNAUTHORIZED);
    }
    const parsed = await updateSetSchema.safeParseAsync({
      params: { id },
      body,
    });
    if (!parsed.success) throw validationException(parsed.error.issues);

    try {
      return await this.study.updateSet(
        parsed.data.params.id,
        userId,
        {
          title: parsed.data.body.title,
          isPublic: parsed.data.body.isPublic,
          ...(parsed.data.body.description !== undefined
            ? { description: parsed.data.body.description }
            : {}),
          cards: parsed.data.body.cards.map(toUpdateCardInput),
        },
      );
    } catch (error) {
      return throwStudyError(error, "Failed to update flashcard set", 500);
    }
  }

  @Delete("sets/:id")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Flashcard set deleted successfully")
  async deleteSet(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw apiHttpException("Unauthorized", {}, HttpStatus.UNAUTHORIZED);
    }
    const parsed = await deleteSetSchema.safeParseAsync({ params: { id } });
    if (!parsed.success) throw validationException(parsed.error.issues);

    try {
      return await this.study.deleteSet(parsed.data.params.id, userId);
    } catch (error) {
      return throwStudyError(error, "Failed to delete flashcard set", 500);
    }
  }

  @Post("sets/:id/cards/bulk")
  @UseGuards(JwtAuthGuard, HeavyRateLimitGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiMessage("Cards added successfully")
  async addCardsToSet(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw apiHttpException("Unauthorized", {}, HttpStatus.UNAUTHORIZED);
    }
    const parsed = await addCardsToSetSchema.safeParseAsync({
      params: { id },
      body,
    });
    if (!parsed.success) throw validationException(parsed.error.issues);

    try {
      return await this.study.addCardsToSet(
        parsed.data.params.id,
        userId,
        parsed.data.body.cards.map(toCreateCardInput),
      );
    } catch (error) {
      return throwStudyError(error, "Failed to add cards", 500);
    }
  }

  @Post("sets/:id/quiz")
  @UseGuards(OptionalJwtAuthGuard, HeavyRateLimitGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Quiz generated successfully")
  async generateQuiz(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const abort = createAbortSignal(reply);
    try {
      const parsed = await generateQuizSchema.safeParseAsync({
        params: { id },
        query,
      });
      if (!parsed.success) throw validationException(parsed.error.issues);

      const questions = await this.study.generateQuiz(
        parsed.data.params.id,
        parsed.data.query.limit,
        request.user?.id,
        abort.signal,
      );
      return {
        setId: parsed.data.params.id,
        questionCount: questions.length,
        questions,
      };
    } catch (error) {
      if (abort.signal.aborted || isAbortError(error)) return;
      return throwStudyError(error, "Failed to generate quiz", 500);
    } finally {
      abort.cleanup();
    }
  }

  @Post("study/submit-answer")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Answer recorded successfully")
  async submitAnswer(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw apiHttpException("Unauthorized", {}, HttpStatus.UNAUTHORIZED);
    }
    const parsed = await submitAnswerSchema.safeParseAsync({ body });
    if (!parsed.success) throw validationException(parsed.error.issues);

    try {
      return await this.study.submitAnswer({ userId, ...parsed.data.body });
    } catch (error) {
      return throwStudyError(error, "Failed to record answer", 500);
    }
  }

  @Post("study/submit-answers")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Answers recorded successfully")
  async submitAnswers(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw apiHttpException("Unauthorized", {}, HttpStatus.UNAUTHORIZED);
    }
    const parsed = await submitAnswersSchema.safeParseAsync({ body });
    if (!parsed.success) throw validationException(parsed.error.issues);

    try {
      return await this.study.submitAnswers({ userId, ...parsed.data.body });
    } catch (error) {
      return throwStudyError(error, "Failed to record answers", 500);
    }
  }

  @Post("study/sync-progress")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Study session progress synced to database successfully")
  async syncProgress(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
  ) {
    const userId = request.user?.id;
    if (!userId) {
      throw apiHttpException("Unauthorized", {}, HttpStatus.UNAUTHORIZED);
    }
    const parsed = await syncProgressSchema.safeParseAsync({ body });
    if (!parsed.success) throw validationException(parsed.error.issues);

    try {
      return await this.study.syncProgress(userId, parsed.data.body.sessionId);
    } catch (error) {
      return throwStudyError(
        error,
        "Failed to sync study progress",
        500,
      );
    }
  }
}

@Controller("api/decks/public")
@UseGuards(ApiRateLimitGuard)
export class PublicDeckSearchController {
  constructor(
    @Inject(STUDY_SERVICE) private readonly study: StudyService,
  ) {}

  @Get("search")
  @HttpCode(HttpStatus.OK)
  @ApiMessage("Public decks retrieved successfully")
  async search(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const abort = createAbortSignal(reply);
    try {
      const parsed = await searchPublicDecksSchema.safeParseAsync({ query });
      if (!parsed.success) throw validationException(parsed.error.issues);
      return await this.study.searchPublicDecks(
        parsed.data.query.q,
        parsed.data.query.page,
        parsed.data.query.limit,
        abort.signal,
      );
    } catch (error) {
      if (abort.signal.aborted || isAbortError(error)) return;
      return throwStudyError(
        error,
        "Failed to search public decks",
        500,
      );
    } finally {
      abort.cleanup();
    }
  }
}
