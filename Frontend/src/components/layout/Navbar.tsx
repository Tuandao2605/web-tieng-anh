import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, PlusCircle, LogOut, User as UserIcon, Sparkles, LayoutDashboard } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { GlobalDeckSearch } from './GlobalDeckSearch';

export const Navbar: React.FC = () => {
  const { user, isAuthenticated, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-slate-700/50 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-y-2 py-2">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 font-bold text-xl text-indigo-400 hover:text-indigo-300 transition-colors">
            <div className="p-2 rounded-xl bg-indigo-600/30 text-indigo-400 border border-indigo-500/30">
              <BookOpen className="w-6 h-6" />
            </div>
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent font-extrabold tracking-tight">
              Quizlet Pro
            </span>
          </Link>

          <div className="order-3 w-full md:order-none md:max-w-lg md:flex-1 md:px-5">
            <GlobalDeckSearch />
          </div>

          {/* Nav Actions */}
          <div className="flex items-center gap-4">
            {isAuthenticated ? (
              <>
                <Link
                  to="/"
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 transition-all"
                >
                  <LayoutDashboard className="w-4 h-4 text-indigo-400" />
                  <span>Trang chủ</span>
                </Link>

                <Link
                  to="/set/create"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white shadow-md shadow-indigo-600/25 transition-all transform hover:-translate-y-0.5"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Tạo bộ thẻ</span>
                </Link>

                <div className="flex items-center gap-3 pl-2 border-l border-slate-700/60">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/50">
                    <UserIcon className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-semibold text-slate-200">
                      {user?.name || user?.email || 'Học viên'}
                    </span>
                  </div>

                  <button
                    onClick={handleLogout}
                    title="Đăng xuất"
                    className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800/80 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  to="/login"
                  className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-800/60 transition-all"
                >
                  Đăng nhập
                </Link>
                <Link
                  to="/register"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 transition-all"
                >
                  <Sparkles className="w-4 h-4 text-indigo-200" />
                  <span>Đăng ký</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
