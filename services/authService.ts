import { supabase, UserProfile, MEMBERSHIP_LIMITS, isSupabaseConfigured } from './supabaseClient';
import type { User, Session } from '@supabase/supabase-js';

// ============ 认证相关 ============

// 发送邮箱验证码 (6位数字 OTP)
export const sendOTP = async (email: string): Promise<{ success: boolean; error?: string }> => {
  if (!isSupabaseConfigured) {
    return { success: false, error: '登录服务未配置，请联系管理员' };
  }
  
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // 不设置 emailRedirectTo，这样会发送6位数字验证码而不是链接
        shouldCreateUser: true,
      },
    });

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('发送验证码失败:', error);
    return { success: false, error: error.message || '发送验证码失败，请稍后重试' };
  }
};

// 验证 OTP 码
export const verifyOTP = async (email: string, token: string): Promise<{ success: boolean; user?: User; error?: string }> => {
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'email',
    });

    if (error) throw error;
    return { success: true, user: data.user || undefined };
  } catch (error: any) {
    console.error('验证码验证失败:', error);
    return { success: false, error: error.message || '验证码错误或已过期' };
  }
};

// 登出
export const signOut = async (): Promise<{ success: boolean; error?: string }> => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('登出失败:', error);
    return { success: false, error: error.message };
  }
};

// 获取当前会话
export const getSession = async (): Promise<Session | null> => {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
};

// 获取当前用户
export const getCurrentUser = async (): Promise<User | null> => {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
};

// 监听认证状态变化
export const onAuthStateChange = (callback: (event: string, session: Session | null) => void) => {
  return supabase.auth.onAuthStateChange(callback);
};

// ============ 用户资料相关 ============

// 获取用户资料
export const getUserProfile = async (userId: string): Promise<UserProfile | null> => {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) throw error;
    return data as UserProfile;
  } catch (error) {
    console.error('获取用户资料失败:', error);
    return null;
  }
};

// 更新用户资料
export const updateUserProfile = async (userId: string, updates: Partial<UserProfile>): Promise<{ success: boolean; error?: string }> => {
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId);

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('更新用户资料失败:', error);
    return { success: false, error: error.message };
  }
};

// ============ 使用限制相关 ============

// VIP 白名单已移至服务端 (api/gemini/proxy.ts)
// 前端不再暴露白名单邮箱

