import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Plus, Trash2, Edit3, X, Download, FileText, Image as ImageIcon, Loader2, Tag } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getNotesForUser,
  getNotesForUserLinkedToPlan,
  createNote,
  updateNote,
  deleteNote,
  uploadNoteImage,
  getSignedImageUrls,
} from '../services/noteService';
import type { SavedPlan } from '../services/planService';
import type { PlanNote, PlanTask } from '../types';

export interface PlanNotesProps {
  userId: string;
  savedPlans: SavedPlan[];
  /** 仅展示关联到该计划的笔记；新建时默认勾选该计划 */
  filterPlanId?: string | null;
  onClearFilter?: () => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildTasksByWeek(tasks: PlanTask[]): Map<number, PlanTask[]> {
  const map = new Map<number, PlanTask[]>();
  tasks.forEach(t => {
    const list = map.get(t.weekNumber) || [];
    list.push(t);
    map.set(t.weekNumber, list);
  });
  return map;
}

function selectedToArrays(selected: string[]): { weeks: number[]; taskIds: string[] } {
  const weeks: number[] = [];
  const taskIds: string[] = [];
  selected.forEach(id => {
    if (id.startsWith('week-')) weeks.push(parseInt(id.replace('week-', ''), 10));
    else if (id.startsWith('task-')) taskIds.push(id.replace('task-', ''));
  });
  return { weeks, taskIds };
}

function buildGlobalTaskMap(plans: SavedPlan[]): Map<string, string> {
  const m = new Map<string, string>();
  plans.forEach(p => p.plan_data.tasks.forEach(t => m.set(t.id, t.title)));
  return m;
}

function collectExportTags(
  note: PlanNote,
  taskMap: Map<string, string>,
  planTitleById: Map<string, string>,
): string[] {
  const tags: string[] = [];
  (note.linked_plan_ids || []).forEach(id => {
    const n = planTitleById.get(id);
    if (n) tags.push(`计划：${n}`);
  });
  if (note.plan_id && !note.linked_plan_ids?.includes(note.plan_id)) {
    const n = planTitleById.get(note.plan_id);
    if (n) tags.push(`计划：${n}`);
  }
  (note.linked_weeks || []).forEach(w => tags.push(`第${w}周`));
  (note.linked_task_ids || []).forEach(id => tags.push(taskMap.get(id) || id));
  (note.linked_custom_tags || []).forEach(t => tags.push(t));
  return tags;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 只读展示：将 http(s) URL 渲染为可点击链接，其余为纯文本（保留换行由父级 whitespace-pre-wrap 处理） */
function renderNoteContentWithLinks(text: string): React.ReactNode {
  const re = /(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi;
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      nodes.push(text.slice(last, m.index));
    }
    const url = m[1];
    nodes.push(
      <a
        key={`u-${key++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 underline break-all hover:text-blue-800"
      >
        {url}
      </a>,
    );
    last = m.index + url.length;
  }
  if (last < text.length) {
    nodes.push(text.slice(last));
  }
  return nodes.length > 0 ? nodes : text;
}

function filenameStubFromNote(note: PlanNote): string {
  const raw = note.content.trim().split(/\r?\n/).find(l => l.trim()) || '笔记';
  const stub = raw
    .replace(/[\\/:*?"<>|]/g, '')
    .slice(0, 24)
    .trim();
  return stub || '笔记';
}

function exportSingleNoteAsTxt(note: PlanNote, taskMap: Map<string, string>, planTitleById: Map<string, string>) {
  const tags = collectExportTags(note, taskMap, planTitleById);
  const tagLine = tags.length > 0 ? `关联：${tags.join('、')}` : '';
  const imgs = note.images || [];
  const body = [
    `--- ${formatTime(note.created_at)} ---`,
    tagLine,
    note.content,
    imgs.length > 0 ? `[${imgs.length} 张图片，请使用 PDF 导出查看]` : '',
    '',
  ]
    .filter(Boolean)
    .join('\n');

  const text = `求职笔记（单条）\n导出时间：${new Date().toLocaleString()}\n\n${body}`;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safe = filenameStubFromNote(note);
  a.download = `${safe}_${new Date().toISOString().split('T')[0]}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportSingleNoteAsPdf(
  note: PlanNote,
  taskMap: Map<string, string>,
  planTitleById: Map<string, string>,
  urlMap: Map<string, string>,
) {
  const tags = collectExportTags(note, taskMap, planTitleById);
  const tagStr =
    tags.length > 0
      ? `<div style="margin-bottom:6px">${tags.map(t => `<span style="display:inline-block;padding:1px 6px;margin-right:4px;background:#f4f4f5;border-radius:4px;font-size:11px;color:#71717a">${escapeHtml(t)}</span>`).join('')}</div>`
      : '';
  const imgs = note.images || [];
  const resolvedImgs = imgs.map(p => urlMap.get(p)).filter(Boolean);
  const imgStr =
    resolvedImgs.length > 0
      ? `<div style="margin-top:8px">${resolvedImgs.map(u => `<img src="${u}" style="width:80px;height:80px;object-fit:cover;border-radius:6px;margin-right:6px;display:inline-block" />`).join('')}</div>`
      : '';
  const safeContent = escapeHtml(note.content);
  const noteHtml = `<div style="padding:12px 0">${tagStr}<p style="font-size:13px;line-height:1.8;color:#3f3f46;white-space:pre-wrap;margin:0">${safeContent}</p>${imgStr}<div style="font-size:11px;color:#a1a1aa;margin-top:8px">${formatTime(note.created_at)}</div></div>`;

  const title = escapeHtml(filenameStubFromNote(note));
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title><style>@page{margin:20mm}body{font-family:-apple-system,system-ui,sans-serif;color:#18181b;max-width:600px;margin:0 auto}</style></head><body><h2 style="font-size:16px;margin-bottom:4px">求职笔记</h2><p style="font-size:12px;color:#a1a1aa;margin-bottom:16px">导出于 ${new Date().toLocaleString()}</p>${noteHtml}</body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.onafterprint = () => w.close();
  setTimeout(() => w.print(), 300);
}

const PlanNotes: React.FC<PlanNotesProps> = ({ userId, savedPlans, filterPlanId, onClearFilter }) => {
  const { user } = useAuth();
  const [notes, setNotes] = useState<PlanNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PlanNote | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [signedUrls, setSignedUrls] = useState<Map<string, string>>(new Map());

  const [content, setContent] = useState('');
  const [linkedPlanIds, setLinkedPlanIds] = useState<string[]>([]);
  const [contextPlanId, setContextPlanId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTags, setCustomTags] = useState<string[]>([]);
  const [customTagInput, setCustomTagInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const customTagInputRef = useRef<HTMLInputElement>(null);

  const planTitleById = useMemo(() => {
    const m = new Map<string, string>();
    savedPlans.forEach(p => m.set(p.id, p.title));
    return m;
  }, [savedPlans]);

  const globalTaskMap = useMemo(() => buildGlobalTaskMap(savedPlans), [savedPlans]);

  const contextPlan = useMemo(
    () => (contextPlanId ? savedPlans.find(p => p.id === contextPlanId) : undefined),
    [savedPlans, contextPlanId],
  );
  const contextTasks = contextPlan?.plan_data.tasks ?? [];
  const totalWeeks = contextPlan?.plan_data.totalWeeks ?? 0;
  const tasksByWeek = useMemo(() => buildTasksByWeek(contextTasks), [contextTasks]);

  const filterPlanTitle = filterPlanId ? planTitleById.get(filterPlanId) : null;

  useEffect(() => {
    if (linkedPlanIds.length === 0) {
      if (contextPlanId !== null) setContextPlanId(null);
      return;
    }
    if (!contextPlanId || !linkedPlanIds.includes(contextPlanId)) {
      setContextPlanId(linkedPlanIds[0]);
    }
  }, [linkedPlanIds, contextPlanId]);

  const loadNotes = useCallback(async () => {
    if (!userId) {
      setNotes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = filterPlanId
      ? await getNotesForUserLinkedToPlan(userId, filterPlanId)
      : await getNotesForUser(userId);
    setNotes(data);

    const allPaths = data.flatMap(n => n.images || []);
    if (allPaths.length > 0) {
      const urls = await getSignedImageUrls(allPaths);
      setSignedUrls(prev => {
        const next = new Map(prev);
        urls.forEach((v, k) => next.set(k, v));
        return next;
      });
    }

    setLoading(false);
  }, [userId, filterPlanId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  const resetEditor = () => {
    setContent('');
    setLinkedPlanIds(filterPlanId ? [filterPlanId] : []);
    setContextPlanId(filterPlanId ?? null);
    setSelectedTags([]);
    setCustomTags([]);
    setCustomTagInput('');
    setImages([]);
    setEditing(null);
    setShowEditor(false);
    setShowTagPicker(false);
    setSaveError(null);
    setImageUploadError(null);
  };

  const openNewNote = () => {
    setEditing(null);
    setSaveError(null);
    setImageUploadError(null);
    setContent('');
    setLinkedPlanIds(filterPlanId ? [filterPlanId] : []);
    setContextPlanId(filterPlanId ?? null);
    setSelectedTags([]);
    setCustomTags([]);
    setCustomTagInput('');
    setImages([]);
    setShowEditor(true);
    setShowTagPicker(false);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const openEditNote = (note: PlanNote) => {
    setEditing(note);
    setSaveError(null);
    setImageUploadError(null);
    setContent(note.content);
    const lp = note.linked_plan_ids?.length ? [...note.linked_plan_ids] : note.plan_id ? [note.plan_id] : [];
    setLinkedPlanIds(lp);
    setContextPlanId(lp[0] ?? null);
    setSelectedTags([
      ...(note.linked_weeks || []).map(w => `week-${w}`),
      ...(note.linked_task_ids || []).map(id => `task-${id}`),
    ]);
    setCustomTags(note.linked_custom_tags || []);
    setImages(note.images || []);
    setShowEditor(true);
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const handleSave = async () => {
    if (!user || !content.trim()) return;
    setSaving(true);
    setSaveError(null);
    const { weeks, taskIds } = selectedToArrays(selectedTags);

    if (editing) {
      const { success, error } = await updateNote(editing.id, {
        content: content.trim(),
        linkedPlanIds: linkedPlanIds,
        linkedWeeks: weeks,
        linkedTaskIds: taskIds,
        linkedCustomTags: customTags,
        images,
      });
      setSaving(false);
      if (!success) {
        setSaveError(error || '保存失败，请检查网络后重试');
        return;
      }
    } else {
      const { data, error } = await createNote({
        userId: user.id,
        content: content.trim(),
        linkedPlanIds,
        linkedWeeks: weeks,
        linkedTaskIds: taskIds,
        linkedCustomTags: customTags,
        images,
      });
      setSaving(false);
      if (error || !data) {
        setSaveError(error || '保存失败，请检查网络后重试');
        return;
      }
    }

    resetEditor();
    void loadNotes();
  };

  const handleDelete = async (noteId: string) => {
    setDeleteConfirmId(null);
    await deleteNote(noteId);
    void loadNotes();
  };

  const handleImageUpload = async (file: File) => {
    if (!user) return;
    setUploading(true);
    setImageUploadError(null);
    const { path, error } = await uploadNoteImage(user.id, file);
    if (path) {
      setImages(prev => [...prev, path]);
      const urls = await getSignedImageUrls([path]);
      setSignedUrls(prev => {
        const next = new Map(prev);
        urls.forEach((v, k) => next.set(k, v));
        return next;
      });
    } else if (error) {
      setImageUploadError(
        error.includes('Bucket not found') ? '图片存储未配置，请联系管理员或在 Supabase 创建 plan-notes 存储桶' : error,
      );
    }
    setUploading(false);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) void handleImageUpload(file);
        break;
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file && file.type.startsWith('image/')) void handleImageUpload(file);
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev =>
      prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId],
    );
  };

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  const addCustomTag = () => {
    const t = customTagInput.trim();
    if (t && !customTags.includes(t)) {
      setCustomTags(prev => [...prev, t]);
      setCustomTagInput('');
    }
  };

  const removeCustomTag = (t: string) => {
    setCustomTags(prev => prev.filter(x => x !== t));
  };

  const toggleLinkedPlan = (planId: string) => {
    setLinkedPlanIds(prev =>
      prev.includes(planId) ? prev.filter(id => id !== planId) : [...prev, planId],
    );
  };

  const renderNoteTags = (note: PlanNote) => {
    const tags: string[] = [];
    (note.linked_plan_ids || []).forEach(id => {
      const t = planTitleById.get(id);
      if (t) tags.push(t);
    });
    if (note.plan_id && !note.linked_plan_ids?.includes(note.plan_id)) {
      const t = planTitleById.get(note.plan_id);
      if (t) tags.push(t);
    }
    (note.linked_weeks || []).forEach(w => tags.push(`第${w}周`));
    (note.linked_task_ids || []).forEach(id => tags.push(globalTaskMap.get(id) || ''));
    (note.linked_custom_tags || []).forEach(t => tags.push(t));
    return tags.filter(Boolean);
  };

  const structuredTagsDisabled = linkedPlanIds.length === 0;

  const handleExportNoteTxt = useCallback(
    (note: PlanNote) => {
      exportSingleNoteAsTxt(note, globalTaskMap, planTitleById);
    },
    [globalTaskMap, planTitleById],
  );

  const handleExportNotePdf = useCallback(
    async (note: PlanNote) => {
      const paths = note.images || [];
      const map = new Map(signedUrls);
      const missing = paths.filter(p => !map.has(p));
      if (missing.length > 0) {
        const urls = await getSignedImageUrls(missing);
        urls.forEach((v, k) => map.set(k, v));
      }
      exportSingleNoteAsPdf(note, globalTaskMap, planTitleById, map);
    },
    [globalTaskMap, planTitleById, signedUrls],
  );

  if (!userId) {
    return (
      <div className="py-16 text-center text-sm text-zinc-500">
        请先登录后使用求职笔记本。
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 size={24} className="animate-spin mx-auto text-zinc-400 mb-3" />
        <p className="text-sm text-zinc-500">加载笔记...</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {filterPlanId && filterPlanTitle && (
        <div className="mb-4 flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-zinc-100 border border-zinc-200 text-[12px] text-zinc-700">
          <span>
            仅显示关联到「<strong>{filterPlanTitle}</strong>」的笔记
          </span>
          {onClearFilter && (
            <button
              type="button"
              onClick={onClearFilter}
              className="text-zinc-600 underline font-medium hover:text-zinc-900"
            >
              查看全部笔记
            </button>
          )}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">我的求职笔记本</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {notes.length > 0 ? `共 ${notes.length} 条笔记` : '记录你的学习心得、竞品分析、面试复盘...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openNewNote}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <Plus size={12} />
            添加笔记
          </button>
        </div>
      </div>

      {showEditor && (
        <div className="mb-6 border border-zinc-200 rounded-xl bg-white overflow-hidden">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            onPaste={handlePaste}
            placeholder="写下你的学习笔记、竞品分析、面试感想、任何想记录的内容..."
            rows={6}
            className="w-full px-4 py-3 text-sm text-zinc-900 placeholder-zinc-300 resize-none focus:outline-none border-b border-zinc-100"
          />

          {images.length > 0 && (
            <div className="px-4 py-2 flex flex-wrap gap-2 border-b border-zinc-100">
              {images.map((path, i) => (
                <div key={path + i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-zinc-200 group">
                  <img src={signedUrls.get(path) || ''} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removeImage(i)}
                    className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={14} className="text-white" />
                  </button>
                </div>
              ))}
              {uploading && (
                <div className="w-16 h-16 rounded-lg border border-zinc-200 flex items-center justify-center">
                  <Loader2 size={14} className="animate-spin text-zinc-400" />
                </div>
              )}
            </div>
          )}

          <div className="px-4 py-3 border-b border-zinc-100 space-y-3">
            <div>
              <p className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-2">关联求职计划（可选，可多选）</p>
              {savedPlans.length === 0 ? (
                <p className="text-[11px] text-zinc-400">暂无保存的计划；可先不关联，仅用下方自定义标签。</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {savedPlans.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleLinkedPlan(p.id)}
                      className={`px-2.5 py-1 text-[11px] rounded-lg border transition-colors max-w-[200px] truncate ${
                        linkedPlanIds.includes(p.id)
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'
                      }`}
                      title={p.title}
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {linkedPlanIds.length > 1 && (
              <div>
                <label className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider block mb-1">
                  周 / 任务关联基于哪份计划
                </label>
                <select
                  value={contextPlanId || ''}
                  onChange={e => setContextPlanId(e.target.value || null)}
                  className="w-full max-w-sm px-2 py-1.5 text-[12px] border border-zinc-200 rounded-lg bg-white text-zinc-800"
                >
                  {linkedPlanIds.map(id => (
                    <option key={id} value={id}>
                      {planTitleById.get(id) || id}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div
            className={`px-4 py-3 border-b border-zinc-100 ${structuredTagsDisabled ? 'opacity-50 pointer-events-none' : ''}`}
          >
            {structuredTagsDisabled && (
              <p className="text-[11px] text-zinc-400 mb-2">先勾选至少一个求职计划后，可选择关联到周 / 任务。</p>
            )}
            <button
              type="button"
              onClick={() => setShowTagPicker(!showTagPicker)}
              disabled={structuredTagsDisabled}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 transition-colors mb-2 disabled:pointer-events-none"
            >
              <Tag size={11} />
              {selectedTags.length + customTags.length > 0
                ? `已关联 ${selectedTags.length + customTags.length} 项`
                : '关联到周/任务（可选）'}
            </button>
            {(selectedTags.length > 0 || customTags.length > 0) && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {selectedTags.map(tagId => {
                  const isWeek = tagId.startsWith('week-');
                  const display = isWeek
                    ? `第${tagId.replace('week-', '')}周`
                    : contextTasks.find(t => `task-${t.id}` === tagId)?.title ||
                      globalTaskMap.get(tagId.replace('task-', '')) ||
                      tagId;
                  return (
                    <span
                      key={tagId}
                      className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 text-zinc-600 text-[11px] rounded-md"
                    >
                      {display}
                      <button type="button" onClick={() => toggleTag(tagId)} className="text-zinc-400 hover:text-zinc-600">
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
                {customTags.map(t => (
                  <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 text-zinc-600 text-[11px] rounded-md">
                    {t}
                    <button type="button" onClick={() => removeCustomTag(t)} className="text-zinc-400 hover:text-zinc-600">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {showTagPicker && !structuredTagsDisabled && (
              <div className="space-y-4 max-h-56 overflow-y-auto">
                {totalWeeks > 0 && (
                  <>
                    <div>
                      <div className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-1.5">按周关联</div>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(w => {
                          const id = `week-${w}`;
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={() => toggleTag(id)}
                              className={`px-2 py-1 text-[11px] rounded-md transition-colors ${
                                selectedTags.includes(id) ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                              }`}
                            >
                              第{w}周
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-1.5">按任务关联</div>
                      <div className="space-y-3">
                        {Array.from({ length: totalWeeks }, (_, i) => i + 1).map(week => {
                          const weekTasks = tasksByWeek.get(week) || [];
                          if (weekTasks.length === 0) return null;
                          return (
                            <div key={week} className="space-y-1">
                              <div className="text-[11px] text-zinc-500">第{week}周</div>
                              <div className="flex flex-wrap gap-1.5 pl-2">
                                {weekTasks.map(t => {
                                  const id = `task-${t.id}`;
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      onClick={() => toggleTag(id)}
                                      className={`px-2 py-1 text-[11px] rounded-md transition-colors text-left max-w-full truncate ${
                                        selectedTags.includes(id) ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                                      }`}
                                      title={t.title}
                                    >
                                      {t.title.length > 14 ? `${t.title.slice(0, 14)}…` : t.title}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
                <div>
                  <div className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider mb-1.5">自定义标签</div>
                  <div className="flex gap-1.5">
                    <input
                      ref={customTagInputRef}
                      type="text"
                      value={customTagInput}
                      onChange={e => setCustomTagInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addCustomTag())}
                      placeholder="输入后回车添加"
                      className="flex-1 px-2 py-1 text-[11px] border border-zinc-200 rounded-md focus:outline-none focus:ring-1 focus:ring-zinc-400"
                    />
                    <button
                      type="button"
                      onClick={addCustomTag}
                      className="px-2 py-1 text-[11px] bg-zinc-100 text-zinc-600 rounded-md hover:bg-zinc-200 transition-colors"
                    >
                      添加
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600 transition-colors disabled:opacity-50"
              >
                <ImageIcon size={12} />
                上传图片
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
              <span className="text-[10px] text-zinc-300">Ctrl+V 可粘贴截图</span>
              {imageUploadError && (
                <span className="text-[10px] text-red-600 max-w-[200px] leading-tight">{imageUploadError}</span>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              {saveError && (
                <p className="text-[11px] text-red-600 max-w-[240px] text-right leading-snug">{saveError}</p>
              )}
              <div className="flex items-center gap-2">
                <button type="button" onClick={resetEditor} className="px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-700 transition-colors">
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={!content.trim() || saving}
                  className="px-4 py-1.5 text-xs font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  {saving ? '保存中...' : editing ? '更新笔记' : '保存笔记'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {notes.length === 0 && !showEditor ? (
        <div className="py-16 text-center">
          <FileText size={40} className="mx-auto text-zinc-300 mb-4" />
          <p className="text-zinc-500 mb-1">还没有笔记</p>
          <p className="text-xs text-zinc-400 mb-6">可关联多个求职计划，或用自定义标签与计划、JD 等自行对应</p>
          <button
            type="button"
            onClick={openNewNote}
            className="px-6 py-2.5 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
          >
            写第一条笔记
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {notes.map(note => {
            const tags = renderNoteTags(note);
            const imgs = note.images || [];
            return (
              <div key={note.id} className="border border-zinc-200 rounded-xl bg-white p-4">
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {tags.map((tag, i) => (
                      <span key={`${note.id}-t-${i}`} className="px-2 py-0.5 bg-zinc-100 text-zinc-500 text-[11px] rounded-md">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}

                <p className="text-sm text-zinc-700 whitespace-pre-wrap leading-relaxed">
                  {renderNoteContentWithLinks(note.content)}
                </p>

                {imgs.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {imgs.map((path, i) => {
                      const src = signedUrls.get(path) || '';
                      return src ? (
                        <a key={path + i} href={src} target="_blank" rel="noopener noreferrer">
                          <img src={src} alt="" className="w-20 h-20 object-cover rounded-lg border border-zinc-200 hover:opacity-80 transition-opacity" />
                        </a>
                      ) : null;
                    })}
                  </div>
                )}

                <div className="flex items-center justify-between mt-3 pt-2 border-t border-zinc-50 gap-2 flex-wrap">
                  <span className="text-[11px] text-zinc-400">{formatTime(note.created_at)}</span>
                  <div className="flex items-center gap-0.5 sm:gap-1">
                    <button
                      type="button"
                      onClick={() => handleExportNoteTxt(note)}
                      className="p-1 text-zinc-400 hover:text-zinc-700 rounded transition-colors"
                      title="导出本条为 TXT"
                    >
                      <FileText size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleExportNotePdf(note)}
                      className="p-1 text-zinc-400 hover:text-zinc-700 rounded transition-colors"
                      title="导出本条为 PDF（打印）"
                    >
                      <Download size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditNote(note)}
                      className="p-1 text-zinc-400 hover:text-zinc-600 rounded transition-colors"
                      title="编辑"
                    >
                      <Edit3 size={13} />
                    </button>
                    {deleteConfirmId === note.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleDelete(note.id)}
                          className="px-2 py-0.5 text-[11px] text-red-600 bg-red-50 rounded hover:bg-red-100"
                        >
                          确认删除
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteConfirmId(null)}
                          className="px-2 py-0.5 text-[11px] text-zinc-500 bg-zinc-100 rounded hover:bg-zinc-200"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmId(note.id)}
                        className="p-1 text-zinc-400 hover:text-red-500 rounded transition-colors"
                        title="删除"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PlanNotes;
