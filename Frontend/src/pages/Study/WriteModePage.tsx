import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle, PenLine, RotateCcw, Trophy, XCircle } from 'lucide-react';
import { useStudyStore } from '../../store/useStudyStore';
import type { Card } from '../../types';

const normalizeAnswer = (value: string) => value
  .trim()
  .toLocaleLowerCase('en-US')
  .replace(/[’‘]/g, "'")
  .replace(/\s+/g, ' ');

const shuffleCards = (cards: Card[]) => {
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
};

export const WriteModePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentSet, fetchSet, isLoading, currentCardIndex, correctCount, wrongCount,
    startNewSession, submitAnswer, setCurrentCardIndex, resetSession, syncProgress, isSyncing,
  } = useStudyStore();
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<boolean | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [shuffledCards, setShuffledCards] = useState<Card[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void fetchSet(id).then(() => {
      if (!cancelled) startNewSession(id, 'WRITE');
    });
    return () => {
      cancelled = true;
      resetSession();
    };
  }, [id, fetchSet, resetSession, startNewSession]);

  useEffect(() => {
    if (!currentSet) return;
    setShuffledCards(shuffleCards(currentSet.cards));
    setCurrentCardIndex(0);
  }, [currentSet?.id, setCurrentCardIndex]);

  const cards = shuffledCards;
  const card = cards[currentCardIndex];

  useEffect(() => {
    setAnswer('');
    setResult(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [card?.id]);

  const advance = () => {
    if (currentCardIndex + 1 < cards.length) {
      setCurrentCardIndex(currentCardIndex + 1);
    } else {
      setIsFinished(true);
    }
  };

  // Sau khi đã chấm, Enter giúp chuyển nhanh sang thẻ tiếp theo mà không cần dùng chuột.
  useEffect(() => {
    if (result === null) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || (event.target as HTMLElement | null)?.closest('button')) return;
      event.preventDefault();
      advance();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [result, currentCardIndex, cards.length]);

  const checkAnswer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!card || !answer.trim() || result !== null || isSubmitting) return;

    const isCorrect = normalizeAnswer(answer) === normalizeAnswer(card.term);
    setResult(isCorrect);
    setIsSubmitting(true);
    await submitAnswer(card.id, isCorrect);
    setIsSubmitting(false);
  };

  const restart = () => {
    if (!id) return;
    resetSession();
    startNewSession(id, 'WRITE');
    setShuffledCards(shuffleCards(currentSet?.cards ?? []));
    setCurrentCardIndex(0);
    setIsFinished(false);
  };

  const finish = async () => {
    try {
      await syncProgress();
    } finally {
      resetSession();
      navigate(`/set/${id}`);
    }
  };

  if (isLoading) return <div className="flex min-h-[60vh] items-center justify-center"><div className="h-12 w-12 animate-spin rounded-full border-b-2 border-t-2 border-indigo-500" /></div>;

  if (!card && !isFinished) return <div className="glass-panel mx-auto max-w-md rounded-2xl p-12 text-center text-slate-400">Bộ từ vựng chưa có thẻ để luyện viết.</div>;

  if (isFinished) {
    const total = cards.length;
    const accuracy = total ? Math.round((correctCount / total) * 100) : 0;
    return <div className="mx-auto max-w-md space-y-6 py-12 text-center">
      <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border border-indigo-400/40 bg-indigo-500/15"><Trophy className="h-10 w-10 text-yellow-300" /></div>
      <div><h1 className="text-3xl font-black text-slate-100">Hoàn thành điền từ!</h1><p className="mt-2 text-slate-400">Bạn đã tự gõ đáp án cho toàn bộ từ vựng.</p></div>
      <div className="grid grid-cols-3 gap-3 rounded-2xl border border-slate-700 bg-slate-800/70 p-4"><div><b className="text-2xl text-indigo-300">{accuracy}%</b><p className="text-xs text-slate-400">Chính xác</p></div><div><b className="text-2xl text-green-400">{correctCount}</b><p className="text-xs text-slate-400">Đúng</p></div><div><b className="text-2xl text-red-400">{wrongCount}</b><p className="text-xs text-slate-400">Sai</p></div></div>
      <div className="flex flex-col gap-3 sm:flex-row"><button type="button" onClick={restart} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 font-semibold text-slate-200"><RotateCcw className="h-4 w-4" />Làm lại</button><button type="button" disabled={isSyncing} onClick={() => void finish()} className="flex flex-1 items-center justify-center rounded-xl bg-indigo-600 px-4 py-3 font-semibold text-white disabled:opacity-60">{isSyncing ? 'Đang lưu...' : 'Lưu kết quả'}</button></div>
    </div>;
  }

  const progress = Math.round(((currentCardIndex + 1) / cards.length) * 100);
  return <div className="mx-auto max-w-2xl space-y-6">
    <div className="flex items-center justify-between"><button type="button" onClick={() => { resetSession(); navigate(`/set/${id}`); }} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200"><ArrowLeft className="h-4 w-4" />Thoát điền từ</button><span className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300"><PenLine className="h-3.5 w-3.5" />Điền từ</span></div>
    <div className="h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all" style={{ width: `${progress}%` }} /></div>
    <div className="flex justify-between text-xs font-semibold text-slate-400"><span>Thẻ {currentCardIndex + 1} / {cards.length}</span><span>{progress}%</span></div>
    <section className="glass-panel rounded-3xl border border-emerald-500/25 p-7 sm:p-10">
      <p className="text-center text-xs font-bold uppercase tracking-widest text-emerald-400">Nghĩa / định nghĩa</p>
      <h1 className="my-6 text-center text-3xl font-black leading-relaxed text-slate-100 sm:text-4xl">{card.definition}</h1>
      {card.exampleSentence && <p className="mb-7 rounded-xl border border-slate-700 bg-slate-900/60 p-3 text-center text-sm italic text-slate-400">Ví dụ: “{card.exampleSentence}”</p>}
      <form onSubmit={(event) => void checkAnswer(event)} className="space-y-4">
        <label htmlFor="write-answer" className="text-sm font-semibold text-slate-300">Gõ từ tiếng Anh tương ứng</label>
        <input ref={inputRef} id="write-answer" value={answer} disabled={result !== null || isSubmitting} onChange={(event) => setAnswer(event.target.value)} autoComplete="off" spellCheck="false" placeholder="Nhập đáp án bằng tiếng Anh..." className={`w-full rounded-xl border bg-slate-950 px-4 py-4 text-lg text-slate-100 outline-none transition focus:ring-2 ${result === true ? 'border-green-500 focus:ring-green-500/30' : result === false ? 'border-red-500 focus:ring-red-500/30' : 'border-slate-600 focus:border-emerald-400 focus:ring-emerald-500/30'}`} />
        {result !== null && <div className={`flex items-center gap-2 rounded-xl p-3 text-sm ${result ? 'bg-green-500/10 text-green-300' : 'bg-red-500/10 text-red-300'}`}>{result ? <CheckCircle className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}{result ? 'Chính xác! Làm tốt lắm.' : <>Chưa đúng. Đáp án là <b className="ml-1">{card.term}</b>.</>}</div>}
        {result === null ? <button type="submit" disabled={!answer.trim() || isSubmitting} className="w-full rounded-xl bg-emerald-600 py-3.5 font-bold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50">{isSubmitting ? 'Đang chấm...' : 'Kiểm tra đáp án'}</button> : <button type="button" onClick={advance} className="w-full rounded-xl bg-indigo-600 py-3.5 font-bold text-white transition hover:bg-indigo-500">{currentCardIndex + 1 === cards.length ? 'Xem kết quả' : 'Từ tiếp theo'}</button>}
      </form>
    </section>
  </div>;
};
