import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Briefcase } from 'lucide-react';
import { getSavedJds } from '../services/savedJdService';
import type { SavedJd } from '../types';

interface SavedJdPickModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  title?: string;
  onPick: (jd: SavedJd) => void;
}

const SavedJdPickModal: React.FC<SavedJdPickModalProps> = ({
  isOpen,
  onClose,
  userId,
  title = '从 JD 库载入',
  onPick,
}) => {
  const [list, setList] = useState<SavedJd[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getSavedJds(userId);
    setList(data);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="关闭" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl border border-zinc-200 w-full max-w-md max-h-[80vh] flex flex-col z-[71]">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
          <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
          <button type="button" onClick={onClose} className="p-1 rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 p-3">
          {loading ? (
            <div className="py-12 flex flex-col items-center gap-2 text-zinc-500 text-sm">
              <Loader2 className="animate-spin" size={22} />
              加载中…
            </div>
          ) : list.length === 0 ? (
            <p className="py-10 text-center text-sm text-zinc-500">JD 库为空。可在职业探索生成参考 JD 后点击「保存到 JD 库」。</p>
          ) : (
            <ul className="space-y-2">
              {list.map(jd => (
                <li key={jd.id} className="border border-zinc-200 rounded-xl p-3 bg-zinc-50/50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-800 truncate" title={jd.title}>
                        {jd.title}
                      </p>
                      {jd.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {jd.tags.map(t => (
                            <span key={t} className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-200/80 text-zinc-700">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onPick(jd);
                        onClose();
                      }}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800"
                    >
                      <Briefcase size={12} />
                      载入
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default SavedJdPickModal;
