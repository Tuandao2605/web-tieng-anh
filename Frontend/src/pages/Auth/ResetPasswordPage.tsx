import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, CheckCircle, Lock } from 'lucide-react';
import { apiClient } from '../../api/apiClient';

export const ResetPasswordPage: React.FC = () => {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (password !== confirmation) { setError('Xác nhận mật khẩu chưa khớp.'); return; }
    setIsSubmitting(true);
    try { await apiClient.post('/auth/reset-password', { token, password }); setDone(true); }
    catch (err: any) { setError(err.message || 'Liên kết không hợp lệ hoặc đã hết hạn.'); }
    finally { setIsSubmitting(false); }
  };

  if (!token) return <div className="py-24 text-center text-red-300">Liên kết đặt lại mật khẩu không hợp lệ. <Link className="text-indigo-400 underline" to="/forgot-password">Gửi lại liên kết</Link></div>;
  return <div className="flex min-h-[75vh] items-center justify-center px-4"><div className="w-full max-w-md rounded-2xl border border-slate-700/60 glass-panel p-8 shadow-2xl">
    <div className="mb-8 text-center"><div className="mb-3 inline-flex rounded-2xl border border-indigo-500/30 bg-indigo-600/20 p-3 text-indigo-400"><Lock className="h-8 w-8" /></div><h1 className="text-2xl font-bold text-slate-100">Đặt mật khẩu mới</h1><p className="mt-1 text-sm text-slate-400">Mật khẩu cần có ít nhất 6 ký tự.</p></div>
    {done ? <div className="space-y-5 text-center"><div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-300"><CheckCircle className="mx-auto mb-2 h-6 w-6" />Mật khẩu đã được đặt lại thành công.</div><button onClick={() => navigate('/login')} className="w-full rounded-xl bg-indigo-600 py-3 font-bold text-white">Đăng nhập</button></div> : <form onSubmit={submit} className="space-y-5">
      {error && <div className="flex gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}
      <div><label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">Mật khẩu mới</label><input type="password" minLength={6} required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-indigo-500" /></div>
      <div><label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">Xác nhận mật khẩu</label><input type="password" minLength={6} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-slate-100 outline-none focus:border-indigo-500" /></div>
      <button disabled={isSubmitting} className="w-full rounded-xl bg-indigo-600 py-3.5 font-bold text-white disabled:opacity-50">{isSubmitting ? 'Đang cập nhật...' : 'Đặt lại mật khẩu'}</button>
    </form>}
  </div></div>;
};
