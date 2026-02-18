import { createClient } from '@supabase/supabase-js';

// Supabase 配置 - 请替换为你的实际值
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'YOUR_SUPABASE_URL';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
