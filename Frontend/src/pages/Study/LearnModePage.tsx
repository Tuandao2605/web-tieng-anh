import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Trophy, Zap } from 'lucide-react';
import { useStudyStore } from '../../store/useStudyStore';
import { FlashcardViewer } from '../../components/study/FlashcardViewer';

type LearnPhase = 'studying' | 'finished';

const FinishedScreen: React.FC<{
  correctCount: number;
  totalCards: number;
  isSyncing: boolean;
  onRestart: () => void;
  onSyncAndFinish: () => void;
}> = ({ correctCount, totalCards, isSyncing, onRestart, onSyncAndFinish }) => {
  const percentage = totalCards > 0 ? Math.round((correctCount / totalCards) * 100) : 0;

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-6 max-w-md mx-auto">
      <div className="p-5 rounded-full bg-indigo-600/20 border border-indigo-500/40">
        <Trophy className="w-14 h-14 text-yellow-400" />
      </div>
      <h2 className="text-3xl font-extrabold text-slate-100">Phiên học hoàn thành!</h2>
      
      <div className="w-full glass-panel rounded-2xl p-6 border border-slate-700/60 flex items-center justify-around">
        <div className="text-center">
          <p className="text-4xl font-black text-indigo-400">{percentage}%</p>
          <p className="text-xs text-slate-400 mt-1">Độ chính xác</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-green-400">{correctCount}</p>
          <p className="text-xs text-slate-400 mt-1">Đã thuộc</p>
        </div>
        <div className="text-center">
          <p className="text-3xl font-bold text-red-400">{totalCards - correctCount}</p>
          <p className="text-xs text-slate-400 mt-1">Cần ôn lại</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 justify-center">
        <button
          onClick={onRestart}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-all text-sm"
        >
          <RotateCcw className="w-4 h-4" />
          Ôn lại từ đầu
        </button>
        <button
          onClick={onSyncAndFinish}
          disabled={isSyncing}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 transition-all disabled:opacity-60 text-sm"
        >
          {isSyncing ? (
            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Trophy className="w-4 h-4" />
          )}
          {isSyncing ? 'Đang lưu...' : 'Lưu kết quả & Hoàn tất'}
        </button>
      </div>
    </div>
  );
};

export const LearnModePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentSet, fetchSet, isLoading,
    currentCardIndex, setCurrentCardIndex,
    correctCount, wrongCount,
    startNewSession, submitAnswer, syncProgress,
    resetSession, isSyncing,
  } = useStudyStore();

  const [phase, setPhase] = useState<LearnPhase>('studying');

  useEffect(() => {
    if (id) {
      fetchSet(id).then(() => {
        startNewSession(id, 'FLASHCARD');
      });
    }
    return () => resetSession();
  }, [id]);

  const cards = currentSet?.cards ?? [];

  const handleSubmitAnswer = async (cardId: string, isCorrect: boolean) => {
    await submitAnswer(cardId, isCorrect);
  };

  const handleSyncAndFinish = async () => {
    try {
      await syncProgress();
    } catch (err) {
      console.error(err);
    } finally {
      navigate(`/set/${id}`);
    }
  };

  const handleRestart = () => {
    resetSession();
    setCurrentCardIndex(0);
    setPhase('studying');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
      </div>
    );
  }

  if (phase === 'finished') {
    return (
      <FinishedScreen
        correctCount={correctCount}
        totalCards={cards.length}
        isSyncing={isSyncing}
        onRestart={handleRestart}
        onSyncAndFinish={handleSyncAndFinish}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(`/set/${id}`)}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Thoát ôn tập
        </button>

        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-800/80 border border-slate-700 text-xs text-slate-300">
          <Zap className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold">{currentSet?.title}</span>
        </div>
      </div>

      {/* Main Flashcard Viewer Component */}
      <FlashcardViewer
        cards={cards}
        currentIndex={currentCardIndex}
        onIndexChange={(newIndex) => setCurrentCardIndex(newIndex)}
        onSubmitAnswer={handleSubmitAnswer}
        onFinish={() => setPhase('finished')}
        correctCount={correctCount}
        wrongCount={wrongCount}
      />
    </div>
  );
};
