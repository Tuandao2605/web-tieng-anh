// ─── Quiz ─────────────────────────────────────────────────────────────────────

export interface QuizOption {
  definition: string;
  isCorrect: boolean;
}

export interface QuizQuestion {
  cardId: string;
  term: string;
  audioUrl?: string | null;
  exampleSentence?: string | null;
  imageUrl?: string | null;
  options: QuizOption[];
}

// ─── Session / Spaced Repetition ─────────────────────────────────────────────

export type CardStatus = "NEW" | "LEARNING" | "MASTERED";

export interface CardProgressEntry {
  cardId: string;
  streak: number;
  correctCount: number;
  wrongCount: number;
  status: CardStatus;
  nextReviewAt: string; // ISO-8601
  lastReviewedAt: string; // ISO-8601
}

export interface SessionProgressState {
  sessionId: string;
  userId: string;
  setId: string;
  mode: string;
  totalCards: number;
  correctCount: number;
  wrongCount: number;
  cardProgressMap: Record<string, CardProgressEntry>;
}

// ─── Service Inputs ───────────────────────────────────────────────────────────

export interface SubmitAnswerInput {
  userId: string;
  sessionId: string;
  setId: string;
  mode: string;
  cardId: string;
  isCorrect: boolean;
}
