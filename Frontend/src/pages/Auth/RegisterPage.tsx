import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, User as UserIcon, UserPlus, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';

export const RegisterPage: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { register, isLoading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await register({ name, email, password });
      navigate('/login');
    } catch (err) {
      // Error handled in store
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[75vh] px-4">
      <div className="w-full max-w-md glass-panel p-8 rounded-2xl shadow-2xl border border-slate-700/60 relative overflow-hidden">
        <div className="text-center mb-8">
          <div className="inline-flex p-3 rounded-2xl bg-indigo-600/20 text-indigo-400 mb-3 border border-indigo-500/30">
            <UserPlus className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-slate-100">Đăng Ký Tài Khoản</h2>
          <p className="text-sm text-slate-400 mt-1">Tạo tài khoản để học từ vựng và tự tạo bộ thẻ cá nhân</p>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center gap-3 text-red-400 text-sm">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Họ và tên
            </label>
            <div className="relative">
              <UserIcon className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nguyễn Văn A"
                className="w-full pl-11 pr-4 py-3 bg-slate-900/80 border border-slate-700/70 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Email
            </label>
            <div className="relative">
              <Mail className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => {
                  clearError();
                  setEmail(e.target.value);
                }}
                placeholder="name@example.com"
                className="w-full pl-11 pr-4 py-3 bg-slate-900/80 border border-slate-700/70 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
              Mật khẩu
            </label>
            <div className="relative">
              <Lock className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => {
                  clearError();
                  setPassword(e.target.value);
                }}
                placeholder="••••••••"
                className="w-full pl-11 pr-4 py-3 bg-slate-900/80 border border-slate-700/70 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3.5 px-4 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 transition-all transform active:scale-95 disabled:opacity-50"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
            ) : (
              <span>Tạo Tài Khoản</span>
            )}
          </button>
        </form>

        <p className="text-center text-sm text-slate-400 mt-6">
          Đã có tài khoản?{' '}
          <Link to="/login" className="text-indigo-400 font-semibold hover:underline">
            Đăng nhập ngay
          </Link>
        </p>
      </div>
    </div>
  );
};
