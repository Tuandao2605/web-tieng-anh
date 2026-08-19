export interface User {
  id: string;
  email: string;
  name?: string;
  status?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Card {
  id: string;
  setId: string;
  term: string;
  definition: string;
  audioUrl?: string | null;
  exampleSentence?: string | null;
  imageUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface FlashcardSet {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  cards: Card[];
}

/** Lightweight representation returned by GET /sets. */
export interface FlashcardSetSummary {
  id: string;
  userId: string;
  title: string;
  description?: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  cardCount: number;
}

export interface PublicDeckSearchItem {
  id: string;
  title: string;
  description?: string | null;
  cardCount: number;
  author: { id: string; name: string };
  updatedAt: string;
}

export interface PublicDeckSearchResponse {
  decks: PublicDeckSearchItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CreateCardInput {
  /** Present when an existing card is edited; omitted for a newly added card. */
  id?: string;
  term: string;
  definition: string;
  audioUrl?: string;
  exampleSentence?: string;
  imageUrl?: string;
}

export interface CreateSetInput {
  title: string;
  description?: string;
  isPublic?: boolean;
  cards: CreateCardInput[];
}

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

export interface QuizResult {
  setId: string;
  questionCount: number;
  questions: QuizQuestion[];
}

export interface CardProgressState {
  cardId: string;
  streak: number;
  correctCount: number;
  wrongCount: number;
  status: "NEW" | "LEARNING" | "MASTERED";
  nextReviewAt: string;
  lastReviewedAt: string;
}

export interface SubmitAnswerResult {
  sessionId: string;
  cardId: string;
  isCorrect: boolean;
  cardProgress: CardProgressState;
  sessionSummary: {
    correctCount: number;
    wrongCount: number;
  };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface ApiResponse<T = any> {
  success?: boolean;
  message?: string;
  data?: T;
  obj?: {
    success: boolean;
    data: T;
    message: string;
  };
  error?: any;
}
