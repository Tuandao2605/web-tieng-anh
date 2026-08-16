import { create } from 'zustand';
import type { FlashcardSet, QuizQuestion, SubmitAnswerResult, CreateSetInput, CreateCardInput } from '../types';
import { apiClient } from '../api/apiClient';

type PendingAnswer = {
  cardId: string;
  isCorrect: boolean;
};

interface StudyState {
  currentSet: FlashcardSet | null;
  quizQuestions: QuizQuestion[];
  currentSessionId: string;
  currentSessionSetId: string;
  currentSessionMode: string;
  currentCardIndex: number;
  correctCount: number;
  wrongCount: number;
  pendingAnswers: PendingAnswer[];
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;

  fetchSet: (setId: string) => Promise<FlashcardSet>;
  createSet: (input: CreateSetInput) => Promise<FlashcardSet>;
  updateSet: (setId: string, input: CreateSetInput) => Promise<FlashcardSet>;
  addCardsToSet: (setId: string, cards: CreateCardInput[]) => Promise<FlashcardSet>;
  generateQuiz: (setId: string, limit?: number) => Promise<QuizQuestion[]>;
  startNewSession: (setId: string, mode?: string) => void;
  submitAnswer: (cardId: string, isCorrect: boolean) => Promise<SubmitAnswerResult | null>;
  syncProgress: () => Promise<any>;
  setCurrentCardIndex: (index: number) => void;
  resetSession: () => void;
  bulkAddCards: (setId: string, cards: CreateCardInput[]) => Promise<FlashcardSet>;
}

const generateUUID = () => {
  return 'sess_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
};

// React Strict Mode và điều hướng có thể mount hai component cùng lúc.
// Map này bảo đảm mỗi set chỉ có một request đang bay.
const inFlightSetRequests = new Map<string, Promise<FlashcardSet>>();
const inFlightQuizRequests = new Map<string, Promise<QuizQuestion[]>>();

