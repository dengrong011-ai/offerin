import { supabase } from './supabaseClient';
import type { PlanNote } from '../types';

function normalizeNoteRow(row: Record<string, unknown>): PlanNote {
  const linked =
    (row.linked_plan_ids as string[] | null | undefined)?.filter(Boolean) ?? [];
  const legacyPid = row.plan_id as string | null | undefined;
  return {
    ...(row as unknown as PlanNote),
    linked_plan_ids: linked.length > 0 ? linked : legacyPid ? [legacyPid] : [],
    plan_id: legacyPid ?? undefined,
  };
}

/** 当前用户全部笔记（不按计划筛选） */
export async function getNotesForUser(userId: string): Promise<{ data: PlanNote[]; error?: string }> {
  if (!userId) return { data: [] };
  try {
    const { data, error } = await supabase
      .from('plan_notes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { data: (data || []).map(r => normalizeNoteRow(r as Record<string, unknown>)) };
  } catch (error: unknown) {
    console.error('获取笔记失败:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return { data: [], error: msg };
  }
}

/** 至少关联到指定计划（linked_plan_ids 含该 id，或兼容旧数据 plan_id） */
export async function getNotesForUserLinkedToPlan(
  userId: string,
  planId: string,
): Promise<{ data: PlanNote[]; error?: string }> {
  const { data: all, error } = await getNotesForUser(userId);
  if (error) return { data: [], error };
  const filtered = all.filter(
    n => n.linked_plan_ids.includes(planId) || n.plan_id === planId,
  );
  return { data: filtered };
}

/** @deprecated 使用 getNotesForUserLinkedToPlan */
export async function getNotes(planId: string): Promise<{ data: PlanNote[]; error?: string }> {
  const { data: session } = await supabase.auth.getUser();
  const uid = session.user?.id;
  if (!uid) return { data: [], error: '未登录' };
  return getNotesForUserLinkedToPlan(uid, planId);
}

export async function createNote(params: {
  userId: string;
  content: string;
  linkedPlanIds?: string[];
  linkedWeeks?: number[];
  linkedTaskIds?: string[];
  linkedCustomTags?: string[];
  images?: string[];
}): Promise<{ data: PlanNote | null; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('plan_notes')
      .insert({
        plan_id: null,
        user_id: params.userId,
        content: params.content,
        linked_plan_ids: params.linkedPlanIds?.length ? params.linkedPlanIds : [],
        linked_weeks: params.linkedWeeks || [],
        linked_task_ids: params.linkedTaskIds || [],
        linked_custom_tags: params.linkedCustomTags || [],
        images: params.images || [],
      })
      .select()
      .single();

    if (error) throw error;
    return { data: normalizeNoteRow(data as Record<string, unknown>) };
  } catch (error: unknown) {
    console.error('创建笔记失败:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return { data: null, error: msg };
  }
}

export async function updateNote(
  noteId: string,
  updates: {
    content?: string;
    linkedPlanIds?: string[];
    linkedWeeks?: number[];
    linkedTaskIds?: string[];
    linkedCustomTags?: string[];
    images?: string[];
  },
): Promise<{ success: boolean; error?: string }> {
  try {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.content !== undefined) payload.content = updates.content;
    if (updates.linkedPlanIds !== undefined) payload.linked_plan_ids = updates.linkedPlanIds;
    if (updates.linkedWeeks !== undefined) payload.linked_weeks = updates.linkedWeeks;
    if (updates.linkedTaskIds !== undefined) payload.linked_task_ids = updates.linkedTaskIds;
    if (updates.linkedCustomTags !== undefined) payload.linked_custom_tags = updates.linkedCustomTags;
    if (updates.images !== undefined) payload.images = updates.images;
    if (updates.linkedPlanIds !== undefined) payload.plan_id = null;

    const { error } = await supabase.from('plan_notes').update(payload).eq('id', noteId);
    if (error) throw error;
    return { success: true };
  } catch (error: unknown) {
    console.error('更新笔记失败:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

export async function deleteNote(noteId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase.from('plan_notes').delete().eq('id', noteId);
    if (error) throw error;
    return { success: true };
  } catch (error: unknown) {
    console.error('删除笔记失败:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

/**
 * 上传图片到 private bucket，路径与计划解耦。
 */
export async function uploadNoteImage(
  userId: string,
  file: File,
): Promise<{ path: string | null; error?: string }> {
  try {
    const ext = file.name.split('.').pop() || 'png';
    const path = `${userId}/notes/${crypto.randomUUID()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('plan-notes')
      .upload(path, file, { contentType: file.type, upsert: false });

    if (uploadError) throw uploadError;
    return { path };
  } catch (error: unknown) {
    console.error('上传图片失败:', error);
    const msg = error instanceof Error ? error.message : String(error);
    return { path: null, error: msg };
  }
}

const SIGNED_URL_EXPIRY = 3600;

export async function getSignedImageUrls(paths: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (paths.length === 0) return map;

  const { data, error } = await supabase.storage
    .from('plan-notes')
    .createSignedUrls(paths, SIGNED_URL_EXPIRY);

  if (error || !data) return map;
  data.forEach(item => {
    if (item.signedUrl) map.set(item.path!, item.signedUrl);
  });
  return map;
}
