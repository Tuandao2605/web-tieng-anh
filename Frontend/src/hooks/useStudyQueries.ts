import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/apiClient';
import type { FlashcardSet, SubmitAnswerResult } from '../types';

// ==========================================
// Payload Types
// ==========================================

export interface SubmitAnswerPayload {
  sessionId: string;
  cardId: string;
  isCorrect: boolean;
}

export interface SyncProgressPayload {
  sessionId: string;
}

export interface OptimisticAnswerContext {
  previousSet?: FlashcardSet;
  optimisticSummary?: {
    correctCount: number;
    wrongCount: number;
  };
}

// Query Keys Factory
export const QueryKeys = {
  flashcardSet: (setId: string) => ['flashcardSet', setId] as const,
  allSets: ['flashcardSets'] as const,
  studySession: (sessionId: string) => ['studySession', sessionId] as const,
};

// ==========================================
// 1. useFlashcardSet(setId)
// Fetch flashcard set with caching & auto-retry
// ==========================================
export function useFlashcardSet(setId: string | undefined) {
  return useQuery<FlashcardSet, Error>({
    queryKey: QueryKeys.flashcardSet(setId || ''),
    queryFn: async () => {
      if (!setId) throw new Error('setId is required');
      const data = await apiClient.get(`/sets/${setId}`);
      return data as unknown as FlashcardSet;
    },
    enabled: Boolean(setId),
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 15,    // 15 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });
}

// ==========================================
// 2. useSubmitAnswer()
// Mutation with Optimistic Updates (UI updates immediately)
// ==========================================
export function useSubmitAnswer(setId?: string) {
  const queryClient = useQueryClient();

  return useMutation<
    SubmitAnswerResult,
    Error,
    SubmitAnswerPayload,
    OptimisticAnswerContext
  >({
    mutationFn: async (payload: SubmitAnswerPayload) => {
      const data = await apiClient.post('/study/submit-answer', payload);
      return data as unknown as SubmitAnswerResult;
    },

    // OPTIMISTIC UPDATE: Executed right before calling the API
    onMutate: async (_newAnswer: SubmitAnswerPayload) => {
      // Cancel any ongoing refetches for this set so they don't overwrite optimistic update
      if (setId) {
        await queryClient.cancelQueries({ queryKey: QueryKeys.flashcardSet(setId) });
      }

      // Snapshot previous query data for rollback if server call fails
      const previousSet = setId
        ? queryClient.getQueryData<FlashcardSet>(QueryKeys.flashcardSet(setId))
        : undefined;

      // Optimistically update cache data if needed
      if (setId && previousSet) {
        queryClient.setQueryData<FlashcardSet>(QueryKeys.flashcardSet(setId), (old) => {
          if (!old) return old;
          return {
            ...old,
          };
        });
      }

      // Return context containing previous data to rollback on error
      return { previousSet };
    },

    // ROLLBACK: Executed if server returns an error
    onError: (err, _newAnswer, context) => {
      console.error('Submit answer API failed, rolling back optimistic update:', err);
      if (setId && context?.previousSet) {
        queryClient.setQueryData(QueryKeys.flashcardSet(setId), context.previousSet);
      }
    },

    // RE-SYNC: Refetch/invalidate queries after mutation completes (success or fail)
    onSettled: (_data, _error, _variables) => {
      if (setId) {
        queryClient.invalidateQueries({ queryKey: QueryKeys.flashcardSet(setId) });
      }
    },
  });
}

// ==========================================
// 3. useSyncProgress()
// Mutation to sync Redis progress session to PostgreSQL DB
// ==========================================
export function useSyncProgress() {
  const queryClient = useQueryClient();

  return useMutation<any, Error, SyncProgressPayload>({
    mutationFn: async (payload: SyncProgressPayload) => {
      const response = await apiClient.post('/study/sync-progress', payload);
      return response;
    },

    onSuccess: (_data, _variables) => {
      // Invalidate all sets & dashboard stats to reflect newly synced progress
      queryClient.invalidateQueries({ queryKey: QueryKeys.allSets });
    },

    onError: (error) => {
      console.error('Failed to sync study session to database:', error);
    },
  });
}
