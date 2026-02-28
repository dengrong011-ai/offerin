import { supabase } from './supabaseClient';
import type { InterviewMessage } from '../types';

export interface SavedInterviewRecord {
  id: string;
  user_id: string;
  title: string;
  interview_mode: 'simulation' | 'interactive';
  interviewer_role: string;
  total_rounds: number;
  messages_json: InterviewMessage[];
  summary: string;
  is_favorited: boolean;
  created_at: string;
  updated_at: string;
}

// 保存面试记录
export const saveInterviewRecord = async (
  userId: string,
  data: {
    title: string;
    interview_mode: 'simulation' | 'interactive';
    interviewer_role: string;
    total_rounds: number;
    messages: InterviewMessage[];
  }
): Promise<{ id: string } | null> => {
  try {
    // 提取 summary（从 messages 中找到 summary 类型的消息）
    const summaryMsg = data.messages.find(m => m.type === 'summary');
    const summary = summaryMsg?.content || '';

    const { data: record, error } = await supabase
      .from('saved_interview_records')
      .insert({
        user_id: userId,
        title: data.title,
        interview_mode: data.interview_mode,
        interviewer_role: data.interviewer_role,
        total_rounds: data.total_rounds,
        messages_json: JSON.stringify(data.messages),
        summary: summary,
      })
      .select('id')
      .single();

    if (error) throw error;
    return record;
  } catch (error) {
    console.error('保存面试记录失败:', error);
    return null;
  }
};

// 获取用户的所有面试记录
export const getSavedInterviewRecords = async (
  userId: string
): Promise<SavedInterviewRecord[]> => {
  try {
    const { data, error } = await supabase
      .from('saved_interview_records')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    return (data || []).map(record => ({
      ...record,
      messages_json: typeof record.messages_json === 'string'
        ? JSON.parse(record.messages_json)
        : record.messages_json,
    }));
  } catch (error) {
    console.error('获取面试记录失败:', error);
    return [];
  }
};

// 删除面试记录
export const deleteInterviewRecord = async (recordId: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('saved_interview_records')
      .delete()
      .eq('id', recordId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('删除面试记录失败:', error);
    return false;
  }
};

// 切换收藏状态
export const toggleInterviewFavorite = async (recordId: string, currentValue: boolean): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('saved_interview_records')
      .update({ is_favorited: !currentValue })
      .eq('id', recordId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('切换收藏失败:', error);
    return false;
  }
};

// 更新面试记录标题
export const updateInterviewRecordTitle = async (recordId: string, title: string): Promise<boolean> => {
  try {
    const { error } = await supabase
      .from('saved_interview_records')
      .update({ title })
      .eq('id', recordId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('更新标题失败:', error);
    return false;
  }
};
