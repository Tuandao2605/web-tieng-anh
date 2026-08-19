import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ClipboardPaste, Loader2, Plus, Trash2, X } from 'lucide-react';
import type { CreateCardInput } from '../../types';
import { splitBulkCardLine } from '../../utils/bulkCardParser';
import type { SeparatorMode } from '../../utils/bulkCardParser';

interface BulkAddCardsModalProps {
  isOpen: boolean;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (cards: CreateCardInput[]) => Promise<void>;
}

export const BulkAddCardsModal: React.FC<BulkAddCardsModalProps> = ({
  isOpen,
  isSubmitting = false,
  onClose,
  onSubmit,
}) => {
  const [rawText, setRawText] = useState('');
  const [separatorMode, setSeparatorMode] = useState<SeparatorMode>('auto');
  const [submitError, setSubmitError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    const cards: CreateCardInput[] = [];
    const invalidLines: Array<{ lineNumber: number; content: string; reason: string }> = [];
    const seen = new Set<string>();

    rawText.split(/\r?\n/).forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!line) return;

      const parts = splitBulkCardLine(line, separatorMode);
      if (!parts) {
        invalidLines.push({
          lineNumber: index + 1,
          content: line,
          reason: 'Không tìm thấy dấu phân cách giữa từ và nghĩa',
        });
        return;
      }

      const term = parts[0].trim();
      const definition = parts[1].trim();

      if (!term || !definition) {
        invalidLines.push({
          lineNumber: index + 1,
          content: line,
          reason: !term ? 'Thiếu từ vựng' : 'Thiếu nghĩa',
        });
        return;
      }

      const duplicateKey = `${term.toLocaleLowerCase()}::${definition.toLocaleLowerCase()}`;
      if (seen.has(duplicateKey)) {
        invalidLines.push({
          lineNumber: index + 1,
          content: line,
          reason: 'Bị trùng trong danh sách đang dán',
        });
        return;
      }

      seen.add(duplicateKey);
      cards.push({ term, definition });
    });

    return { cards, invalidLines };
  }, [rawText, separatorMode]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (parsed.cards.length === 0 || isSubmitting) return;
    setSubmitError(null);

    try {
      await onSubmit(parsed.cards);
      setRawText('');
      setSeparatorMode('auto');
      onClose();
    } catch (error: any) {
      setSubmitError(error?.message || 'Không thể thêm thẻ. Vui lòng thử lại.');
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    setSubmitError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Đóng"
        onClick={handleClose}
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
      />

      <div className="relative z-10 w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-indigo-500/15 p-2 text-indigo-400">
                <ClipboardPaste className="h-5 w-5" />
              </div>
              <h2 className="text-xl font-bold text-slate-100">Thêm nhiều từ cùng lúc</h2>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Dán danh sách từ vựng, mỗi dòng gồm một từ và một nghĩa.
            </p>
          </div>

          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-800 hover:text-slate-200 disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 px-4 py-3 text-sm text-slate-300">
            <p className="font-semibold text-indigo-300">Cách dán nhanh nhất</p>
            <p className="mt-1 text-slate-400">
              Copy 2 cột từ Excel/Google Sheets hoặc dán dạng "Từ (loại từ) [B2] Nghĩa". Chỉ từ/cụm từ đứng trước metadata được đưa lên mặt trước.
            </p>
            <div className="mt-2 rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-xs leading-6 text-slate-400">
              apple&nbsp;&nbsp;&nbsp;&nbsp;quả táo<br />
              take care&nbsp;&nbsp;&nbsp;&nbsp;chăm sóc<br />
              Chronic (adj) [B2]&nbsp;&nbsp;&nbsp;&nbsp;Mạn tính, kéo dài
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_180px]">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-slate-300">Danh sách từ</span>
              <textarea
                value={rawText}
                onChange={(event) => setRawText(event.target.value)}
                rows={10}
                autoFocus
                placeholder={'apple\tquả táo\nbook\tquyển sách\nlearn\thọc'}
                className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 font-mono text-sm leading-6 text-slate-200 outline-none transition placeholder:text-slate-600 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15"
              />
            </label>

            <div>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-300">Dấu phân cách</span>
                <select
                  value={separatorMode}
                  onChange={(event) => setSeparatorMode(event.target.value as SeparatorMode)}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-slate-200 outline-none focus:border-indigo-500"
                >
                  <option value="auto">Tự động</option>
                  <option value="tab">Tab</option>
                  <option value="pipe">Dấu |</option>
                  <option value="semicolon">Dấu ;</option>
                  <option value="comma">Dấu ,</option>
                  <option value="parenthesis">Dấu ( )</option>
                </select>
              </label>

              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5 text-sm">
                  <span className="flex items-center gap-2 text-slate-400">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Hợp lệ
                  </span>
                  <strong className="text-emerald-300">{parsed.cards.length}</strong>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-sm">
                  <span className="flex items-center gap-2 text-slate-400">
                    <AlertCircle className="h-4 w-4 text-amber-400" /> Bỏ qua
                  </span>
                  <strong className="text-amber-300">{parsed.invalidLines.length}</strong>
                </div>
              </div>

              {rawText && (
                <button
                  type="button"
                  onClick={() => setRawText('')}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2.5 text-sm text-slate-400 transition hover:bg-slate-800 hover:text-slate-200"
                >
                  <Trash2 className="h-4 w-4" /> Xóa nội dung
                </button>
              )}
            </div>
          </div>

          {parsed.cards.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-300">Xem trước</p>
                <p className="text-xs text-slate-500">Tối đa 200 thẻ / lần</p>
              </div>
              <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-800">
                {parsed.cards.slice(0, 200).map((card, index) => (
                  <div
                    key={`${card.term}-${index}`}
                    className="grid grid-cols-[48px_1fr_1.4fr] gap-3 border-b border-slate-800/70 px-3 py-2.5 text-sm last:border-b-0"
                  >
                    <span className="text-slate-600">#{index + 1}</span>
                    <span className="font-medium text-slate-200">{card.term}</span>
                    <span className="text-slate-400">{card.definition}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {parsed.invalidLines.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="mb-2 text-sm font-semibold text-amber-300">
                {parsed.invalidLines.length} dòng sẽ bị bỏ qua
              </p>
              <div className="max-h-28 space-y-1 overflow-y-auto text-xs text-slate-400">
                {parsed.invalidLines.slice(0, 8).map((item) => (
                  <p key={`${item.lineNumber}-${item.content}`}>
                    Dòng {item.lineNumber}: {item.reason}
                  </p>
                ))}
                {parsed.invalidLines.length > 8 && (
                  <p>... và {parsed.invalidLines.length - 8} dòng khác</p>
                )}
              </div>
            </div>
          )}

          {parsed.cards.length > 200 && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              Mỗi lần chỉ thêm tối đa 200 thẻ. Hãy chia danh sách thành nhiều lần.
            </div>
          )}

          {submitError && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {submitError}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-800 bg-slate-950/30 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            Các dòng lỗi sẽ được bỏ qua, chỉ thẻ hợp lệ mới được thêm.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={parsed.cards.length === 0 || parsed.cards.length > 200 || isSubmitting}
              className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {isSubmitting ? 'Đang thêm...' : `Thêm ${parsed.cards.length} thẻ`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
