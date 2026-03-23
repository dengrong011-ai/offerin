import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  getSavedJds,
  deleteSavedJd,
  createSavedJd,
  parseTagInput,
  suggestJdTitleFromText,
  stripLeadingMarkdownH1,
  mergeWithSystemJdTags,
  JD_LIBRARY_TAG_UPLOAD,
  JD_LIBRARY_TAG_GENERATED_DEMO,
} from '../services/savedJdService';
import { extractTextFromFile } from '../services/geminiService';
import type { SavedJd } from '../types';
import { ArrowLeft, Briefcase, Trash2, Copy, Loader2, X, Upload, FileText, Plus } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';

interface JdLibraryProps {
  onBack: () => void;
}

const SUPPORTED_JD_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
];

function jdSourceTagClass(tag: string): string {
  if (tag === JD_LIBRARY_TAG_UPLOAD) return 'bg-sky-50 text-sky-800 border border-sky-100';
  if (tag === JD_LIBRARY_TAG_GENERATED_DEMO) return 'bg-violet-50 text-violet-800 border border-violet-100';
  return 'bg-zinc-100 text-zinc-600';
}

const readFileToBase64 = (file: File): Promise<{ data: string; mime: string }> => {
  return new Promise((resolve, reject) => {
    if (file.size > 3 * 1024 * 1024) {
      reject(new Error('文件请小于 3MB'));
      return;
    }
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1]?.replace(/\s/g, '') || '';
      resolve({ data: base64, mime: file.type });
    };
    reader.onerror = () => reject(new Error('读取文件失败'));
  });
};

