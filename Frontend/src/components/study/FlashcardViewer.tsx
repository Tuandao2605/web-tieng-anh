import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle, ChevronLeft, ChevronRight, Keyboard, Sparkles, XCircle,
} from 'lucide-react';
import type { Card } from '../../types';

export interface FlashcardViewerProps {
  cards: Card[];
  currentIndex: number;
  onIndexChange: (newIndex: number) => void;
  onSubmitAnswer?: (cardId: string, isCorrect: boolean) => Promise<void>;
  onFinish?: () => void;
  correctCount?: number;
  wrongCount?: number;
}

type ExitDirection = 'left' | 'right' | null;

export const FlashcardViewer: React.FC<FlashcardViewerProps> = ({
  cards, currentIndex, onIndexChange, onSubmitAnswer, onFinish,
  correctCount = 0, wrongCount = 0,
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [exitDirection, setExitDirection] = useState<ExitDirection>(null);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentCard = cards[currentIndex];
  const totalCards = cards.length;
  const isTransitioning = exitDirection !== null;

  // Mỗi thẻ luôn bắt đầu ở mặt trước, kể cả khi chỉ số bị đổi từ bên ngoài.
  useEffect(() => {
    setIsFlipped(false);
  }, [currentCard?.id]);

  useEffect(() => () => {
    if (transitionTimer.current) clearTimeout(transitionTimer.current);
  }, []);

  const flipCard = useCallback(() => {
    if (!isTransitioning) setIsFlipped((flipped) => !flipped);
  }, [isTransitioning]);

  const moveCard = useCallback((direction: 'next' | 'prev') => {
    if (isSubmitting || isTransitioning) return;
    if (direction === 'prev' && currentIndex === 0) return;

    setExitDirection(direction === 'next' ? 'left' : 'right');
    transitionTimer.current = setTimeout(() => {
      setIsFlipped(false);
      setExitDirection(null);
      if (direction === 'next') {
        if (currentIndex + 1 < totalCards) onIndexChange(currentIndex + 1);
        else onFinish?.();
      } else {
        onIndexChange(currentIndex - 1);
      }
    }, 250);
  }, [currentIndex, isSubmitting, isTransitioning, onFinish, onIndexChange, totalCards]);

  const markStatus = useCallback(async (isCorrect: boolean) => {
    if (!currentCard || isSubmitting || isTransitioning) return;
    setIsSubmitting(true);
    try {
      await onSubmitAnswer?.(currentCard.id, isCorrect);
      setExitDirection(isCorrect ? 'left' : 'right');
      transitionTimer.current = setTimeout(() => {
        setIsFlipped(false);
        setExitDirection(null);
        setIsSubmitting(false);
        if (currentIndex + 1 < totalCards) onIndexChange(currentIndex + 1);
        else onFinish?.();
      }, 250);
    } catch (error) {
      console.error('Không thể lưu kết quả thẻ', error);
      setIsSubmitting(false);
    }
  }, [currentCard, currentIndex, isSubmitting, isTransitioning, onFinish, onIndexChange, onSubmitAnswer, totalCards]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault(); flipCard();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault(); moveCard('prev');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault(); moveCard('next');
      } else if (key === '1' || key === 'n') {
        event.preventDefault(); void markStatus(false);
      } else if (key === '2' || key === 'm') {
        event.preventDefault(); void markStatus(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [flipCard, markStatus, moveCard]);

  if (!currentCard) {
    return <div className="glass-panel p-12 rounded-2xl text-center text-slate-400">Không có thẻ từ vựng nào để hiển thị.</div>;
  }

  const progress = Math.round(((currentIndex + 1) / totalCards) * 100);
  const cardFaceClass = 'flip-card-face glass-panel rounded-3xl p-8 flex flex-col justify-between items-center text-center shadow-2xl overflow-hidden group';

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 select-none">
      <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
        <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700/80 text-indigo-300">Thẻ {currentIndex + 1} / {totalCards} ({progress}%)</span>
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="flex items-center gap-1 text-green-400"><CheckCircle className="w-3.5 h-3.5" />Đã thuộc: {correctCount}</span>
          <span className="flex items-center gap-1 text-red-400"><XCircle className="w-3.5 h-3.5" />Cần ôn: {wrongCount}</span>
        </div>
      </div>
      <div className="h-2 overflow-hidden rounded-full border border-slate-700/50 bg-slate-800/80"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 transition-all duration-300" style={{ width: `${progress}%` }} /></div>

      <div className={`perspective-1000 min-h-[320px] sm:min-h-[380px] ${exitDirection ? `card-exit-${exitDirection}` : 'card-enter'}`}>
        <div
          role="button" tabIndex={0} aria-label={isFlipped ? 'Lật về mặt trước' : 'Lật xem nghĩa'} aria-pressed={isFlipped}
          onClick={flipCard}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); flipCard(); } }}
          className={`flip-card min-h-[320px] sm:min-h-[380px] cursor-pointer rounded-3xl transition-transform duration-500 ease-out ${isFlipped ? 'rotate-y-180' : ''}`}
        >
          <div className={`${cardFaceClass} border border-slate-700/70`}>
            <div className="w-full"><span className="text-[11px] font-extrabold uppercase tracking-widest text-indigo-400">Thuật ngữ</span></div>
            <div className="my-auto py-4 flex flex-col items-center gap-4">{currentCard.imageUrl && <img src={currentCard.imageUrl} alt={currentCard.term} className="w-32 h-32 rounded-2xl object-cover border border-slate-700" />}<h2 className="text-3xl sm:text-4xl font-black text-slate-100">{currentCard.term}</h2></div>
            <span className="flex items-center gap-1.5 text-xs text-slate-500 group-hover:text-indigo-300"><Sparkles className="w-3.5 h-3.5" />Nhấn vào thẻ để xem nghĩa</span>
          </div>
          <div className={`${cardFaceClass} back bg-gradient-to-b from-indigo-950/60 via-slate-900/80 to-slate-950/80 border border-indigo-500/40`}>
            <div className="w-full"><span className="text-[11px] font-extrabold uppercase tracking-widest text-purple-300">Định nghĩa</span></div>
            <div className="my-auto py-4 space-y-4 max-w-lg"><p className="text-2xl sm:text-3xl font-extrabold text-slate-100 leading-relaxed">{currentCard.definition}</p>{currentCard.exampleSentence && <p className="p-3.5 rounded-2xl bg-indigo-900/20 border border-indigo-500/20 text-indigo-200 text-sm italic">“{currentCard.exampleSentence}”</p>}</div>
            <span className="text-xs text-slate-500 group-hover:text-purple-300">Nhấn để lật lại mặt trước</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <button type="button" onClick={() => void markStatus(false)} disabled={isSubmitting || isTransitioning} className="flex justify-center gap-2 py-4 rounded-2xl font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 disabled:opacity-50"><XCircle className="w-5 h-5" />Chưa thuộc <span className="hidden sm:inline text-xs font-normal">(1/N)</span></button>
        <button type="button" onClick={() => void markStatus(true)} disabled={isSubmitting || isTransitioning} className="flex justify-center gap-2 py-4 rounded-2xl font-bold text-green-300 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 disabled:opacity-50"><CheckCircle className="w-5 h-5" />Đã thuộc <span className="hidden sm:inline text-xs font-normal">(2/M)</span></button>
      </div>
      <div className="flex items-center justify-between pt-2"><button type="button" onClick={() => moveCard('prev')} disabled={currentIndex === 0 || isSubmitting || isTransitioning} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs disabled:opacity-30"><ChevronLeft className="w-4 h-4" />Thẻ trước</button><span className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500"><Keyboard className="w-3.5 h-3.5 text-indigo-400" />Space: lật • ← →: chuyển thẻ</span><button type="button" onClick={() => moveCard('next')} disabled={isSubmitting || isTransitioning} className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-xs disabled:opacity-30">Thẻ tiếp<ChevronRight className="w-4 h-4" /></button></div>
    </div>
  );
};
