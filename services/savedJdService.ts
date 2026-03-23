import { supabase } from './supabaseClient';
import type { SavedJd } from '../types';

/** JD 库默认来源标签：本地上传 / 粘贴 / 识别录入 */
export const JD_LIBRARY_TAG_UPLOAD = '上传';

/** 职业探索中「生成参考 JD（demo）」保存时自动附带 */
export const JD_LIBRARY_TAG_GENERATED_DEMO = '生成demo';

/** 合并用户标签与系统来源标签（系统标签置顶且不重复） */
export function mergeWithSystemJdTags(userTags: string[], systemTag: string): string[] {
  const u = [...new Set(userTags.map(t => t.trim()).filter(Boolean))];
  const rest = u.filter(t => t !== systemTag);
  return [systemTag, ...rest];
}

/** 去掉正文开头（含前置空行）的第一行一级标题，避免与弹窗/列表标题重复展示 */
export function stripLeadingMarkdownH1(markdown: string): string {
  const s = markdown.replace(/^\uFEFF?/, '').replace(/\r\n/g, '\n');
  const lines = s.split('\n');
  let i = 0;
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i >= lines.length) return markdown;
  if (!/^#\s+\S/.test(lines[i].trim())) return markdown;
  const rest = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').trimStart();
  return rest.length > 0 ? rest : markdown;
}

export function parseTagInput(input: string): string[] {
  const parts = input
    .split(/[,，;；\s]+/)
    .map(t => t.trim())
    .filter(Boolean);
  return [...new Set(parts)];
}

/** 从识别后的正文猜一个标题：优先 Markdown 一级标题，否则取首行非空文字 */
export function suggestJdTitleFromText(raw: string): string {
  const s = raw.replace(/^\uFEFF?/, '').trim();
  if (!s) return '未命名 JD';
  const lines = s.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    const h1 = t.match(/^#\s+(.+)$/);
    if (h1) return h1[1].trim().slice(0, 100);
    const cleaned = t.replace(/^#+\s*/, '').trim();
    if (cleaned.length >= 2) return cleaned.slice(0, 100);
  }
  return '未命名 JD';
}

export const getSavedJds = async (
  userId: string,
): Promise<{ data: SavedJd[]; error?: string }> => {
  try {
    const { data, error } = await supabase
      .from('saved_jds')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return { data: (data || []) as SavedJd[] };
  } catch (error: unknown) {
    console.error('获取 JD 库失败:', error);
    return { data: [], error: error instanceof Error ? error.message : String(error) };
  }
};

export const createSavedJd = async (params: {
  userId: string;
  title: string;
  content: string;
  tags?: string[];
}): Promise<{ data: SavedJd | null; error?: string }> => {
  try {
    const { data, error } = await supabase
      .from('saved_jds')
      .insert({
        user_id: params.userId,
        title: params.title.trim(),
        content: params.content,
        tags: params.tags?.length ? params.tags : [],
      })
      .select()
      .single();

    if (error) throw error;
    return { data: data as SavedJd };
  } catch (error: unknown) {
    console.error('保存 JD 失败:', error);
    return { data: null, error: error instanceof Error ? error.message : String(error) };
  }
};

export const deleteSavedJd = async (id: string): Promise<{ success: boolean; error?: string }> => {
  try {
    const { error } = await supabase.from('saved_jds').delete().eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (error: unknown) {
    console.error('删除 JD 失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};

export const updateSavedJd = async (
  id: string,
  updates: { title?: string; content?: string; tags?: string[] },
): Promise<{ success: boolean; error?: string }> => {
  try {
    const row: Record<string, unknown> = {};
    if (updates.title !== undefined) row.title = updates.title.trim();
    if (updates.content !== undefined) row.content = updates.content;
    if (updates.tags !== undefined) row.tags = updates.tags;
    const { error } = await supabase.from('saved_jds').update(row).eq('id', id);
    if (error) throw error;
    return { success: true };
  } catch (error: unknown) {
    console.error('更新 JD 失败:', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
};
