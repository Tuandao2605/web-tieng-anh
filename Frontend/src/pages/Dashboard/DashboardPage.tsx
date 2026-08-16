import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen, PlusCircle, Layers, GraduationCap,
  Globe, Lock, ChevronRight, Zap, Award, BarChart2
} from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import type { FlashcardSet } from '../../types';
import { useAuthStore } from '../../store/useAuthStore';

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: string; color: string }> = ({ icon, label, value, color }) => (
  <div className={`glass-card rounded-2xl p-5 border border-slate-700/50 flex items-center gap-4`}>
    <div className={`p-3 rounded-xl ${color} text-white`}>{icon}</div>
    <div>
      <p className="text-2xl font-bold text-slate-100">{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
    </div>
  </div>
);

const SetCard: React.FC<{ set: FlashcardSet }> = ({ set }) => (
  <div className="glass-card rounded-2xl border border-slate-700/50 overflow-hidden group">
    {/* Color bar */}
    <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500" />
    <div className="p-5">
      <div className="flex items-start justify-between gap-2 mb-3">
        <h3 className="font-bold text-slate-100 group-hover:text-indigo-300 transition-colors line-clamp-2 leading-tight">{set.title}</h3>
        <span className="shrink-0 flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
          style={{ background: set.isPublic ? 'rgba(99,102,241,0.15)' : 'rgba(100,116,139,0.15)', color: set.isPublic ? '#a5b4fc' : '#94a3b8' }}>
          {set.isPublic ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
          {set.isPublic ? 'Công khai' : 'Riêng tư'}
        </span>
      </div>

      {set.description && (
        <p className="text-xs text-slate-400 mb-4 line-clamp-2">{set.description}</p>
      )}

      <div className="flex items-center gap-2 text-xs text-slate-500 mb-4">
        <Layers className="w-3.5 h-3.5" />
        <span>{set.cards?.length ?? 0} thẻ từ</span>
      </div>

      {/* Action Links */}
      <div className="grid grid-cols-2 gap-2">
        <Link
          to={`/set/${set.id}`}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-indigo-600/20 text-slate-300 hover:text-indigo-300 border border-slate-700 hover:border-indigo-500/50 transition-all"
        >
          <BookOpen className="w-3.5 h-3.5" />
          Xem thẻ
        </Link>
        <Link
          to={`/set/${set.id}/learn`}
          className="flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600/20 hover:bg-indigo-600/40 text-indigo-300 border border-indigo-500/30 hover:border-indigo-400/60 transition-all"
        >
          <GraduationCap className="w-3.5 h-3.5" />
          Ôn tập
        </Link>
      </div>

      <Link
        to={`/set/${set.id}/quiz`}
        className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold bg-violet-600/15 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30 hover:border-violet-400/60 transition-all"
      >
        <Zap className="w-3.5 h-3.5" />
        Làm bài kiểm tra
      </Link>
    </div>
  </div>
);

export const DashboardPage: React.FC = () => {
  const { user } = useAuthStore();
  const [sets, setSets] = useState<FlashcardSet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSets = async () => {
      try {
        setIsLoading(true);
        const data = await loadSetsOnce();
        setSets(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSets();
  }, []);

  const totalCards = sets.reduce((acc, s) => acc + (s.cards?.length ?? 0), 0);

  return (
    <div className="space-y-8">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-slate-100 tracking-tight">
            Xin chào,{' '}
            <span className="bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">
              {user?.name || user?.email || 'Học viên'} 👋
            </span>
          </h1>
          <p className="text-slate-400 mt-1 text-sm">Tiếp tục hành trình chinh phục tiếng Anh của bạn</p>
        </div>
        <Link
          to="/set/create"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-lg shadow-indigo-600/30 transition-all hover:-translate-y-0.5"
        >
          <PlusCircle className="w-5 h-5" />
          Tạo bộ thẻ mới
        </Link>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCard icon={<Layers className="w-5 h-5" />} label="Bộ thẻ" value={String(sets.length)} color="bg-indigo-600" />
        <StatCard icon={<BookOpen className="w-5 h-5" />} label="Tổng thẻ từ" value={String(totalCards)} color="bg-violet-600" />
        <StatCard icon={<Award className="w-5 h-5" />} label="Phiên học" value="—" color="bg-purple-600" />
      </div>

      {/* Sets Grid */}
      <div>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-slate-200 flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-indigo-400" />
            Bộ thẻ từ vựng của bạn
          </h2>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-56 rounded-2xl bg-slate-800/50 animate-pulse border border-slate-700/40" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-16 text-slate-500">
            <p className="text-red-400">{error}</p>
          </div>
        ) : sets.length === 0 ? (
          <div className="text-center py-20 glass-card rounded-2xl border border-dashed border-slate-700">
            <BookOpen className="w-14 h-14 text-slate-600 mx-auto mb-4" />
            <p className="text-slate-400 font-medium">Chưa có bộ thẻ nào</p>
            <p className="text-slate-500 text-sm mt-1 mb-6">Hãy tạo bộ thẻ đầu tiên để bắt đầu học!</p>
            <Link
              to="/set/create"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-all"
            >
              <PlusCircle className="w-4 h-4" />
              Tạo bộ thẻ
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {sets.map((set) => <SetCard key={set.id} set={set} />)}
          </div>
        )}
      </div>

      {/* Quick Access */}
      {sets.length > 0 && (
        <div className="glass-panel rounded-2xl p-6 border border-slate-700/50">
          <h3 className="font-bold text-slate-200 flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-yellow-400" />
            Truy cập nhanh — Bộ thẻ gần đây
          </h3>
          <div className="space-y-2">
            {sets.slice(0, 3).map((set) => (
              <Link
                key={set.id}
                to={`/set/${set.id}`}
                className="flex items-center justify-between px-4 py-3 rounded-xl hover:bg-slate-800/60 border border-transparent hover:border-slate-700/50 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-600/15 text-indigo-400">
                    <BookOpen className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-200 group-hover:text-indigo-300">{set.title}</p>
                    <p className="text-xs text-slate-500">{set.cards?.length ?? 0} thẻ</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-indigo-400 transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
let activeSetsRequest: Promise<FlashcardSet[]> | null = null;

const loadSetsOnce = () => {
  if (!activeSetsRequest) {
    activeSetsRequest = apiClient.get('/sets')
      .then((data) => Array.isArray(data) ? data : [])
      .finally(() => { activeSetsRequest = null; });
  }
  return activeSetsRequest;
};
