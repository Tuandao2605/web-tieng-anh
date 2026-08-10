import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useStudyStore } from '../../store/useStudyStore';
import { SetFormEditor } from '../../components/study/SetFormEditor';
import type { FlashcardSet } from '../../types';

export const SetCreatorPage: React.FC = () => {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const isEditing = Boolean(id && id !== 'create');
  const { fetchSet } = useStudyStore();

  const [initialData, setInitialData] = useState<FlashcardSet | null>(null);
  const [fetching, setFetching] = useState<boolean>(isEditing);

  useEffect(() => {
    if (isEditing && id) {
      setFetching(true);
      fetchSet(id)
        .then((set) => {
          setInitialData(set);
        })
        .finally(() => {
          setFetching(false);
        });
    }
  }, [id, isEditing]);

  const handleSuccess = (savedSet: FlashcardSet) => {
    navigate(`/set/${savedSet.id}`);
  };

  const handleCancel = () => {
    navigate(-1);
  };

  if (fetching) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <Loader2 className="w-10 h-10 text-indigo-500 animate-spin" />
        <p className="text-sm font-semibold text-slate-400">Đang tải dữ liệu bộ từ vựng...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleCancel}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Quay lại
        </button>
      </div>

      {/* Form Editor Component */}
      <SetFormEditor
        initialData={initialData}
        setId={isEditing ? id : undefined}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  );
};
