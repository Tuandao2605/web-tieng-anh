import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, GraduationCap, Zap, Pencil, Globe, Lock,
  Layers, ChevronLeft, ChevronRight, Eye, EyeOff, Volume2
} from 'lucide-react';
import { useStudyStore } from '../../store/useStudyStore';
import type { Card } from '../../types';

export const SetDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentSet, fetchSet, isLoading, error } = useStudyStore();
  const [previewIndex, setPreviewIndex] = useState(0);
  const [showDefinition, setShowDefinition] = useState(false);

  useEffect(() => {
    if (id) fetchSet(id);
  }, [id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mx-auto"></div>
          <p className="text-slate-400 text-sm">Đang tải bộ thẻ...</p>
        </div>
      </div>
    );
  }

  if (error || !currentSet) {
    return (
      <div className="text-center py-20 space-y-4">
        <p className="text-red-400">{error || 'Không tìm thấy bộ thẻ'}</p>
        <Link to="/" className="text-indigo-400 hover:underline">← Về trang chủ</Link>
      </div>
    );
  }

  const cards: Card[] = currentSet.cards || [];
  const previewCard = cards[previewIndex];

  const prevCard = () => {
    setPreviewIndex((prev) => (prev - 1 + cards.length) % cards.length);
    setShowDefinition(false);
  };
  const nextCard = () => {
    setPreviewIndex((prev) => (prev + 1) % cards.length);
    setShowDefinition(false);
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 mb-4 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Quay lại
        </button>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight">{currentSet.title}</h1>
            {currentSet.description && <p className="text-slate-400 mt-2 text-sm">{currentSet.description}</p>}
            <div className="flex items-center gap-3 mt-3">
              <span className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                <Layers className="w-3.5 h-3.5 text-indigo-400" />
                {cards.length} thẻ từ
              </span>
              <span className={`flex items-center gap-1 text-xs px-3 py-1 rounded-full ${currentSet.isPublic ? 'bg-indigo-600/15 text-indigo-300' : 'bg-slate-800 text-slate-400'} border border-slate-700`}>
                {currentSet.isPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {currentSet.isPublic ? 'Công khai' : 'Riêng tư'}
              </span>
            </div>
          </div>

          <Link
            to={`/set/${id}/edit`}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition-all shrink-0"
          >
            <Pencil className="w-4 h-4" />
            Chỉnh sửa
          </Link>
        </div>
      </div>

      {/* Study Mode Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          to={`/set/${id}/learn`}
          className="flex items-center gap-4 p-5 rounded-2xl glass-card border border-indigo-500/25 hover:border-indigo-400/50 group transition-all"
        >
          <div className="p-3 rounded-xl bg-indigo-600/25 text-indigo-400 group-hover:bg-indigo-600/40 transition-colors">
            <GraduationCap className="w-7 h-7" />
          </div>
          <div>
            <p className="font-bold text-slate-200 group-hover:text-indigo-300 transition-colors">Chế độ Ôn tập Thẻ</p>
            <p className="text-xs text-slate-400 mt-0.5">Lật thẻ, kiểm tra từng từ một</p>
          </div>
        </Link>

        <Link
          to={`/set/${id}/quiz`}
          className="flex items-center gap-4 p-5 rounded-2xl glass-card border border-violet-500/25 hover:border-violet-400/50 group transition-all"
        >
          <div className="p-3 rounded-xl bg-violet-600/25 text-violet-400 group-hover:bg-violet-600/40 transition-colors">
            <Zap className="w-7 h-7" />
          </div>
          <div>
            <p className="font-bold text-slate-200 group-hover:text-violet-300 transition-colors">Bài Trắc Nghiệm</p>
            <p className="text-xs text-slate-400 mt-0.5">4 lựa chọn, tính điểm tự động</p>
          </div>
        </Link>
      </div>

      {/* Flash Preview Card */}
      {cards.length > 0 && (
        <div>
          <h2 className="text-base font-bold text-slate-300 mb-4 flex items-center gap-2">
            <Eye className="w-4 h-4 text-indigo-400" />
            Xem trước bộ thẻ
          </h2>

          <div className="flex flex-col items-center gap-4">
            {/* Flip Card */}
            <div
              className="relative w-full max-w-2xl h-56 cursor-pointer"
              onClick={() => setShowDefinition(!showDefinition)}
            >
              <div
                className={`absolute inset-0 rounded-2xl border p-8 flex flex-col items-center justify-center text-center transition-all duration-300 select-none
                  ${showDefinition
                    ? 'bg-indigo-900/30 border-indigo-500/50'
                    : 'glass-panel border-slate-700/60'
                  }`}
              >
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-500 mb-3">
                  {showDefinition ? 'Định nghĩa' : 'Thuật ngữ'}
                </span>
                <p className="text-2xl font-bold text-slate-100">
                  {showDefinition ? previewCard.definition : previewCard.term}
                </p>
                {!showDefinition && previewCard.exampleSentence && (
                  <p className="text-xs text-slate-500 mt-3 italic">"{previewCard.exampleSentence}"</p>
                )}
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-4">
                  {showDefinition ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showDefinition ? 'Nhấn để xem thuật ngữ' : 'Nhấn để xem định nghĩa'}
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-4">
              <button onClick={prevCard} className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-all hover:text-indigo-400">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-sm text-slate-400 font-medium min-w-[4rem] text-center">
                {previewIndex + 1} / {cards.length}
              </span>
              <button onClick={nextCard} className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-all hover:text-indigo-400">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* All Cards Table */}
      <div>
        <h2 className="text-base font-bold text-slate-300 mb-4 flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-400" />
          Danh sách tất cả thẻ ({cards.length})
        </h2>

        <div className="space-y-2">
          {cards.map((card, index) => (
            <div
              key={card.id}
              className="glass-card rounded-xl px-5 py-4 border border-slate-700/50 flex flex-col sm:flex-row sm:items-center gap-3"
            >
              <span className="text-xs font-bold text-slate-600 w-6 shrink-0">#{index + 1}</span>
              <div className="flex-1 sm:flex sm:gap-4">
                <p className="font-semibold text-slate-200 sm:w-1/3">{card.term}</p>
                <p className="text-slate-400 text-sm mt-1 sm:mt-0 sm:w-2/3">{card.definition}</p>
              </div>
              {card.audioUrl && (
                <button className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-400 hover:bg-slate-800 transition-colors shrink-0">
                  <Volume2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
