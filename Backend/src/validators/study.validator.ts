import { z } from "zod";

export const createSetSchema = z.object({
  body: z.object({
    title: z.string().min(1, "Title is required").max(255),
    description: z.string().optional(),
    isPublic: z.boolean().default(true),
    cards: z
      .array(
        z.object({
          term: z.string().min(1, "Term is required"),
          definition: z.string().min(1, "Definition is required"),
          audioUrl: z.string().url().optional().or(z.literal("")),
          exampleSentence: z.string().optional(),
          imageUrl: z.string().url().optional().or(z.literal("")),
        })
      )
      .min(1, "Must contain at least 1 card"),
  }),
});

export const generateQuizSchema = z.object({
  params: z.object({
    id: z.string().min(1, "Set ID is required"),
  }),
  query: z.object({
    limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 10)),
  }),
});

export const submitAnswerSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, "Session ID is required"),
    cardId: z.string().min(1, "Card ID is required"),
    isCorrect: z.boolean(),
    userAnswer: z.string().optional(),
  }),
});

export const syncProgressSchema = z.object({
  body: z.object({
    sessionId: z.string().min(1, "Session ID is required"),
  }),
});
