import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Volume2, ChevronLeft, ChevronRight,
  CheckCircle, XCircle, Sparkles, Keyboard
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

export const FlashcardViewer: React.FC<FlashcardViewerProps> = ({
  cards,
  currentIndex,
  onIndexChange,
  onSubmitAnswer,
  onFinish,
  correctCount = 0,
  wrongCount = 0,
}) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cardAnimation, setCardAnimation] = useState<'enter' | 'exit-left' | 'exit-right' | ''>('enter');
  const cardRef = useRef<HTMLDivElement>(null);

  const currentCard = cards[currentIndex];
  const totalCards = cards.length;

  // Text-to-Speech / Audio player function
  const speakTerm = useCallback(
    (e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      if (!currentCard) return;

      // If backend audioUrl exists, play it
      if (currentCard.audioUrl) {
        const audio = new Audio(currentCard.audioUrl);
        setIsSpeaking(true);
        audio.play().finally(() => setIsSpeaking(false));
        return;
      }

      // Fallback: Web Speech API (window.speechSynthesis)
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel(); // Stop current speech
        const utterance = new SpeechSynthesisUtterance(currentCard.term);
        utterance.lang = 'en-US';
        utterance.rate = 0.9;
        
        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        window.speechSynthesis.speak(utterance);
      }
    },
    [currentCard]
  );

  // Toggle card flip
  const handleFlip = useCallback(() => {
    setIsFlipped((prev) => !prev);
  }, []);

  // Change Card with animation
  const changeCard = useCallback(
    (direction: 'next' | 'prev') => {
      if (isSubmitting) return;

      const anim = direction === 'next' ? 'exit-left' : 'exit-right';
      setCardAnimation(anim);

      setTimeout(() => {
        setIsFlipped(false);
        if (direction === 'next') {
          if (currentIndex + 1 < totalCards) {
            onIndexChange(currentIndex + 1);
          } else if (onFinish) {
            onFinish();
          }
        } else {
          if (currentIndex > 0) {
            onIndexChange(currentIndex - 1);
          }
        }
        setCardAnimation('enter');
      }, 250);
    },
    [currentIndex, totalCards, onIndexChange, onFinish, isSubmitting]
  );

  // Handle Submit Answer ("Chưa thuộc" / "Đã thuộc")
  const handleMarkStatus = useCallback(
    async (isCorrect: boolean) => {
      if (!currentCard || isSubmitting) return;

      setIsSubmitting(true);
      if (onSubmitAnswer) {
        await onSubmitAnswer(currentCard.id, isCorrect);
      }

      const anim = isCorrect ? 'exit-left' : 'exit-right';
      setCardAnimation(anim);

      setTimeout(() => {
        setIsFlipped(false);
        setIsSubmitting(false);
        if (currentIndex + 1 < totalCards) {
          onIndexChange(currentIndex + 1);
        } else if (onFinish) {
          onFinish();
        }
        setCardAnimation('enter');
      }, 250);
    },
    [currentCard, isSubmitting, onSubmitAnswer, currentIndex, totalCards, onIndexChange, onFinish]
  );

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing inside an input or textarea
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      switch (e.key) {
        case ' ': // Space bar flips card
        case 'ArrowUp':
        case 'ArrowDown':
          e.preventDefault();
          handleFlip();
          break;
        case 'ArrowLeft': // Prev card
          e.preventDefault();
          changeCard('prev');
          break;
        case 'ArrowRight': // Next card
          e.preventDefault();
          changeCard('next');
          break;
        case '1': // Key 1 or 'n': Need review (Chưa thuộc)
        case 'n':
        case 'N':
          e.preventDefault();
          handleMarkStatus(false);
          break;
        case '2': // Key 2 or 'm': Mastered (Đã thuộc)
        case 'm':
        case 'M':
          e.preventDefault();
          handleMarkStatus(true);
          break;
        case 's': // Key 's': Audio pronounce
        case 'S':
          e.preventDefault();
          speakTerm();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleFlip, changeCard, handleMarkStatus, speakTerm]);

  if (!currentCard || totalCards === 0) {
    return (
      <div className="glass-panel p-12 rounded-2xl text-center text-slate-400">
        Không có thẻ từ vựng nào để hiển thị.
      </div>
    );
  }

  const progressPercent = Math.round(((currentIndex + 1) / totalCards) * 100);

  return (
    <div className="w-full max-w-3xl mx-auto space-y-6 select-none">
      {/* Top Bar: Progress & Statistics */}
      <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
        <div className="flex items-center gap-3">
          <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700/80 text-indigo-300">
            Thẻ {currentIndex + 1} / {totalCards}
          </span>
          <span className="text-slate-500 font-medium hidden sm:inline">({progressPercent}%)</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-green-400">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Đã thuộc: {correctCount}</span>
          </div>
          <div className="flex items-center gap-1.5 text-red-400">
            <XCircle className="w-3.5 h-3.5" />
            <span>Cần ôn: {wrongCount}</span>
          </div>
        </div>
      </div>

      {/* Progress Bar Line */}
      <div className="w-full bg-slate-800/80 rounded-full h-2 overflow-hidden border border-slate-700/50">
        <div
          className="bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500 h-full rounded-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* 3D Flip Flashcard Main Container */}
      <div className="perspective-1000 w-full min-h-[320px] sm:min-h-[380px] relative">
        <div
          ref={cardRef}
          onClick={handleFlip}
          className={`w-full h-full min-h-[320px] sm:min-h-[380px] cursor-pointer transform-style-3d transition-transform duration-500 relative rounded-3xl ${
            isFlipped ? 'rotate-y-180' : ''
          } ${
            cardAnimation === 'exit-left'
              ? 'card-exit-left'
              : cardAnimation === 'exit-right'
              ? 'card-exit-right'
              : cardAnimation === 'enter'
              ? 'card-enter'
              : ''
          }`}
        >
          {/* MẶT TRƯỚC (Front: Term, Audio, Image) */}
          <div className="absolute inset-0 backface-hidden glass-panel border border-slate-700/70 rounded-3xl p-8 flex flex-col justify-between items-center text-center shadow-2xl overflow-hidden group">
            {/* Top Badge & Audio Action */}
            <div className="w-full flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-indigo-400/90 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20">
                Thuật ngữ (Term)
              </span>

              <button
                type="button"
                onClick={speakTerm}
                title="Phát âm (phím S)"
                className={`relative p-3 rounded-full bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 transition-all ${
                  isSpeaking ? 'audio-ripple text-indigo-200' : ''
                }`}
              >
                <Volume2 className={`w-5 h-5 ${isSpeaking ? 'animate-bounce' : ''}`} />
              </button>
            </div>

            {/* Term Text & Optional Image */}
            <div className="my-auto py-4 flex flex-col items-center gap-4">
              {currentCard.imageUrl && (
                <div className="w-32 h-32 rounded-2xl overflow-hidden border border-slate-700 shadow-md">
                  <img
                    src={currentCard.imageUrl}
                    alt={currentCard.term}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <h2 className="text-3xl sm:text-4xl font-black text-slate-100 tracking-tight leading-snug">
                {currentCard.term}
              </h2>
            </div>

            {/* Bottom Hint */}
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 group-hover:text-indigo-300 transition-colors">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Nhấn vào thẻ hoặc phím [Space] để xem nghĩa</span>
            </div>
          </div>

          {/* MẶT SAU (Back: Definition, Example Sentence) */}
          <div className="absolute inset-0 backface-hidden rotate-y-180 glass-panel bg-gradient-to-b from-indigo-950/60 via-slate-900/80 to-slate-950/80 border border-indigo-500/40 rounded-3xl p-8 flex flex-col justify-between items-center text-center shadow-2xl overflow-hidden group">
            {/* Top Badge */}
            <div className="w-full flex items-center justify-between">
              <span className="text-[11px] font-extrabold uppercase tracking-widest text-purple-300 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/20">
                Định nghĩa (Definition)
              </span>
              <button
                type="button"
                onClick={speakTerm}
                title="Phát âm từ vựng"
                className="p-2.5 rounded-full bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 transition-all"
              >
                <Volume2 className="w-4 h-4" />
              </button>
            </div>

            {/* Definition Content & Example */}
            <div className="my-auto py-4 space-y-4 max-w-lg">
              <p className="text-2xl sm:text-3xl font-extrabold text-slate-100 leading-relaxed">
                {currentCard.definition}
              </p>

              {currentCard.exampleSentence && (
                <div className="p-3.5 rounded-2xl bg-indigo-900/20 border border-indigo-500/20 text-indigo-200 text-xs sm:text-sm italic">
                  "{currentCard.exampleSentence}"
                </div>
              )}
            </div>

            {/* Bottom Hint */}
            <div className="text-xs font-medium text-slate-500 group-hover:text-purple-300 transition-colors">
              Nhấn để lật lại mặt trước
            </div>
          </div>
        </div>
      </div>

      {/* Status Marking Buttons ("Chưa thuộc" & "Đã thuộc") */}
      <div className="grid grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => handleMarkStatus(false)}
          disabled={isSubmitting}
          className="flex items-center justify-center gap-2.5 py-4 px-6 rounded-2xl font-bold text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-400/60 shadow-lg shadow-red-500/5 transition-all transform active:scale-95 text-sm"
        >
          <XCircle className="w-5 h-5 text-red-400" />
          <div className="text-left">
            <div>Chưa thuộc</div>
            <div className="text-[10px] opacity-60 font-normal">Phím 1 hoặc N</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => handleMarkStatus(true)}
          disabled={isSubmitting}
          className="flex items-center justify-center gap-2.5 py-4 px-6 rounded-2xl font-bold text-green-300 bg-green-500/10 hover:bg-green-500/20 border border-green-500/30 hover:border-green-400/60 shadow-lg shadow-green-500/5 transition-all transform active:scale-95 text-sm"
        >
          <CheckCircle className="w-5 h-5 text-green-400" />
          <div className="text-left">
            <div>Đã thuộc</div>
            <div className="text-[10px] opacity-60 font-normal">Phím 2 hoặc M</div>
          </div>
        </button>
      </div>

      {/* Navigation Controls (Prev / Next) & Keyboard Shortcuts Legend */}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => changeCard('prev')}
          disabled={currentIndex === 0 || isSubmitting}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/80 text-slate-300 text-xs font-semibold disabled:opacity-30 transition-all"
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Thẻ trước</span>
        </button>

        {/* Keyboard shortcut hint popup badge */}
        <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500 bg-slate-900/60 px-3 py-1.5 rounded-full border border-slate-800">
          <Keyboard className="w-3.5 h-3.5 text-indigo-400" />
          <span>[← / →] Thẻ • [Space] Lật • [S] Đọc</span>
        </div>

        <button
          type="button"
          onClick={() => changeCard('next')}
          disabled={currentIndex + 1 >= totalCards || isSubmitting}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/80 text-slate-300 text-xs font-semibold disabled:opacity-30 transition-all"
        >
          <span>Thẻ tiếp</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
