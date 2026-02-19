import { createClient } from '@supabase/supabase-js';

// Supabase 配置
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string || '';

// 调试日志（生产环境会被移除）
if (import.meta.env.DEV) {
  console.log('Supabase URL:', supabaseUrl ? '已配置' : '未配置');
  console.log('Supabase Key:', supabaseAnonKey ? '已配置' : '未配置');
}

// 检查配置是否有效的函数
export const checkSupabaseConfigured = (): boolean => {
  const url = import.meta.env.VITE_SUPABASE_URL as string || '';
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string || '';
  return !!(url && key && url.includes('supabase.co'));
};

// 向后兼容的静态检查
export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey && supabaseUrl.includes('supabase.co'));

// 创建 Supabase 客户端
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co', 
  supabaseAnonKey || 'placeholder-key'
);

// 用户类型定义
export interface UserProfile {
  id: string;
  email: string;
  nickname: string;
  avatar_url: string | null;
  membership_type: 'free' | 'vip' | 'pro';
  daily_usage_count: number;
  last_usage_date: string | null;
  vip_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// 使用记录类型
export interface UsageLog {
  id: string;
  user_id: string;
  action_type: 'diagnosis' | 'interview' | 'resume_edit';
  created_at: string;
}

// 会员权限配置
export const MEMBERSHIP_LIMITS = {
  free: {
    daily_diagnosis: 3,
    daily_interview: 3,
    features: ['basic_diagnosis', 'basic_interview'],
  },
  vip: {
    daily_diagnosis: -1, // -1 表示无限制
    daily_interview: -1,
    features: ['basic_diagnosis', 'basic_interview', 'advanced_diagnosis', 'resume_export', 'interview_history'],
  },
  pro: {
    daily_diagnosis: -1,
    daily_interview: -1,
    features: ['all'],
  },
};
