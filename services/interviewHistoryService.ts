/**
 * 面试历史记录服务
 * 支持登录用户将面试历史同步到 Supabase，未登录用户使用 LocalStorage
 */

import { supabase, isSupabaseConfigured } from './supabaseClient';

// 面试历史记录接口
export interface InterviewHistoryRecord {
  id?: string;
  resumeHash: string;
  questionsAsked: string[];
  experiencesCovered: string[];
  interviewMode?: 'simulation' | 'interactive';
  interviewerRole?: string;
  totalRounds?: number;
  timestamp: number;
}

// LocalStorage key
const LOCAL_STORAGE_KEY = 'offer_ing_interview_history';
const MAX_LOCAL_RECORDS = 50;
const MAX_RECORDS_PER_RESUME = 10;

// ==================== 本地存储（未登录用户）====================

/**
 * 从 LocalStorage 获取面试历史
 */
export const getLocalInterviewHistory = (resumeHash: string): InterviewHistoryRecord[] => {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) return [];
    
    const allHistory: InterviewHistoryRecord[] = JSON.parse(stored);
    return allHistory
      .filter(h => h.resumeHash === resumeHash)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_RECORDS_PER_RESUME);
  } catch {
    return [];
  }
};

/**
 * 保存面试历史到 LocalStorage
 */
export const saveLocalInterviewHistory = (record: InterviewHistoryRecord): void => {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    const allHistory: InterviewHistoryRecord[] = stored ? JSON.parse(stored) : [];
    
    // 添加新记录
    allHistory.unshift({
      ...record,
      timestamp: Date.now()
    });
    
    // 限制总数
    const trimmedHistory = allHistory.slice(0, MAX_LOCAL_RECORDS);
    
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(trimmedHistory));
  } catch (error) {
    console.error('保存本地面试历史失败:', error);
  }
};

// ==================== 云端存储（登录用户）====================

/**
 * 从 Supabase 获取面试历史
 */
export const getCloudInterviewHistory = async (
  userId: string,
  resumeHash: string
): Promise<InterviewHistoryRecord[]> => {
  if (!isSupabaseConfigured) {
    return getLocalInterviewHistory(resumeHash);
  }

  try {
    const { data, error } = await supabase
      .from('interview_history')
      .select('id, resume_hash, questions_asked, experiences_covered, interview_mode, interviewer_role, total_rounds, created_at')
      .eq('user_id', userId)
      .eq('resume_hash', resumeHash)
      .order('created_at', { ascending: false })
      .limit(MAX_RECORDS_PER_RESUME);

    if (error) throw error;

    return (data || []).map(row => ({
      id: row.id,
      resumeHash: row.resume_hash,
      questionsAsked: row.questions_asked || [],
      experiencesCovered: row.experiences_covered || [],
      interviewMode: row.interview_mode,
      interviewerRole: row.interviewer_role,
      totalRounds: row.total_rounds,
      timestamp: new Date(row.created_at).getTime()
    }));
  } catch (error) {
    console.error('获取云端面试历史失败:', error);
    // 降级到本地存储
    return getLocalInterviewHistory(resumeHash);
  }
};

/**
 * 保存面试历史到 Supabase
 */
export const saveCloudInterviewHistory = async (
  userId: string,
  record: InterviewHistoryRecord
): Promise<{ success: boolean; error?: string }> => {
  if (!isSupabaseConfigured) {
    saveLocalInterviewHistory(record);
    return { success: true };
  }

  try {
    const { error } = await supabase
      .from('interview_history')
      .insert({
        user_id: userId,
        resume_hash: record.resumeHash,
        questions_asked: record.questionsAsked,
        experiences_covered: record.experiencesCovered,
        interview_mode: record.interviewMode || 'simulation',
        interviewer_role: record.interviewerRole || 'peers',
        total_rounds: record.totalRounds || 8,
      });

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('保存云端面试历史失败:', error);
    // 降级到本地存储
    saveLocalInterviewHistory(record);
    return { success: false, error: error.message };
  }
};

/**
 * 删除面试历史记录
 */
export const deleteCloudInterviewHistory = async (
  userId: string,
  historyId: string
): Promise<{ success: boolean; error?: string }> => {
  if (!isSupabaseConfigured) {
    return { success: false, error: '服务未配置' };
  }

  try {
    const { error } = await supabase
      .from('interview_history')
      .delete()
      .eq('id', historyId)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('删除面试历史失败:', error);
    return { success: false, error: error.message };
  }
};

