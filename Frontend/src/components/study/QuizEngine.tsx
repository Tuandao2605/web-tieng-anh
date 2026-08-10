import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle, XCircle, Volume2, Trophy, RotateCcw,
  Loader2, RefreshCw, AlertCircle
} from 'lucide-react';
import type { QuizQuestion, QuizOption } from '../../types';

export interface QuizEngineProps {
  questions: QuizQuestion[];
  setId: string;
  onSubmitAnswer?: (cardId: string, isCorrect: boolean) => Promise<void>;
  onSyncProgress?: () => Promise<void>;
  onRestartQuiz?: () => void;
  isLoading?: boolean;
}

interface QuestionResult {
  question: QuizQuestion;
  selectedOption: QuizOption | null;
  isCorrect: boolean;
}

export const QuizEngine: React.FC<QuizEngineProps> = ({
  questions,
  onSubmitAnswer,
  onSyncProgress,
  onRestartQuiz,
  isLoading = false,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [answered, setAnswered] = useState(false);
  const [results, setResults] = useState<QuestionResult[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const currentQuestion = questions[currentIndex];
  const totalQuestions = questions.length;

  // Speak Term via Web Speech API or audioUrl
  const speakTerm = useCallback((question: QuizQuestion) => {
    if (question.audioUrl) {
      const audio = new Audio(question.audioUrl);
      setIsSpeaking(true);
      audio.play().finally(() => setIsSpeaking(false));
      return;
    }

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(question.term);
      utterance.lang = 'en-US';
      utterance.rate = 0.9;
      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => setIsSpeaking(false);
      utterance.onerror = () => setIsSpeaking(false);
      window.speechSynthesis.speak(utterance);
    }
  }, []);

  // Auto read word when question appears
  useEffect(() => {
    if (currentQuestion && !isFinished && !answered) {
      speakTerm(currentQuestion);
    }
  }, [currentIndex, currentQuestion, isFinished]);

  // Handle Option Click
  const handleSelectOption = async (optionIndex: number) => {
    if (answered || !currentQuestion) return;

    const chosenOption = currentQuestion.options[optionIndex];
    const isCorrect = chosenOption.isCorrect;

    setSelectedOptionIndex(optionIndex);
    setAnswered(true);

    // Save result to local state
    const newResult: QuestionResult = {
      question: currentQuestion,
      selectedOption: chosenOption,
      isCorrect,
    };
    setResults((prev) => [...prev, newResult]);

    // Send answer to Redis Backend
    if (onSubmitAnswer) {
      try {
        await onSubmitAnswer(currentQuestion.cardId, isCorrect);
      } catch (err) {
        console.warn('Failed to submit answer to backend:', err);
      }
    }

    // Auto advance to next question after 1s delay
    setTimeout(() => {
      if (currentIndex + 1 < totalQuestions) {
        setCurrentIndex((prev) => prev + 1);
        setSelectedOptionIndex(null);
        setAnswered(false);
      } else {
        setIsFinished(true);
      }
    }, 1100);
  };

  // Sync Progress to DB
  const handleSync = async () => {
    if (!onSyncProgress || isSyncing) return;
    setIsSyncing(true);
    try {
      await onSyncProgress();
    } catch (err) {
      console.error('Error syncing progress:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Reset Quiz
  const handleRestart = () => {
    setCurrentIndex(0);
    setSelectedOptionIndex(null);
    setAnswered(false);
    setResults([]);
    setIsFinished(false);
    if (onRestartQuiz) {
      onRestartQuiz();
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
        <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
        <p className="text-sm font-semibold text-slate-400">Đang chuẩn bị câu hỏi trắc nghiệm...</p>
      </div>
    );
  }

  if (!questions || totalQuestions === 0) {
    return (
      <div className="glass-panel p-12 rounded-2xl text-center space-y-4 max-w-md mx-auto">
        <AlertCircle className="w-12 h-12 text-amber-400 mx-auto" />
        <h3 className="text-xl font-bold text-slate-200">Không có đủ câu hỏi</h3>
        <p className="text-sm text-slate-400">
          Bộ từ vựng này chưa đủ số lượng thẻ để khởi tạo bài kiểm tra trắc nghiệm (cần tối thiểu 4 thẻ).
        </p>
      </div>
    );
  }

  // ----------------------------------------------------
  // 3. MÀN HÌNH KẾT QUẢ (SUMMARY VIEW)
  // ----------------------------------------------------
  if (isFinished) {
    const correctCount = results.filter((r) => r.isCorrect).length;
    const wrongCount = totalQuestions - correctCount;
    const accuracy = Math.round((correctCount / totalQuestions) * 100);
    const missedQuestions = results.filter((r) => !r.isCorrect);

    return (
      <div className="max-w-2xl mx-auto space-y-8 py-6">
        {/* Banner Header */}
        <div className="glass-panel rounded-3xl p-8 text-center border border-indigo-500/30 space-y-6 relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-40 h-40 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
          
          <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center shadow-xl shadow-indigo-600/30 border border-indigo-400/40">
            <Trophy className="w-10 h-10 text-yellow-300" />
          </div>

          <div className="space-y-1">
            <h2 className="text-3xl font-black text-slate-100 tracking-tight">Kết Quả Bài Kiểm Tra</h2>
            <p className="text-sm text-slate-400">Bạn đã hoàn thành bài kiểm tra trắc nghiệm!</p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-4 pt-2">
            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800">
              <p className="text-3xl font-black text-indigo-400">{accuracy}%</p>
              <p className="text-xs font-medium text-slate-400 mt-1">Độ chính xác</p>
            </div>
            <div className="p-4 rounded-2xl bg-green-500/10 border border-green-500/20">
              <p className="text-3xl font-bold text-green-400">{correctCount}</p>
              <p className="text-xs font-medium text-green-300/80 mt-1">Trả lời đúng</p>
            </div>
            <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20">
              <p className="text-3xl font-bold text-red-400">{wrongCount}</p>
              <p className="text-xs font-medium text-red-300/80 mt-1">Trả lời sai</p>
            </div>
          </div>
        </div>

        {/* List of Missed Words to Review */}
        {missedQuestions.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-base font-bold text-slate-200 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400" />
              <span>Các từ cần ôn lại ({missedQuestions.length})</span>
            </h3>

            <div className="space-y-2.5">
              {missedQuestions.map((res, i) => (
                <div key={i} className="glass-panel p-4 rounded-2xl border border-red-500/20 flex items-center justify-between">
                  <div>
                    <p className="text-base font-bold text-slate-100">{res.question.term}</p>
                    <p className="text-xs text-red-400 mt-0.5">
                      Đã chọn: <span className="line-through">{res.selectedOption?.definition}</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-medium text-slate-500 block">Đáp án đúng</span>
                    <span className="text-sm font-semibold text-green-400">
                      {res.question.options.find((o) => o.isCorrect)?.definition}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 pt-2">
          <button
            type="button"
            onClick={handleRestart}
            className="flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-2xl font-bold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-all text-sm shadow-md"
          >
            <RotateCcw className="w-4 h-4" />
            Làm lại bài Quiz
          </button>

          {onSyncProgress && (
            <button
              type="button"
              onClick={handleSync}
              disabled={isSyncing}
              className="flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-2xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl shadow-indigo-600/30 transition-all disabled:opacity-60 text-sm"
            >
              {isSyncing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              {isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ tiến độ'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------
  // 1 & 2. MÀN HÌNH LÀM BÀI QUIZ (QUIZ QUESTION ENGINE)
  // ----------------------------------------------------
  const progressPercent = Math.round(((currentIndex + 1) / totalQuestions) * 100);

  return (
    <div className="max-w-2xl mx-auto space-y-6 select-none">
      {/* Top Header & Progress */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-indigo-300">
              Câu {currentIndex + 1} / {totalQuestions}
            </span>
          </div>
          <span className="text-slate-500 font-medium">{progressPercent}%</span>
        </div>

        <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-700/50">
          <div
            className="bg-gradient-to-r from-indigo-500 to-violet-500 h-full rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Question Card Display */}
      <div className="glass-panel border border-slate-700/70 rounded-3xl p-8 text-center space-y-6 shadow-2xl relative">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-indigo-400 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20">
            Chọn nghĩa đúng của từ
          </span>
          <button
            type="button"
            onClick={() => speakTerm(currentQuestion)}
            className={`p-3 rounded-full bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 transition-all ${
              isSpeaking ? 'animate-bounce text-indigo-200' : ''
            }`}
            title="Nghe phát âm"
          >
            <Volume2 className="w-5 h-5" />
          </button>
        </div>

        {/* Term & Optional Image */}
        <div className="py-4 space-y-3">
          {currentQuestion.imageUrl && (
            <div className="w-28 h-28 mx-auto rounded-2xl overflow-hidden border border-slate-700 shadow-md">
              <img src={currentQuestion.imageUrl} alt={currentQuestion.term} className="w-full h-full object-cover" />
            </div>
          )}
          <h2 className="text-3xl sm:text-4xl font-black text-slate-100 tracking-tight">
            {currentQuestion.term}
          </h2>
          {currentQuestion.exampleSentence && (
            <p className="text-xs sm:text-sm text-slate-400 italic max-w-md mx-auto">
              "{currentQuestion.exampleSentence}"
            </p>
          )}
        </div>
      </div>

      {/* 4 Option Buttons */}
      <div className="grid grid-cols-1 gap-3.5">
        {currentQuestion.options.map((option, idx) => {
          let btnStyle = "bg-slate-900/80 border-slate-700/80 hover:bg-slate-800 hover:border-indigo-500/50 text-slate-200";
          let icon = null;

          if (answered) {
            if (option.isCorrect) {
              btnStyle = "bg-green-500/20 border-green-500/80 text-green-200 font-bold shadow-lg shadow-green-500/10";
              icon = <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />;
            } else if (selectedOptionIndex === idx) {
              btnStyle = "bg-red-500/20 border-red-500/80 text-red-200 font-bold shadow-lg shadow-red-500/10";
              icon = <XCircle className="w-5 h-5 text-red-400 shrink-0" />;
            } else {
              btnStyle = "bg-slate-900/40 border-slate-800 text-slate-500 opacity-50";
            }
          }

          return (
            <button
              key={idx}
              type="button"
              onClick={() => handleSelectOption(idx)}
              disabled={answered}
              className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left text-sm sm:text-base font-semibold group ${btnStyle}`}
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <span className="w-7 h-7 rounded-xl bg-slate-800 text-slate-400 text-xs font-bold flex items-center justify-center shrink-0 border border-slate-700/60 group-hover:text-indigo-300">
                  {String.fromCharCode(65 + idx)}
                </span>
                <span className="truncate">{option.definition}</span>
              </div>
              {icon}
            </button>
          );
        })}
      </div>
    </div>
  );
};