export const useStudyStore = create<StudyState>((set, get) => ({
  currentSet: null,
  quizQuestions: [],
  currentSessionId: generateUUID(),
  currentSessionSetId: '',
  currentSessionMode: 'QUIZ',
  currentCardIndex: 0,
  correctCount: 0,
  wrongCount: 0,
  pendingAnswers: [],
  isLoading: false,
  isSyncing: false,
  error: null,

  fetchSet: async (setId: string) => {
    const cachedSet = get().currentSet;
    if (cachedSet?.id === setId) return cachedSet;

    const inFlight = inFlightSetRequests.get(setId);
    if (inFlight) return inFlight;

    set({ isLoading: true, error: null });
    const request: Promise<FlashcardSet> = apiClient.get(`/sets/${setId}`)
      .then((data) => {
        const setData = data as unknown as FlashcardSet;
        set({ currentSet: setData, isLoading: false });
        return setData;
      })
      .catch((err: any) => {
        set({ error: err.message || 'Không thể tải bộ từ vựng', isLoading: false });
        throw err;
      })
      .finally(() => inFlightSetRequests.delete(setId));
    inFlightSetRequests.set(setId, request);
    return request;
  },

  createSet: async (input: CreateSetInput) => {
    set({ isLoading: true, error: null });
    try {
      const newSet: FlashcardSet = await apiClient.post('/sets', input);
      set({ currentSet: newSet, isLoading: false });
      return newSet;
    } catch (err: any) {
      set({ error: err.message || 'Tạo bộ thẻ thất bại', isLoading: false });
      throw err;
    }
  },

  updateSet: async (setId: string, input: CreateSetInput) => {
    set({ isLoading: true, error: null });
    try {
      const updatedSet: FlashcardSet = await apiClient.put(`/sets/${setId}`, input);
      set({ currentSet: updatedSet, isLoading: false });
      return updatedSet;
    } catch (err: any) {
      set({ error: err.message || 'Cập nhật bộ thẻ thất bại', isLoading: false });
      throw err;
    }
  },

  addCardsToSet: async (setId: string, cards: CreateCardInput[]) => {
    set({ error: null });
    try {
      const updatedSet: FlashcardSet = await apiClient.post(`/sets/${setId}/cards/bulk`, { cards });
      set({ currentSet: updatedSet });
      return updatedSet;
    } catch (err: any) {
      set({ error: err.message || 'Thêm thẻ thất bại' });
      throw err;
    }
  },

  generateQuiz: async (setId: string, limit: number = 10) => {
    const requestKey = `${setId}:${limit}`;
    const inFlight = inFlightQuizRequests.get(requestKey);
    if (inFlight) return inFlight;

    set({ isLoading: true, error: null });
    const request: Promise<QuizQuestion[]> = apiClient.post(`/sets/${setId}/quiz?limit=${limit}`)
      .then((response) => {
        const payload = response as unknown as { questions?: QuizQuestion[] } | QuizQuestion[];
        const questions = Array.isArray(payload) ? payload : payload.questions ?? [];
        set({
          quizQuestions: questions,
          currentCardIndex: 0,
          correctCount: 0,
          wrongCount: 0,
          isLoading: false,
        });
        return questions;
      })
      .catch((err: any) => {
        set({ error: err.message || 'Không thể tạo bài trắc nghiệm', isLoading: false });
        throw err;
      })
      .finally(() => inFlightQuizRequests.delete(requestKey));
    inFlightQuizRequests.set(requestKey, request);
    return request;
  },

  startNewSession: (setId: string, mode = 'FLASHCARD') => {
    set({
      currentSessionId: generateUUID(),
      currentSessionSetId: setId,
      currentSessionMode: mode,
      currentCardIndex: 0,
      correctCount: 0,
      wrongCount: 0,
    });
  },

  submitAnswer: async (cardId: string, isCorrect: boolean) => {
    // Chỉ cập nhật UI và bộ đệm cục bộ. Toàn bộ đáp án được gửi một lần lúc sync.
    set((state) => ({
      pendingAnswers: [...state.pendingAnswers, { cardId, isCorrect }],
      correctCount: isCorrect ? state.correctCount + 1 : state.correctCount,
      wrongCount: !isCorrect ? state.wrongCount + 1 : state.wrongCount,
    }));
    return null;
  },

  syncProgress: async () => {
    const { currentSessionId, currentSessionSetId, currentSessionMode, pendingAnswers } = get();
    if (!currentSessionId) return null;

    set({ isSyncing: true });
    try {
      if (pendingAnswers.length > 0) {
        await apiClient.post('/study/submit-answers', {
          sessionId: currentSessionId,
          setId: currentSessionSetId,
          mode: currentSessionMode,
          answers: pendingAnswers,
        });
        // Chỉ xóa đúng batch đã gửi, tránh mất đáp án được thêm trong lúc chờ mạng.
        set((state) => ({
          pendingAnswers: state.pendingAnswers.filter((answer) => !pendingAnswers.includes(answer)),
        }));
      }
      const syncedSession = await apiClient.post('/study/sync-progress', {
        sessionId: currentSessionId,
      });
      set({ isSyncing: false });
      return syncedSession;
    } catch (err: any) {
      set({ isSyncing: false });
      console.error('Failed to sync study session to DB:', err);
      throw err;
    }
  },

  bulkAddCards: async (setId: string, cards: CreateCardInput[]) => {
    return get().addCardsToSet(setId, cards);
  },

  setCurrentCardIndex: (index: number) => set({ currentCardIndex: index }),

  resetSession: () =>
    set({
      currentCardIndex: 0,
      correctCount: 0,
      wrongCount: 0,
      pendingAnswers: [],
      currentSessionId: generateUUID(),
      currentSessionSetId: '',
      currentSessionMode: 'QUIZ',
    }),
}));