// ==================== 智能选择存储方式 ====================

/**
 * 智能获取面试历史（自动选择存储方式）
 */
export const getInterviewHistory = async (
  userId: string | null,
  resumeHash: string
): Promise<InterviewHistoryRecord[]> => {
  if (userId && isSupabaseConfigured) {
    return getCloudInterviewHistory(userId, resumeHash);
  }
  return getLocalInterviewHistory(resumeHash);
};

/**
 * 智能保存面试历史（自动选择存储方式）
 */
export const saveInterviewHistory = async (
  userId: string | null,
  record: InterviewHistoryRecord
): Promise<void> => {
  if (userId && isSupabaseConfigured) {
    await saveCloudInterviewHistory(userId, record);
  } else {
    saveLocalInterviewHistory(record);
  }
};

// ==================== 数据迁移工具 ====================

/**
 * 将本地存储的面试历史迁移到云端（用户登录后调用）
 */
export const migrateLocalHistoryToCloud = async (
  userId: string
): Promise<{ migrated: number; errors: number }> => {
  if (!isSupabaseConfigured) {
    return { migrated: 0, errors: 0 };
  }

  let migrated = 0;
  let errors = 0;

  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!stored) return { migrated: 0, errors: 0 };

    const localHistory: InterviewHistoryRecord[] = JSON.parse(stored);
    
    for (const record of localHistory) {
      const result = await saveCloudInterviewHistory(userId, record);
      if (result.success) {
        migrated++;
      } else {
        errors++;
      }
    }

    // 迁移成功后清空本地存储
    if (migrated > 0 && errors === 0) {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }

    return { migrated, errors };
  } catch (error) {
    console.error('迁移本地面试历史失败:', error);
    return { migrated, errors: errors + 1 };
  }
};

// ==================== 辅助函数 ====================

/**
 * 简单的字符串哈希函数（用于识别简历）
 */
export const hashString = (str: string): string => {
  let hash = 0;
  const cleanStr = str.replace(/\s+/g, '').toLowerCase();
  for (let i = 0; i < Math.min(cleanStr.length, 500); i++) {
    const char = cleanStr.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
};

/**
 * 从问题文本中提取核心问题关键词
 */
export const extractQuestionKeywords = (question: string): string[] => {
  const keywords: string[] = [];
  
  // 提取引号内的关键词
  const quoteMatches = question.match(/[""「」『』]([^""「」『』]+)[""「」『』]/g);
  if (quoteMatches) {
    keywords.push(...quoteMatches.map(m => m.replace(/[""「」『』]/g, '')));
  }
  
  // 提取常见面试问题模式
  const patterns = [
    /介绍一下(.+?)(?:项目|经历|经验)/g,
    /(.+?)(?:是怎么|怎么做|如何)/g,
    /为什么(?:选择|离开|加入)(.+?)[？?。]/g,
    /说说你在(.+?)(?:的|中)/g,
    /谈谈(.+?)(?:的|中)?(?:经验|理解|看法)/g,
  ];
  
  for (const pattern of patterns) {
    const matches = question.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length > 2 && match[1].length < 30) {
        keywords.push(match[1].trim());
      }
    }
  }
  
  return [...new Set(keywords)];
};

/**
 * 从对话历史中提取问过的问题和涉及的经历
 */
export const extractInterviewContent = (
  conversationHistory: Array<{role: string, content: string}>
): { questions: string[], experiences: string[] } => {
  const questions: string[] = [];
  const experiences: string[] = [];
  
  for (const item of conversationHistory) {
    if (item.role === 'interviewer') {
      // 提取问题关键词
      const keywords = extractQuestionKeywords(item.content);
      questions.push(...keywords);
      
      // 简化：直接将问题的前50个字符作为记录
      const shortQuestion = item.content.substring(0, 50).replace(/\n/g, ' ').trim();
      if (shortQuestion.length > 10) {
        questions.push(shortQuestion);
      }
    } else if (item.role === 'interviewee') {
      // 从回答中提取项目/经历关键词
      const projectMatches = item.content.match(/(?:项目|系统|平台|产品|模块|功能)[:：]?\s*([^，。,.\n]{2,20})/g);
      if (projectMatches) {
        experiences.push(...projectMatches.map(m => m.replace(/(?:项目|系统|平台|产品|模块|功能)[:：]?\s*/, '')));
      }
    }
  }
  
  return {
    questions: [...new Set(questions)].slice(0, 20),
    experiences: [...new Set(experiences)].slice(0, 10)
  };
};