const JdLibrary: React.FC<JdLibraryProps> = ({ onBack }) => {
  const { user } = useAuth();
  const [list, setList] = useState<SavedJd[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<SavedJd | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [titleLocked, setTitleLocked] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data } = await getSavedJds(user.id);
    setList(data);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAddModal = useCallback(() => {
    setDraftContent('');
    setDraftTitle('');
    setDraftTags('');
    setTitleLocked(false);
    setAddError(null);
    setAddOpen(true);
  }, []);

  const applyContentAndSuggestTitle = useCallback((text: string, forceTitle = false) => {
    setDraftContent(text);
    if (!titleLocked || forceTitle) {
      setDraftTitle(suggestJdTitleFromText(text));
    }
  }, [titleLocked]);

  const handleJdFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !SUPPORTED_JD_FILE_TYPES.includes(file.type)) return;
    setExtracting(true);
    setAddError(null);
    try {
      const { data, mime } = await readFileToBase64(file);
      const text = await extractTextFromFile({ data, mimeType: mime });
      applyContentAndSuggestTitle(text, true);
      setTitleLocked(false);
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : '识别失败，请换格式或粘贴文本');
    } finally {
      setExtracting(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!user?.id) return;
    const content = draftContent.trim();
    if (!content) {
      setAddError('请先上传、识别或粘贴 JD 正文');
      return;
    }
    const title = draftTitle.trim() || suggestJdTitleFromText(content);
    setSaving(true);
    setAddError(null);
    const { data, error } = await createSavedJd({
      userId: user.id,
      title,
      content,
      tags: mergeWithSystemJdTags(parseTagInput(draftTags), JD_LIBRARY_TAG_UPLOAD),
    });
    setSaving(false);
    if (!data) {
      setAddError(error || '保存失败');
      return;
    }
    setAddOpen(false);
    await load();
  };

  const handleDelete = async (id: string) => {
    setBusyId(id);
    setDeleteId(null);
    await deleteSavedJd(id);
    await load();
    setBusyId(null);
    if (viewing?.id === id) setViewing(null);
  };

  return (
    <div className="min-h-screen bg-zinc-50/50 pb-16">
      <header className="sticky top-0 z-10 bg-white/90 backdrop-blur border-b border-zinc-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <button type="button" onClick={onBack} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800">
            <ArrowLeft size={16} />
            返回
          </button>
          <h1 className="text-[15px] font-semibold text-zinc-900 flex items-center gap-2">
            <Briefcase size={18} className="text-zinc-500" />
            JD 库
          </h1>
          <div className="w-14 shrink-0" aria-hidden />
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <p className="text-[13px] text-zinc-500 mb-4 leading-relaxed">
          支持<strong className="text-zinc-700">上传 PDF / Word / 截图</strong>自动识别，或<strong className="text-zinc-700">粘贴文本</strong>；标题会根据正文自动生成，可改。也可在职业探索里生成参考 JD 后点「保存到 JD 库」。可用
          <strong className="text-zinc-700">标签</strong>与简历、计划笔记等自行对应。使用已保存的 JD 时，请在<strong className="text-zinc-700">简历输入</strong>或<strong className="text-zinc-700">模拟面试</strong>中点「从 JD 库载入」。
        </p>

        {!loading && user?.id && (
          <button
            type="button"
            onClick={openAddModal}
            className="w-full mb-4 py-3 rounded-xl border-2 border-dashed border-zinc-200 bg-white text-sm text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 flex items-center justify-center gap-2 transition-colors"
          >
            <Plus size={16} />
            上传或粘贴添加 JD
          </button>
        )}

        {loading ? (
          <div className="py-20 flex justify-center text-zinc-400">
            <Loader2 className="animate-spin" size={28} />
          </div>
        ) : list.length === 0 ? (
          <div className="py-16 text-center text-sm text-zinc-500 border border-dashed border-zinc-200 rounded-xl bg-white space-y-2">
            <p>暂无条目。</p>
            <p className="text-[12px] text-zinc-400 px-4">
              点击「上传或粘贴添加 JD」添加，或在职业探索生成参考 JD 后点「保存到 JD 库」。
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {list.map(jd => (
              <li key={jd.id} className="bg-white border border-zinc-200 rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-zinc-900">{jd.title}</p>
                    <p className="text-[11px] text-zinc-400 mt-1">
                      {new Date(jd.updated_at).toLocaleString('zh-CN')}
                    </p>
                    {jd.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {jd.tags.map(t => (
                          <span key={t} className={`px-2 py-0.5 rounded-md text-[11px] ${jdSourceTagClass(t)}`}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => setViewing(jd)}
                      className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
                    >
                      查看
                    </button>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(jd.content)}
                      className="text-xs p-1.5 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
                      title="复制全文"
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(jd.id)}
                      disabled={busyId === jd.id}
                      className="text-xs p-1.5 rounded-lg border border-red-100 text-red-500 hover:bg-red-50 disabled:opacity-50"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>

      {addOpen && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="关闭" onClick={() => setAddOpen(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl border border-zinc-200 w-full max-w-lg max-h-[92vh] flex flex-col z-[56]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 shrink-0">
              <h3 className="text-sm font-semibold text-zinc-900">添加 JD</h3>
              <button type="button" onClick={() => setAddOpen(false)} className="p-1 rounded-lg text-zinc-400 hover:bg-zinc-100">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 p-4 space-y-3">
              {addError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{addError}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.doc,.docx,image/*" onChange={e => void handleJdFileChange(e)} />
                <button
                  type="button"
                  disabled={extracting}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {extracting ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {extracting ? '识别中…' : '上传 PDF / Word / 图片'}
                </button>
                <span className="text-[11px] text-zinc-400 self-center">≤3MB，识别结果填入下方正文</span>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-zinc-700 mb-1">标题（可修改）</label>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={e => {
                    setTitleLocked(true);
                    setDraftTitle(e.target.value);
                  }}
                  placeholder="将根据正文自动生成"
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                />
                <button
                  type="button"
                  className="mt-1 text-[11px] text-zinc-500 hover:text-zinc-800"
                  onClick={() => {
                    setDraftTitle(suggestJdTitleFromText(draftContent));
                    setTitleLocked(false);
                  }}
                >
                  根据正文重新生成标题
                </button>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-zinc-700 mb-1">标签（选填）</label>
                <p className="text-[10px] text-zinc-400 mb-1 leading-relaxed">
                  保存时将自动附带「<strong className="text-zinc-600">{JD_LIBRARY_TAG_UPLOAD}</strong>」；与职业探索保存的「{JD_LIBRARY_TAG_GENERATED_DEMO}」区分。
                </p>
                <input
                  type="text"
                  value={draftTags}
                  onChange={e => setDraftTags(e.target.value)}
                  placeholder="逗号、空格分隔"
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-zinc-700 mb-1 flex items-center gap-1">
                  <FileText size={12} className="text-zinc-400" />
                  JD 正文（可直接粘贴或编辑识别结果）
                </label>
                <textarea
                  value={draftContent}
                  onChange={e => {
                    const v = e.target.value;
                    setDraftContent(v);
                    if (!titleLocked) setDraftTitle(suggestJdTitleFromText(v));
                  }}
                  rows={12}
                  placeholder="粘贴岗位描述全文，或先上传文件识别…"
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 resize-y min-h-[160px] font-mono text-[12px] leading-relaxed"
                />
                {draftContent && <p className="mt-1 text-[11px] text-zinc-400">{draftContent.length} 字</p>}
              </div>
            </div>
            <div className="px-4 py-3 border-t border-zinc-100 flex justify-end gap-2 shrink-0">
              <button type="button" onClick={() => setAddOpen(false)} className="px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg">
                取消
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSaveDraft()}
                className="px-4 py-2 text-sm font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存到 JD 库'}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" aria-label="关闭" onClick={() => setViewing(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl border border-zinc-200 w-full max-w-2xl max-h-[88vh] flex flex-col z-[51]">
            <div className="flex items-start justify-between gap-2 px-4 py-3 border-b border-zinc-100 shrink-0">
              <div className="min-w-0 flex-1 pr-2">
                <h3 className="text-sm font-semibold text-zinc-900 truncate">{viewing.title}</h3>
                {viewing.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {viewing.tags.map(t => (
                      <span key={t} className={`px-2 py-0.5 rounded-md text-[11px] ${jdSourceTagClass(t)}`}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => setViewing(null)} className="p-1 rounded-lg text-zinc-400 hover:bg-zinc-100 shrink-0">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto flex-1 px-4 py-3 prose prose-sm prose-zinc max-w-none">
              <MarkdownRenderer content={stripLeadingMarkdownH1(viewing.content)} mode="diagnosis" />
            </div>
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-black/40" onClick={() => setDeleteId(null)} />
          <div className="relative bg-white rounded-xl shadow-lg border border-zinc-200 p-5 max-w-sm z-[61]">
            <p className="text-sm text-zinc-700 mb-4">确定删除这条 JD？</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteId(null)} className="px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 rounded-lg">
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(deleteId)}
                className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default JdLibrary;
