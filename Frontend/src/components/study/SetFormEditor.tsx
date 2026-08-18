import React, { useState, useEffect } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import type { SubmitHandler } from 'react-hook-form';
import {
  PlusCircle, Trash2, Save, Loader2, Globe, Lock,
  ArrowUp, ArrowDown, AlertCircle, Sparkles, BookOpen, ClipboardPaste
} from 'lucide-react';
import type { CreateCardInput, CreateSetInput, FlashcardSet } from '../../types';
import { useStudyStore } from '../../store/useStudyStore';
import { BulkAddCardsModal } from './BulkAddCardsModal';

export interface SetFormEditorProps {
  initialData?: FlashcardSet | null;
  setId?: string;
  onSuccess?: (set: FlashcardSet) => void;
  onCancel?: () => void;
}

type FormValues = CreateSetInput;

const emptyCard = {
  term: '',
  definition: '',
  exampleSentence: '',
  imageUrl: '',
};

export const SetFormEditor: React.FC<SetFormEditorProps> = ({
  initialData,
  setId,
  onSuccess,
  onCancel,
}) => {
  const { createSet, updateSet, isLoading, error } = useStudyStore();
  const [formError, setFormError] = useState<string | null>(null);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const isEditing = Boolean(setId || initialData?.id);

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      title: initialData?.title || '',
      description: initialData?.description || '',
      isPublic: initialData?.isPublic ?? true,
      cards: initialData?.cards?.map((c) => ({
        id: c.id,
        term: c.term,
        definition: c.definition,
        exampleSentence: c.exampleSentence || '',
        imageUrl: c.imageUrl || '',
      })) || [emptyCard, emptyCard],
    },
  });

  const { fields, append, remove, move, replace } = useFieldArray({
    control,
    name: 'cards',
    // Do not overwrite the database `id` stored in each existing card.
    keyName: 'fieldKey',
  });

  const isPublic = watch('isPublic');
  const cardsWatch = watch('cards');

  // Reset form if initialData updates dynamically
  useEffect(() => {
    if (initialData) {
      reset({
        title: initialData.title,
        description: initialData.description || '',
        isPublic: initialData.isPublic,
        cards: initialData.cards.map((c) => ({
          id: c.id,
          term: c.term,
          definition: c.definition,
          exampleSentence: c.exampleSentence || '',
          imageUrl: c.imageUrl || '',
        })),
      });
    }
  }, [initialData, reset]);

  // Handle Tab shortcut on definition input of the last card row
  const handleDefinitionKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    index: number
  ) => {
    if (e.key === 'Tab' && !e.shiftKey && index === fields.length - 1) {
      // Append a new card row when tabbing out of the last definition field
      append({ ...emptyCard });
    }
  };

  // Import many cards into the create/edit form without making a separate API request.
  // If the form only contains empty starter rows, replace them. Otherwise append.
  const handleBulkImport = async (cards: CreateCardInput[]) => {
    const importedCards = cards.map((card) => ({
      term: card.term,
      definition: card.definition,
      exampleSentence: card.exampleSentence || '',
      imageUrl: card.imageUrl || '',
    }));

    const hasExistingContent = (cardsWatch || []).some((card) =>
      [card?.term, card?.definition, card?.exampleSentence, card?.imageUrl].some(
        (value) => typeof value === 'string' && value.trim().length > 0
      )
    );

    if (hasExistingContent) {
      append(importedCards);
    } else {
      replace(importedCards);
    }
  };

  const onSubmit: SubmitHandler<FormValues> = async (data) => {
    setFormError(null);

    // Filter valid cards (must have both term & definition filled)
    const validCards = data.cards.filter(
      (c) => c.term.trim().length > 0 && c.definition.trim().length > 0
    );

    if (validCards.length === 0) {
      setFormError('Vui lòng điền đầy đủ Thuật ngữ và Định nghĩa cho ít nhất 1 thẻ.');
      return;
    }

    const payload: CreateSetInput = {
      title: data.title.trim(),
      description: data.description?.trim(),
      isPublic: data.isPublic,
      cards: validCards.map((c) => ({
        id: c.id,
        term: c.term.trim(),
        definition: c.definition.trim(),
        exampleSentence: c.exampleSentence?.trim() || undefined,
        imageUrl: c.imageUrl?.trim() || undefined,
      })),
    };

    try {
      let savedSet: FlashcardSet;
      const targetId = setId || initialData?.id;

      if (isEditing && targetId) {
        savedSet = await updateSet(targetId, payload);
      } else {
        savedSet = await createSet(payload);
      }

      if (onSuccess) {
        onSuccess(savedSet);
      }
    } catch (err: any) {
      setFormError(err.message || 'Không thể lưu bộ từ vựng. Vui lòng thử lại.');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 max-w-4xl mx-auto">
      {/* SECTION 1: SET METADATA */}
      <div className="glass-panel rounded-3xl p-6 sm:p-8 border border-slate-700/70 space-y-6 shadow-xl">
        <div className="flex items-center gap-3 pb-2 border-b border-slate-800">
          <div className="p-2.5 rounded-2xl bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
            {isEditing ? <BookOpen className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
          </div>
          <div>
            <h2 className="text-xl font-extrabold text-slate-100">
              {isEditing ? 'Chỉnh sửa bộ từ vựng' : 'Tạo bộ từ vựng mới'}
            </h2>
            <p className="text-xs text-slate-400">Điền tên, mô tả và thiết lập quyền riêng tư</p>
          </div>
        </div>

        {/* Title */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
            Tên bộ từ vựng <span className="text-red-400">*</span>
          </label>
          <input
            {...register('title', { required: 'Vui lòng nhập tên bộ từ vựng' })}
            placeholder="Ví dụ: 50 Từ vựng IELTS Chuyên ngành Công nghệ"
            className="w-full px-4 py-3 bg-slate-900/90 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
          />
          {errors.title && (
            <p className="text-red-400 text-xs flex items-center gap-1 mt-1">
              <AlertCircle className="w-3.5 h-3.5" />
              {errors.title.message}
            </p>
          )}
        </div>

        {/* Description */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
            Mô tả bộ từ <span className="text-slate-500 font-normal normal-case">(tùy chọn)</span>
          </label>
          <textarea
            {...register('description')}
            rows={2}
            placeholder="Mô tả ngắn gọn mục đích bài học..."
            className="w-full px-4 py-3 bg-slate-900/90 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600 resize-none"
          />
        </div>

        {/* Visibility Toggle Switch */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <div>
            <p className="text-sm font-semibold text-slate-200">Chế độ riêng tư</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {isPublic ? 'Mọi người dùng có thể xem bộ thẻ này' : 'Chỉ mình bạn thấy bộ thẻ này'}
            </p>
          </div>

          <label className="relative inline-flex items-center cursor-pointer gap-3">
            <input type="checkbox" {...register('isPublic')} className="sr-only peer" />
            <div className="w-11 h-6 bg-slate-800 border border-slate-700 rounded-full peer peer-checked:bg-indigo-600 transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-300">
              {isPublic ? (
                <>
                  <Globe className="w-4 h-4 text-indigo-400" />
                  <span className="text-indigo-300">Công khai</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4 text-slate-400" />
                  <span className="text-slate-400">Riêng tư</span>
                </>
              )}
            </span>
          </label>
        </div>
      </div>

      {/* Global Error Banner */}
      {(formError || error) && (
        <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2.5">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span>{formError || error}</span>
        </div>
      )}

      {/* SECTION 2: DYNAMIC CARD ROWS */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-extrabold text-slate-200 flex items-center gap-2">
            <span>Danh sách thẻ ghi nhớ</span>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-indigo-400 border border-slate-700">
              {fields.length} thẻ
            </span>
          </h3>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-slate-500 hidden lg:inline">
              💡 Mẹo: Nhấn <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-indigo-300">Tab</kbd> ở ô định nghĩa thẻ cuối để thêm dòng mới
            </span>
            <button
              type="button"
              onClick={() => setIsBulkOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/10 px-3.5 py-2 text-xs font-bold text-indigo-300 transition-all hover:border-indigo-400 hover:bg-indigo-500/20 hover:text-indigo-200"
            >
              <ClipboardPaste className="h-4 w-4" />
              Nhập hàng loạt
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {fields.map((field, index) => {
            const currentImg = cardsWatch?.[index]?.imageUrl;

            return (
              <div
                key={field.fieldKey}
                className="glass-card rounded-2xl p-5 border border-slate-700/60 space-y-4 relative group hover:border-indigo-500/40 transition-all"
              >
                {/* Row Header */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-xs font-bold flex items-center justify-center">
                      {index + 1}
                    </span>
                    <span className="text-xs font-semibold text-slate-400">Thẻ từ vựng #{index + 1}</span>
                  </div>

                  {/* Reorder & Delete controls */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(index, index - 1)}
                      disabled={index === 0}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-slate-800 disabled:opacity-20 transition-all"
                      title="Di chuyển lên"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, index + 1)}
                      disabled={index === fields.length - 1}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-slate-800 disabled:opacity-20 transition-all"
                      title="Di chuyển xuống"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    {fields.length > 1 && (
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-all ml-1"
                        title="Xóa thẻ này"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Term & Definition Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Thuật ngữ (Term) <span className="text-red-400">*</span>
                    </label>
                    <input
                      {...register(`cards.${index}.term`, { required: true })}
                      placeholder="Ví dụ: Artificial Intelligence"
                      className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Định nghĩa (Definition) <span className="text-red-400">*</span>
                    </label>
                    <input
                      {...register(`cards.${index}.definition`, { required: true })}
                      onKeyDown={(e) => handleDefinitionKeyDown(e, index)}
                      placeholder="Ví dụ: Trí tuệ nhân tạo"
                      className="w-full px-3.5 py-2.5 bg-slate-900/90 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-slate-600"
                    />
                  </div>
                </div>

                {/* Example Sentence & Image URL */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                  <div className="sm:col-span-2 space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Ví dụ minh họa <span className="text-slate-500 font-normal normal-case">(tùy chọn)</span>
                    </label>
                    <input
                      {...register(`cards.${index}.exampleSentence`)}
                      placeholder="AI is transforming modern medicine."
                      className="w-full px-3.5 py-2 bg-slate-900/80 border border-slate-700/80 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-indigo-500 transition-all placeholder:text-slate-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
                      Link ảnh <span className="text-slate-500 font-normal normal-case">(tùy chọn)</span>
                    </label>
                    <div className="flex gap-2 items-center">
                      <input
                        {...register(`cards.${index}.imageUrl`)}
                        placeholder="https://images.unsplash.com/..."
                        className="w-full px-3 py-2 bg-slate-900/80 border border-slate-700/80 rounded-xl text-slate-200 text-xs focus:outline-none focus:border-indigo-500 transition-all placeholder:text-slate-600"
                      />
                      {currentImg && (
                        <div className="w-8 h-8 rounded-lg overflow-hidden border border-indigo-500/50 shrink-0">
                          <img src={currentImg} alt="Preview" className="w-full h-full object-cover" />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add New Card Button */}
        <button
          type="button"
          onClick={() => append({ ...emptyCard })}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed border-slate-700 hover:border-indigo-500/80 text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/5 transition-all text-sm font-bold shadow-sm"
        >
          <PlusCircle className="w-5 h-5 text-indigo-400" />
          <span>Thêm thẻ mới</span>
        </button>
      </div>

      <BulkAddCardsModal
        isOpen={isBulkOpen}
        onClose={() => setIsBulkOpen(false)}
        onSubmit={handleBulkImport}
      />

      {/* FOOTER ACTIONS */}
      <div className="flex items-center justify-end gap-4 pt-4 border-t border-slate-800">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3 rounded-xl font-semibold text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-all text-sm"
          >
            Hủy bỏ
          </button>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="flex items-center gap-2 px-8 py-3.5 rounded-xl font-extrabold text-white bg-indigo-600 hover:bg-indigo-500 shadow-xl shadow-indigo-600/30 transition-all disabled:opacity-60 text-sm"
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>{isLoading ? 'Đang lưu...' : isEditing ? 'Cập nhật bộ thẻ' : 'Tạo bộ thẻ mới'}</span>
        </button>
      </div>
    </form>
  );
};
