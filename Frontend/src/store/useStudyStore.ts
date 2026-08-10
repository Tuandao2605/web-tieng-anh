import { create } from 'zustand';
import type { FlashcardSet, QuizQuestion, SubmitAnswerResult, CreateSetInput } from '../types';
import { apiClient } from '../api/apiClient';

interface StudyState {
  currentSet: FlashcardSet | null;
  quizQuestions: QuizQuestion[];
  currentSessionId: string;
  currentCardIndex: number;
  correctCount: number;
  wrongCount: number;
  isLoading: boolean;
  isSyncing: boolean;
  error: string | null;

  fetchSet: (setId: string) => Promise<FlashcardSet>;
  createSet: (input: CreateSetInput) => Promise<FlashcardSet>;
  updateSet: (setId: string, input: CreateSetInput) => Promise<FlashcardSet>;
  generateQuiz: (setId: string, limit?: number) => Promise<QuizQuestion[]>;
  startNewSession: (setId: string, mode?: string) => void;
  submitAnswer: (cardId: string, isCorrect: boolean) => Promise<SubmitAnswerResult | null>;
  syncProgress: () => Promise<any>;
  setCurrentCardIndex: (index: number) => void;
  resetSession: () => void;
}

const generateUUID = () => {
  return 'sess_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
};

export const useStudyStore = create<StudyState>((set, get) => ({
  currentSet: null,
  quizQuestions: [],
  currentSessionId: generateUUID(),
  currentCardIndex: 0,
  correctCount: 0,
  wrongCount: 0,
  isLoading: false,
  isSyncing: false,
  error: null,

  fetchSet: async (setId: string) => {
    set({ isLoading: true, error: null });
    try {
      const data: FlashcardSet = await apiClient.get(`/sets/${setId}`);
      set({ currentSet: data, isLoading: false });
      return data;
    } catch (err: any) {
      set({ error: err.message || 'Không thể tải bộ từ vựng', isLoading: false });
      throw err;
    }
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

  generateQuiz: async (setId: string, limit: number = 10) => {
    set({ isLoading: true, error: null });
    try {
      const response: any = await apiClient.post(`/sets/${setId}/quiz?limit=${limit}`);
      const questions: QuizQuestion[] = response?.questions ?? (Array.isArray(response) ? response : []);
      
      const newSessionId = generateUUID();
      set({
        quizQuestions: questions,
        currentSessionId: newSessionId,
        currentCardIndex: 0,
        correctCount: 0,
        wrongCount: 0,
        isLoading: false,
      });
      return questions;
    } catch (err: any) {
      set({ error: err.message || 'Không thể tạo bài trắc nghiệm', isLoading: false });
      throw err;
    }
  },

  startNewSession: (_setId: string, _mode = 'FLASHCARD') => {
    set({
      currentSessionId: generateUUID(),
      currentCardIndex: 0,
      correctCount: 0,
      wrongCount: 0,
    });
  },

  submitAnswer: async (cardId: string, isCorrect: boolean) => {
    const { currentSessionId } = get();
    try {
      const result: SubmitAnswerResult = await apiClient.post('/study/submit-answer', {
        sessionId: currentSessionId,
        cardId,
        isCorrect,
      });

      set((state) => ({
        correctCount: isCorrect ? state.correctCount + 1 : state.correctCount,
        wrongCount: !isCorrect ? state.wrongCount + 1 : state.wrongCount,
      }));

      return result;
    } catch (err) {
      console.warn('Failed to submit answer to Redis cache:', err);
      // Fallback local update even if offline
      set((state) => ({
        correctCount: isCorrect ? state.correctCount + 1 : state.correctCount,
        wrongCount: !isCorrect ? state.wrongCount + 1 : state.wrongCount,
      }));
      return null;
    }
  },

  syncProgress: async () => {
    const { currentSessionId } = get();
    if (!currentSessionId) return null;

    set({ isSyncing: true });
    try {
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

  setCurrentCardIndex: (index: number) => set({ currentCardIndex: index }),

  resetSession: () =>
    set({
      currentCardIndex: 0,
      correctCount: 0,
      wrongCount: 0,
      currentSessionId: generateUUID(),
    }),
}));
