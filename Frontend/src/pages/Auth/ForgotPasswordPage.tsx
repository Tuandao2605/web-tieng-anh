import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Mail, Send } from 'lucide-react';
import { apiClient } from '../../api/apiClient';

export const ForgotPasswordPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true); setError('');
    try {
      await apiClient.post('/auth/forgot-password', { email });
      setMessage('Nếu email tồn tại, liên kết đặt lại mật khẩu đã được gửi. Hãy kiểm tra hộp thư của bạn.');
    } catch (err: any) {
      setError(err.message || 'Không thể gửi yêu cầu. Vui lòng thử lại.');
    } finally { setIsSubmitting(false); }
  };

  return <div className="flex min-h-[75vh] items-center justify-center px-4"><div className="w-full max-w-md rounded-2xl border border-slate-700/60 glass-panel p-8 shadow-2xl">
    <div className="mb-8 text-center"><div className="mb-3 inline-flex rounded-2xl border border-indigo-500/30 bg-indigo-600/20 p-3 text-indigo-400"><Mail className="h-8 w-8" /></div><h1 className="text-2xl font-bold text-slate-100">Quên mật khẩu?</h1><p className="mt-1 text-sm text-slate-400">Nhập email để nhận liên kết đặt lại mật khẩu.</p></div>
    {message ? <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm text-green-300">{message}</div> : <form onSubmit={submit} className="space-y-5">
      {error && <div className="flex gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"><AlertCircle className="h-5 w-5 shrink-0" />{error}</div>}
      <div><label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-300">Email</label><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" className="w-full rounded-xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 outline-none focus:border-indigo-500" /></div>
      <button disabled={isSubmitting} className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3.5 font-bold text-white disabled:opacity-50">{isSubmitting ? <span>Đang gửi...</span> : <><Send className="h-4 w-4" />Gửi liên kết</>}</button>
    </form>}
    <Link to="/login" className="mt-6 flex items-center justify-center gap-1.5 text-sm font-semibold text-indigo-400 hover:underline"><ArrowLeft className="h-4 w-4" />Quay lại đăng nhập</Link>
  </div></div>;
};
