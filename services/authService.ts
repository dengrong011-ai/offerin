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

/**
 * 支付回调未写入 profiles 时补单（需已登录）。可传 orderId；不传则尝试最近 7 天内已付订阅订单。
 */
export async function repairSubscriptionAfterPay(orderId?: string): Promise<void> {
  if (!isSupabaseConfigured) return;
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    const res = await fetch('/api/user/repair-subscription', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(orderId ? { orderId } : {}),
    });
    if (!res.ok) {
      console.warn('[repairSubscriptionAfterPay] HTTP', res.status);
    }
  } catch (e) {
    console.warn('[repairSubscriptionAfterPay]', e);
  }
}

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

// 与后端一致：使用 UTC 月份边界，避免前后端时区不一致导致计数差异
function getUtcMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
  return { start: start.toISOString(), end: end.toISOString() };
}

async function countInterviewSessionsInMonthClient(
  userId: string,
  monthStart: string,
  monthEnd: string
): Promise<number> {
  const { data, error } = await supabase
    .from('usage_logs')
    .select('interview_session_id, created_at')
    .eq('user_id', userId)
    .eq('action_type', 'interview')
    .gte('created_at', monthStart)
    .lte('created_at', monthEnd)
    .order('created_at', { ascending: true });

  if (error || !data?.length) return 0;

  // 有 session_id 的行：按 distinct session_id 计
  const distinct = new Set(
    data.map((r: { interview_session_id: string | null }) => r.interview_session_id).filter(Boolean)
  );

  // 无 session_id 的旧数据：按时间窗口聚合（间隔 > 10 分钟视为新的一场）
  const nullRows = data.filter((r: { interview_session_id: string | null }) => !r.interview_session_id);
  let nullSessions = 0;
  if (nullRows.length > 0) {
    nullSessions = 1;
    for (let i = 1; i < nullRows.length; i++) {
      const prev = new Date((nullRows[i - 1] as { created_at: string }).created_at).getTime();
      const curr = new Date((nullRows[i] as { created_at: string }).created_at).getTime();
      if (curr - prev > 10 * 60 * 1000) {
        nullSessions++;
      }
    }
  }

  return distinct.size + nullSessions;
}

// 获取「与后端一致」的有效会员类型（profiles + 白名单覆盖）
async function getEffectiveMembership(userId: string): Promise<string> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return (await getUserProfile(userId))?.membership_type || 'free';
    const res = await fetch('/api/user/membership', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!res.ok) return (await getUserProfile(userId))?.membership_type || 'free';
    const { membershipType } = await res.json();
    return membershipType || 'free';
  } catch {
    return (await getUserProfile(userId))?.membership_type || 'free';
  }
}

