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

// VIP 白名单邮箱（无限使用）
const VIP_WHITELIST_EMAILS = [
  'dengrong011@gmail.com',
];

// 检查用户是否可以执行操作（诊断/面试）
// 免费用户：共3次体验机会（诊断+面试共享）
// VIP用户：每日50次
export const checkUsageLimit = async (
  userId: string, 
  actionType: 'diagnosis' | 'interview' | 'resume_edit',
  userEmail?: string
): Promise<{ allowed: boolean; remaining: number; limit: number; isTrialLimit?: boolean }> => {
  try {
    // 白名单邮箱无限使用
    if (userEmail && VIP_WHITELIST_EMAILS.includes(userEmail.toLowerCase())) {
      return { allowed: true, remaining: -1, limit: -1 };
    }

    // 获取用户资料
    const profile = await getUserProfile(userId);
    if (!profile) {
      return { allowed: false, remaining: 0, limit: 0 };
    }

    const membership = profile.membership_type;
    const limits = MEMBERSHIP_LIMITS[membership];
    
    // 免费用户：检查总体验次数（诊断+面试共享3次）
    if (membership === 'free') {
      const totalTrialLimit = limits.total_trial_count;
      
      // 统计总使用次数（诊断+面试）
      const { count, error } = await supabase
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('action_type', ['diagnosis', 'interview']);

      if (error) throw error;

      const usedCount = count || 0;
      const remaining = totalTrialLimit - usedCount;

      return { 
        allowed: remaining > 0, 
        remaining: Math.max(0, remaining), 
        limit: totalTrialLimit,
        isTrialLimit: true  // 标记这是体验次数限制
      };
    }
    
    // VIP/Pro 用户：检查每日限制
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
  userEmail?: string
): Promise<{ allowed: boolean; remaining: number; limit: number }> => {
  try {
    // 白名单邮箱无限使用
    if (userEmail && VIP_WHITELIST_EMAILS.includes(userEmail.toLowerCase())) {
      return { allowed: true, remaining: -1, limit: -1 };
    }

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
// 免费用户：不支持
// VIP用户：支持
export const checkInterviewExportPermission = async (
  userId: string,
  userEmail?: string
): Promise<{ allowed: boolean; reason?: string }> => {
  try {
    // 白名单邮箱无限使用
    if (userEmail && VIP_WHITELIST_EMAILS.includes(userEmail.toLowerCase())) {
      return { allowed: true };
    }

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

    return { allowed: false, reason: '面试记录导出为 VIP 专属功能，请升级会员' };
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
