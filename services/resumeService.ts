import { supabase } from './supabaseClient';
import type { SavedResume } from '../types';

// ============ 简历库 CRUD ============

/** 获取用户的所有简历（按收藏优先、更新时间倒序） */
export const getSavedResumes = async (
  userId: string
): Promise<{ data: SavedResume[]; error?: string }> => {
  try {
    const { data, error } = await supabase
      .from('saved_resumes')
      .select('*')
      .eq('user_id', userId)
      .order('is_favorited', { ascending: false })
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return { data: (data || []) as SavedResume[] };
  } catch (error: any) {
    console.error('获取简历列表失败:', error);
    return { data: [], error: error.message };
  }
};

/** 获取单个简历详情 */
export const getSavedResume = async (
  resumeId: string
): Promise<{ data: SavedResume | null; error?: string }> => {
  try {
    const { data, error } = await supabase
      .from('saved_resumes')
      .select('*')
      .eq('id', resumeId)
      .single();

    if (error) throw error;
    return { data: data as SavedResume };
  } catch (error: any) {
    console.error('获取简历详情失败:', error);
    return { data: null, error: error.message };
  }
};

/** 保存新简历 */
export const createSavedResume = async (params: {
  userId: string;
  title: string;
  resumeMarkdown: string;
  englishResumeMarkdown?: string;
  jobDescription?: string;
  aspiration?: string;
  densityMultiplier?: number;
  source?: 'reconstruction' | 'manual' | 'import';
}): Promise<{ data: SavedResume | null; error?: string }> => {
  try {
    const { data, error } = await supabase
      .from('saved_resumes')
      .insert({
        user_id: params.userId,
        title: params.title,
        resume_markdown: params.resumeMarkdown,
        english_resume_markdown: params.englishResumeMarkdown || null,
        job_description: params.jobDescription || null,
        aspiration: params.aspiration || null,
        density_multiplier: params.densityMultiplier || 1.0,
        source: params.source || 'reconstruction',
      })
      .select()
      .single();

    if (error) throw error;
    return { data: data as SavedResume };
  } catch (error: any) {
    console.error('保存简历失败:', error);
    return { data: null, error: error.message };
  }
};

/** 更新已保存的简历 */
export const updateSavedResume = async (
  resumeId: string,
  updates: {
    title?: string;
    resumeMarkdown?: string;
    englishResumeMarkdown?: string;
    jobDescription?: string;
    aspiration?: string;
    densityMultiplier?: number;
    isFavorited?: boolean;
  }
): Promise<{ success: boolean; error?: string }> => {
  try {
    const updateData: Record<string, any> = {};
    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.resumeMarkdown !== undefined) updateData.resume_markdown = updates.resumeMarkdown;
    if (updates.englishResumeMarkdown !== undefined) updateData.english_resume_markdown = updates.englishResumeMarkdown;
    if (updates.jobDescription !== undefined) updateData.job_description = updates.jobDescription;
    if (updates.aspiration !== undefined) updateData.aspiration = updates.aspiration;
    if (updates.densityMultiplier !== undefined) updateData.density_multiplier = updates.densityMultiplier;
    if (updates.isFavorited !== undefined) updateData.is_favorited = updates.isFavorited;

    const { error } = await supabase
      .from('saved_resumes')
      .update(updateData)
      .eq('id', resumeId);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('更新简历失败:', error);
    return { success: false, error: error.message };
  }
};

/** 删除简历 */
export const deleteSavedResume = async (
  resumeId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { error } = await supabase
      .from('saved_resumes')
      .delete()
      .eq('id', resumeId);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('删除简历失败:', error);
    return { success: false, error: error.message };
  }
};

/** 复制简历（创建副本） */
export const duplicateSavedResume = async (
  resumeId: string,
  userId: string
): Promise<{ data: SavedResume | null; error?: string }> => {
  try {
    // 先获取原简历
    const { data: original, error: fetchError } = await getSavedResume(resumeId);
    if (fetchError || !original) {
      return { data: null, error: fetchError || '简历不存在' };
    }

    // 创建副本
    return await createSavedResume({
      userId,
      title: `${original.title}（副本）`,
      resumeMarkdown: original.resume_markdown,
      englishResumeMarkdown: original.english_resume_markdown || undefined,
      jobDescription: original.job_description || undefined,
      aspiration: original.aspiration || undefined,
      densityMultiplier: original.density_multiplier,
      source: original.source,
    });
  } catch (error: any) {
    console.error('复制简历失败:', error);
    return { data: null, error: error.message };
  }
};

/** 切换收藏状态 */
export const toggleFavorite = async (
  resumeId: string,
  currentState: boolean
): Promise<{ success: boolean; error?: string }> => {
  return updateSavedResume(resumeId, { isFavorited: !currentState });
};

/** 获取用户简历数量 */
export const getResumeCount = async (
  userId: string
): Promise<{ count: number; error?: string }> => {
  try {
    const { count, error } = await supabase
      .from('saved_resumes')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) throw error;
    return { count: count || 0 };
  } catch (error: any) {
    console.error('获取简历数量失败:', error);
    return { count: 0, error: error.message };
  }
};

/** 从 Markdown 中提取姓名作为默认标题 */
export const extractResumeTitle = (markdown: string, jd?: string): string => {
  // 尝试从 Markdown 标题提取姓名
  const nameMatch = markdown.match(/^#\s+(.+)/m);
  const name = nameMatch ? nameMatch[1].trim() : '未命名';
  
  // 尝试从 JD 提取岗位名
  let position = '';
  if (jd) {
    const posMatch = jd.match(/(?:岗位|职位|title|role)[：:]\s*(.+)/i) 
      || jd.match(/^(.{2,20})(?:工程师|经理|总监|专员|顾问|设计师|分析师|运营|产品)/m);
    if (posMatch) {
      position = posMatch[1].trim().substring(0, 20);
    }
  }
  
  return position ? `${name} - ${position}` : name;
};