// 检查用户是否可以执行操作（诊断/面试）
// 注意：这是前端预检查（用于 UI 提示），真正的权威校验在服务端 proxy 层
export const checkUsageLimit = async (
  userId: string, 
  actionType: 'diagnosis' | 'interview' | 'resume_edit',
  _userEmail?: string
): Promise<{ allowed: boolean; remaining: number; limit: number; isTrialLimit?: boolean }> => {
  try {
    // 获取用户资料
    const profile = await getUserProfile(userId);
    if (!profile) {
      return { allowed: false, remaining: 0, limit: 0 };
    }

    const membership = profile.membership_type;
    const limits = MEMBERSHIP_LIMITS[membership];
    
    // 免费用户：诊断(含全局重构)3次 和 面试1次，分开计算
    if (membership === 'free') {
      if (actionType === 'interview') {
        // 面试独立限额
        const interviewLimit = limits.interview_trial_count;
        const { count: interviewCount, error: intError } = await supabase
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('action_type', 'interview');
        
        if (intError) throw intError;
        const interviewUsed = interviewCount || 0;
        const remaining = interviewLimit - interviewUsed;
        return { allowed: remaining > 0, remaining: Math.max(0, remaining), limit: interviewLimit, isTrialLimit: true };
      }

      // 诊断(含全局重构/resume_edit) 独立限额
      const diagnosisLimit = limits.diagnosis_trial_count;
      const { count, error } = await supabase
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('action_type', ['diagnosis', 'resume_edit']);

      if (error) throw error;
      const usedCount = count || 0;
      const remaining = diagnosisLimit - usedCount;

      return { 
        allowed: remaining > 0, 
        remaining: Math.max(0, remaining), 
        limit: diagnosisLimit,
        isTrialLimit: true
      };
    }
    
    // VIP 用户：面试按月限制，其他按日限制
    if (membership === 'vip' && actionType === 'interview') {
      const monthlyLimit = limits.monthly_interview;
      if (monthlyLimit > 0) {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
        
        const { count, error } = await supabase
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('action_type', 'interview')
          .gte('created_at', monthStart)
          .lte('created_at', monthEnd);

        if (error) throw error;
        const usedCount = count || 0;
        const remaining = monthlyLimit - usedCount;
        return { allowed: remaining > 0, remaining: Math.max(0, remaining), limit: monthlyLimit };
      }
      return { allowed: true, remaining: -1, limit: -1 };
    }

    // VIP/Pro 用户：检查每日限制（诊断等）
    const dailyLimit = actionType === 'diagnosis' 
      ? limits.daily_diagnosis 
      : limits.daily_interview;
    
    if (dailyLimit === -1) {
      return { allowed: true, remaining: -1, limit: -1 };
    }

    // 统计今日使用次数
    const today = new Date().toISOString().split('T')[0];
    const { count, error } = await supabase
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action_type', actionType)
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`);

    if (error) throw error;

    const usedCount = count || 0;
    const remaining = dailyLimit - usedCount;

    return { 
      allowed: remaining > 0, 
      remaining: Math.max(0, remaining), 
      limit: dailyLimit 
    };
  } catch (error) {
    console.error('检查使用限制失败:', error);
    return { allowed: false, remaining: 0, limit: 0 };
  }
};

// 检查翻译次数限制
// 免费用户：共3次体验
// VIP用户：无限
export const checkTranslationLimit = async (
  userId: string,
  _userEmail?: string
): Promise<{ allowed: boolean; remaining: number; limit: number }> => {
  try {
    // 获取用户资料
    const profile = await getUserProfile(userId);
    if (!profile) {
      return { allowed: false, remaining: 0, limit: 0 };
    }

    const membership = profile.membership_type;
    const limits = MEMBERSHIP_LIMITS[membership];
    
    // VIP/Pro 无限制
    if (limits.translation_trial_count === -1) {
      return { allowed: true, remaining: -1, limit: -1 };
    }

    // 免费用户：统计总翻译次数
    const { count, error } = await supabase
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action_type', 'translation');

    if (error) throw error;

    const usedCount = count || 0;
    const remaining = limits.translation_trial_count - usedCount;

    return { 
      allowed: remaining > 0, 
      remaining: Math.max(0, remaining), 
      limit: limits.translation_trial_count 
    };
  } catch (error) {
    console.error('检查翻译限制失败:', error);
    return { allowed: false, remaining: 0, limit: 0 };
  }
};

// 检查面试记录导出权限
// 免费用户：需单次付费 ¥4.9
// VIP用户：支持
export const checkInterviewExportPermission = async (
  userId: string,
  _userEmail?: string
): Promise<{ allowed: boolean; reason?: string; needPurchase?: boolean }> => {
  try {
    // 获取用户资料
    const profile = await getUserProfile(userId);
    if (!profile) {
      return { allowed: false, reason: '请先登录' };
    }

    const membership = profile.membership_type;
    const limits = MEMBERSHIP_LIMITS[membership];
    
    if (limits.can_export_interview) {
      return { allowed: true };
    }

    return { allowed: false, reason: '面试记录保存需付费 ¥4.9/次，或升级 VIP 免费保存', needPurchase: true };
  } catch (error) {
    console.error('检查面试导出权限失败:', error);
    return { allowed: false, reason: '检查权限失败' };
  }
};

// 记录使用
export const logUsage = async (
  userId: string, 
  actionType: 'diagnosis' | 'interview' | 'resume_edit' | 'translation'
): Promise<{ success: boolean; error?: string }> => {
  try {
    const { error } = await supabase
      .from('usage_logs')
      .insert({
        user_id: userId,
        action_type: actionType,
      });

    if (error) throw error;
    return { success: true };
  } catch (error: any) {
    console.error('记录使用失败:', error);
    return { success: false, error: error.message };
  }
};

// 获取用户今日使用统计
export const getTodayUsageStats = async (userId: string): Promise<{
  diagnosis: number;
  interview: number;
  resume_edit: number;
  translation: number;
}> => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('usage_logs')
      .select('action_type')
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`);

    if (error) throw error;

    const stats = { diagnosis: 0, interview: 0, resume_edit: 0, translation: 0 };
    data?.forEach(log => {
      if (log.action_type in stats) {
        stats[log.action_type as keyof typeof stats]++;
      }
    });

    return stats;
  } catch (error) {
    console.error('获取使用统计失败:', error);
    return { diagnosis: 0, interview: 0, resume_edit: 0, translation: 0 };
  }
};

// 获取用户总使用统计（用于免费用户体验次数）
export const getTotalUsageStats = async (userId: string): Promise<{
  diagnosisAndInterview: number;  // 诊断+面试总次数
  translation: number;            // 翻译总次数
}> => {
  try {
    // 查询诊断+面试总次数
    const { count: diCount, error: diError } = await supabase
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .in('action_type', ['diagnosis', 'interview']);

    if (diError) throw diError;

    // 查询翻译总次数
    const { count: transCount, error: transError } = await supabase
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('action_type', 'translation');

    if (transError) throw transError;

    return {
      diagnosisAndInterview: diCount || 0,
      translation: transCount || 0,
    };
  } catch (error) {
    console.error('获取总使用统计失败:', error);
    return { diagnosisAndInterview: 0, translation: 0 };
  }
};