// 检查用户是否可以执行操作（诊断/面试）
// 注意：使用 getEffectiveMembership 与后端 proxy 保持一致（含白名单）
export const checkUsageLimit = async (
  userId: string, 
  actionType: 'diagnosis' | 'interview' | 'resume_edit',
  _userEmail?: string
): Promise<{ allowed: boolean; remaining: number; limit: number; isTrialLimit?: boolean }> => {
  try {
    const membership = await getEffectiveMembership(userId);
    const limits = MEMBERSHIP_LIMITS[membership as keyof typeof MEMBERSHIP_LIMITS] || MEMBERSHIP_LIMITS.free;

    if (membership === 'pro') {
      return { allowed: true, remaining: -1, limit: -1 };
    }

    if (membership === 'special') {
      const dailyLimit = limits.daily_total || 10;
      const today = new Date().toISOString().split('T')[0];

      const { count, error } = await supabase
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .lte('created_at', `${today}T23:59:59.999Z`);

      if (error) throw error;
      const usedCount = count || 0;
      const remaining = dailyLimit - usedCount;
      return { allowed: remaining > 0, remaining: Math.max(0, remaining), limit: dailyLimit };
    }

    // —— 老 VIP：面试按月「请求条数」、简历侧按月 200（与 proxy 一致）——
    if (membership === 'vip') {
      const { start: monthStart, end: monthEnd } = getUtcMonthRange();

      if (actionType === 'interview') {
        const monthlyLimit = limits.monthly_interview;
        if (monthlyLimit > 0) {
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

      if (actionType === 'diagnosis' || actionType === 'resume_edit') {
        const monthlyLimit = (limits as { monthly_diagnosis?: number }).monthly_diagnosis ?? -1;
        if (monthlyLimit > 0) {
          const { count, error } = await supabase
            .from('usage_logs')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId)
            .in('action_type', ['diagnosis', 'resume_edit', 'auto_rewrite'])
            .gte('created_at', monthStart)
            .lte('created_at', monthEnd);

          if (error) throw error;
          const usedCount = count || 0;
          const remaining = monthlyLimit - usedCount;
          return { allowed: remaining > 0, remaining: Math.max(0, remaining), limit: monthlyLimit };
        }
      }

      return { allowed: true, remaining: -1, limit: -1 };
    }

    // —— 全局畅享：月 30 场面试、简历侧月 200（与 proxy FULL_MONTHLY_RESUME_SIDE_MONTHLY_CAP 一致）——
    if (membership === 'full_monthly') {
      const { start: monthStart, end: monthEnd } = getUtcMonthRange();

      if (actionType === 'interview') {
        const sessionsUsed = await countInterviewSessionsInMonthClient(userId, monthStart, monthEnd);
        const cap = 30;
        const remaining = cap - sessionsUsed;
        return {
          allowed: remaining > 0,
          remaining: Math.max(0, remaining),
          limit: cap,
        };
      }

      if (actionType === 'diagnosis' || actionType === 'resume_edit') {
        const { count, error } = await supabase
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .in('action_type', ['diagnosis', 'resume_edit', 'auto_rewrite'])
          .gte('created_at', monthStart)
          .lte('created_at', monthEnd);

        if (error) throw error;
        const usedCount = count || 0;
        const cap = 200;
        const remaining = cap - usedCount;
        return { allowed: remaining > 0, remaining: Math.max(0, remaining), limit: cap };
      }

      return { allowed: true, remaining: -1, limit: -1 };
    }

    // —— 简历畅改：10 天内 50 次诊断；划选不限；面试同免费 ——
    if (membership === 'resume_pass') {
      if (actionType === 'resume_edit') {
        return { allowed: true, remaining: -1, limit: -1 };
      }

      if (actionType === 'interview') {
        const interviewLimit = MEMBERSHIP_LIMITS.free.interview_trial_count;
        const { data: interviewRows, error: intError } = await supabase
          .from('usage_logs')
          .select('interview_session_id')
          .eq('user_id', userId)
          .eq('action_type', 'interview');

        if (intError) throw intError;
        const rows = interviewRows || [];
        const distinctSessions = new Set(rows.map((r) => r.interview_session_id).filter(Boolean));
        const hasLegacy = rows.some((r) => r.interview_session_id == null);
        const sessionsUsed = distinctSessions.size + (hasLegacy ? 1 : 0);
        const remaining = interviewLimit - sessionsUsed;
        return {
          allowed: remaining > 0,
          remaining: Math.max(0, remaining),
          limit: interviewLimit,
          isTrialLimit: true,
        };
      }

      if (actionType === 'diagnosis') {
        const profile = await getUserProfile(userId);
        const expStr = profile?.vip_expires_at;
        if (!expStr || new Date(expStr) < new Date()) {
          return { allowed: false, remaining: 0, limit: 50 };
        }
        const exp = new Date(expStr);
        const now = new Date();
        const windowStart = new Date(exp.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
        const endIso = now < exp ? now.toISOString() : exp.toISOString();
        const { count, error } = await supabase
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('action_type', 'diagnosis')
          .gte('created_at', windowStart)
          .lte('created_at', endIso);

        if (error) throw error;
        const cap = 50;
        const usedCount = count || 0;
        const remaining = cap - usedCount;
        return { allowed: remaining > 0, remaining: Math.max(0, remaining), limit: cap };
      }

      return { allowed: true, remaining: -1, limit: -1 };
    }

    if (membership === 'free') {
      if (actionType === 'interview') {
        const interviewLimit = limits.interview_trial_count;
        const { data: interviewRows, error: intError } = await supabase
          .from('usage_logs')
          .select('interview_session_id')
          .eq('user_id', userId)
          .eq('action_type', 'interview');

        if (intError) throw intError;
        const rows = interviewRows || [];
        const distinctSessions = new Set(rows.map((r) => r.interview_session_id).filter(Boolean));
        const hasLegacy = rows.some((r) => r.interview_session_id == null);
        const sessionsUsed = distinctSessions.size + (hasLegacy ? 1 : 0);
        const remaining = interviewLimit - sessionsUsed;
        return {
          allowed: remaining > 0,
          remaining: Math.max(0, remaining),
          limit: interviewLimit,
          isTrialLimit: true,
        };
      }

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
        isTrialLimit: true,
      };
    }

    return { allowed: true, remaining: -1, limit: -1 };
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
    const membership = await getEffectiveMembership(userId);
    const limits = MEMBERSHIP_LIMITS[membership] || MEMBERSHIP_LIMITS.free;
    
    // Special 用户：受每日总限额控制
    if (membership === 'special') {
      const dailyLimit = limits.daily_total || 10;
      const today = new Date().toISOString().split('T')[0];
      
      const { count, error } = await supabase
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', `${today}T00:00:00.000Z`)
        .lte('created_at', `${today}T23:59:59.999Z`);

      if (error) throw error;
      const usedCount = count || 0;
      const remaining = dailyLimit - usedCount;
      return { allowed: remaining > 0, remaining: Math.max(0, remaining), limit: dailyLimit };
    }

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
// 免费用户：首次免费，之后需付费 ¥4.9
// VIP用户：无限
export const checkInterviewExportPermission = async (
  userId: string,
  _userEmail?: string
): Promise<{ allowed: boolean; reason?: string; needPurchase?: boolean; isFirstFree?: boolean }> => {
  try {
    // 获取用户资料
    const profile = await getUserProfile(userId);
    if (!profile) {
      return { allowed: false, reason: '请先登录' };
    }

    const membership = await getEffectiveMembership(userId);
    const limits =
      MEMBERSHIP_LIMITS[membership as keyof typeof MEMBERSHIP_LIMITS] || MEMBERSHIP_LIMITS.free;

    // VIP/Pro/Special 用户直接允许
    if (limits.can_export_interview) {
      return { allowed: true };
    }

    // 免费用户：检查是否是首次导出
    if (!profile.first_interview_export_used) {
      return { allowed: true, isFirstFree: true };
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

/** 与 api/gemini/proxy 中职业探索逻辑一致（日上限、免费 3 次计费池、全局畅享月 200） */
const CAREER_EXPLORE_DAILY_MAX = 50;
const FULL_MONTHLY_CAREER_EXPLORE_CAP = 200;
const CAREER_EXPLORE_TRIAL_BILLABLE = 3;
const CAREER_BILLABLE_ACTIONS = [
  'career_explore_profile',
  'career_explore_directions',
  'career_explore_plan',
  'career_explore_jd_demo',
] as const;

export type CareerExploreQuota = {
  dailyUsed: number;
  /** null 表示当前档位不设「今日剩余」展示 */
  dailyRemaining: number | null;
  trialBillableUsed: number;
  trialBillableRemaining: number | null;
  membership: string;
  monthlyCareerUsed?: number;
  monthlyCareerRemaining?: number;
};

export const getCareerExploreQuota = async (userId: string): Promise<CareerExploreQuota | null> => {
  try {
    const membership = await getEffectiveMembership(userId);
    const today = new Date().toISOString().split('T')[0];

    const { count: dailyCountRaw, error: dErr } = await supabase
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .like('action_type', 'career_explore%')
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`);

    if (dErr) throw dErr;
    const dailyUsed = dailyCountRaw || 0;

    if (membership === 'vip') {
      const { start, end } = getUtcMonthRange();
      const { count: mCount, error: mErr } = await supabase
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('action_type', [...CAREER_BILLABLE_ACTIONS])
        .gte('created_at', start)
        .lte('created_at', end);

      if (mErr) throw mErr;
      const monthlyUsed = mCount || 0;
      return {
        dailyUsed,
        dailyRemaining: null,
        trialBillableUsed: 0,
        trialBillableRemaining: null,
        monthlyCareerUsed: monthlyUsed,
        monthlyCareerRemaining: Math.max(0, FULL_MONTHLY_CAREER_EXPLORE_CAP - monthlyUsed),
        membership,
      };
    }

    if (membership === 'full_monthly') {
      const { start, end } = getUtcMonthRange();
      const { count: mCount, error: mErr } = await supabase
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('action_type', [...CAREER_BILLABLE_ACTIONS])
        .gte('created_at', start)
        .lte('created_at', end);

      if (mErr) throw mErr;
      const monthlyUsed = mCount || 0;
      return {
        dailyUsed,
        dailyRemaining: null,
        trialBillableUsed: 0,
        trialBillableRemaining: null,
        monthlyCareerUsed: monthlyUsed,
        monthlyCareerRemaining: Math.max(0, FULL_MONTHLY_CAREER_EXPLORE_CAP - monthlyUsed),
        membership,
      };
    }

    let trialBillableUsed = 0;
    if (membership === 'free' || membership === 'resume_pass') {
      const { count: tCount, error: tErr } = await supabase
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('action_type', [...CAREER_BILLABLE_ACTIONS]);

      if (tErr) throw tErr;
      trialBillableUsed = tCount || 0;
    }

    return {
      dailyUsed,
      dailyRemaining: null,
      trialBillableUsed,
      trialBillableRemaining:
        membership === 'free' || membership === 'resume_pass'
          ? Math.max(0, CAREER_EXPLORE_TRIAL_BILLABLE - trialBillableUsed)
          : null,
      membership,
    };
  } catch (error) {
    console.error('获取职业探索配额失败:', error);
    return null;
  }
};
