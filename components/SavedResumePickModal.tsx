import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, FileText, Briefcase, Layers } from 'lucide-react';
import { getSavedResumes } from '../services/resumeService';
import type { SavedResume } from '../types';

export type SavedResumePickMode = 'resume' | 'jd' | 'both';

interface SavedResumePickModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  /** 每条记录上展示哪些操作 */
  modes: SavedResumePickMode[];
  title?: string;
  onPick: (resume: SavedResume, mode: SavedResumePickMode) => void;
}

const SavedResumePickModal: React.FC<SavedResumePickModalProps> = ({
  isOpen,
  onClose,
  userId,
  modes,
  title = '从简历库选择',
  onPick,
}) => {
  const [list, setList] = useState<SavedResume[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getSavedResumes(userId);
    setList(data);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  if (!isOpen) return null;

  const showResume = modes.includes('resume');
  const showJd = modes.includes('jd');
  const showBoth = modes.includes('both');

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
            <p className="py-10 text-center text-sm text-zinc-500">简历库为空，请先在「简历库」中保存简历。</p>
          ) : (
            <ul className="space-y-2">
              {list.map(r => {
                const hasJd = !!(r.job_description && r.job_description.trim());
                const hasResumeBody =
                  !!(r.resume_markdown && r.resume_markdown.trim()) ||
                  !!(r.english_resume_markdown && r.english_resume_markdown.trim());
                return (
                  <li key={r.id} className="border border-zinc-200 rounded-xl p-3 bg-zinc-50/50">
                    <p className="text-sm font-medium text-zinc-800 truncate mb-2" title={r.title}>
                      {r.title}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {showResume && (
                        <button
                          type="button"
                          disabled={!hasResumeBody}
                          title={hasResumeBody ? '' : '该版本未保存简历正文'}
                          onClick={() => {
                            if (!hasResumeBody) return;
                            onPick(r, 'resume');
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-200 text-zinc-800 hover:bg-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <FileText size={12} />
                          载入简历
                        </button>
                      )}
                      {showJd && (
                        <button
                          type="button"
                          disabled={!hasJd}
                          title={hasJd ? '' : '该版本未保存目标 JD'}
                          onClick={() => {
                            if (!hasJd) return;
                            onPick(r, 'jd');
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-200 text-zinc-800 hover:bg-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Briefcase size={12} />
                          载入 JD
                        </button>
                      )}
                      {showBoth && (
                        <button
                          type="button"
                          disabled={!hasJd || !hasResumeBody}
                          title={
                            !hasResumeBody
                              ? '该版本未保存简历正文'
                              : hasJd
                                ? '载入该版本的简历正文与 JD'
                                : '该版本未保存 JD，无法同时载入'
                          }
                          onClick={() => {
                            if (!hasJd || !hasResumeBody) return;
                            onPick(r, 'both');
                            onClose();
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-200 text-zinc-800 hover:bg-zinc-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <Layers size={12} />
                          同时载入简历+JD
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};

export default SavedResumePickModal;
