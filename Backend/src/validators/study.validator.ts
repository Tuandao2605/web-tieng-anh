import { z } from "zod";

const cardInputSchema = z.object({
  term: z.string().trim().min(1, "Term is required").max(255),
  definition: z.string().trim().min(1, "Definition is required").max(2000),
  audioUrl: z.string().url().optional().or(z.literal("")),
  exampleSentence: z.string().optional(),
  imageUrl: z.string().url().optional().or(z.literal("")),
});

export const createSetSchema = z.object({
  body: z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().optional(),
    isPublic: z.boolean().default(true),
    cards: z.array(cardInputSchema).min(1, "Must contain at least 1 card"),
  }),
});

export const updateSetSchema = z.object({
  params: z.object({
    id: z.string().length(24, "Set ID must be a MongoDB ObjectId"),
  }),
  body: createSetSchema.shape.body.extend({
    cards: z
      .array(
        cardInputSchema.extend({
          id: z
            .string()
            .length(24, "Card ID must be a MongoDB ObjectId")
            .optional(),
        }),
      )
      .min(1, "Must contain at least 1 card")
      .max(500, "Can only update up to 500 cards at a time"),
  }),
});

export const addCardsToSetSchema = z.object({
  params: z.object({
    id: z.string().length(24, "Set ID must be a MongoDB ObjectId"),
  }),
  body: z.object({
    cards: z
      .array(cardInputSchema)
      .min(1, "Must contain at least 1 card")
      .max(200, "Can only add up to 200 cards at a time"),
  }),
});

export const generateQuizSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Set ID is required"),
  }),
  query: z.object({
    limit: z
      .string()
      .optional()
      .transform((val: string | undefined) =>
        val ? parseInt(val, 10) : 10,
      ),
  }),
});

export const searchPublicDecksSchema = z.object({
  query: z.object({
    q: z.string().trim().min(1, "Search keyword is required").max(100),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }),
});

export const submitAnswerSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, "Session ID is required"),
    setId: z.string().length(24, "Set ID must be a MongoDB ObjectId"),
    mode: z.string().min(1, "Study mode is required").default("QUIZ"),
    cardId: z.string().length(24, "Card ID must be a MongoDB ObjectId"),
    isCorrect: z.boolean(),
    userAnswer: z.string().optional(),
  }),
});

export const submitAnswersSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, "Session ID is required"),
    setId: z.string().length(24, "Set ID must be a MongoDB ObjectId"),
    mode: z.string().min(1, "Study mode is required").default("QUIZ"),
    answers: z
      .array(
        z.object({
          cardId: z.string().length(24, "Card ID must be a MongoDB ObjectId"),
          isCorrect: z.boolean(),
        }),
      )
      .min(1, "At least one answer is required")
      .max(500),
  }),
});

export const syncProgressSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, "Session ID is required"),
  }),
});
