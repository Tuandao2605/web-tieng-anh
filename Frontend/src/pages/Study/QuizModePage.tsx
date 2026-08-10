import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Zap } from 'lucide-react';
import { useStudyStore } from '../../store/useStudyStore';
import { QuizEngine } from '../../components/study/QuizEngine';

const QUIZ_LIMIT = 10;

export const QuizModePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentSet,
    quizQuestions,
    generateQuiz,
    startNewSession,
    submitAnswer,
    syncProgress,
    resetSession,
    isLoading,
  } = useStudyStore();

  useEffect(() => {
    if (!id) return;
    startNewSession(id, 'QUIZ');
    generateQuiz(id, QUIZ_LIMIT).catch(() => {
      console.warn('Failed to load quiz questions');
    });

    return () => resetSession();
  }, [id]);

  const handleSubmitAnswer = async (cardId: string, isCorrect: boolean) => {
    await submitAnswer(cardId, isCorrect);
  };

  const handleSyncProgress = async () => {
    try {
      await syncProgress();
      if (id) {
        navigate(`/set/${id}`);
      }
    } catch (err) {
      console.error('Error syncing progress:', err);
    }
  };

  const handleRestartQuiz = () => {
    resetSession();
    if (id) {
      generateQuiz(id, QUIZ_LIMIT);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Navigation Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(`/set/${id}`)}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Thoát Trắc Nghiệm
        </button>

        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-xs text-slate-300">
          <Zap className="w-3.5 h-3.5 text-violet-400" />
          <span className="font-semibold">{currentSet?.title || 'Bài trắc nghiệm'}</span>
        </div>
      </div>

      {/* Quiz Engine Component */}
      <QuizEngine
        questions={quizQuestions}
        setId={id || ''}
        onSubmitAnswer={handleSubmitAnswer}
        onSyncProgress={handleSyncProgress}
        onRestartQuiz={handleRestartQuiz}
        isLoading={isLoading}
      />
    </div>
  );
};
