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
  action_type: 'diagnosis' | 'interview' | 'resume_edit' | 'translation';
  created_at: string;
}

// 会员权限配置
export const MEMBERSHIP_LIMITS = {
  free: {
    // 免费用户：总共3次体验（诊断+面试共享），不是每天
    total_trial_count: 3,          // 诊断+面试共3次体验机会
    translation_trial_count: 3,    // 英文翻译共3次体验机会
    daily_diagnosis: -1,           // 不限制每日，只限制总次数
    daily_interview: -1,           // 不限制每日，只限制总次数
    daily_total: -1,               // 不限制每日
    can_download: false,           // 需单次付费 ¥4.9
    can_export_interview: false,   // 不支持面试记录导出
    can_translate: true,           // 可以翻译，但有次数限制
    features: ['basic_diagnosis', 'basic_interview'],
  },
  vip: {
    total_trial_count: -1,         // VIP 不限制总次数
    translation_trial_count: -1,   // VIP 翻译无限
    daily_diagnosis: 50,           // VIP 每日50次诊断上限
    daily_interview: 50,           // VIP 每日50次面试上限
    daily_total: 50,               // VIP 每日总操作上限
    can_download: true,            // VIP 可以无限下载
    can_export_interview: true,    // VIP 支持面试记录导出
    can_translate: true,           // VIP 翻译无限
    features: ['basic_diagnosis', 'basic_interview', 'advanced_diagnosis', 'resume_export', 'interview_history', 'translation', 'interview_export'],
  },
  pro: {
    total_trial_count: -1,         // Pro 无限制
    translation_trial_count: -1,   // Pro 翻译无限
    daily_diagnosis: -1,           // Pro 无限制
    daily_interview: -1,
    daily_total: -1,
    can_download: true,
    can_export_interview: true,
    can_translate: true,
    features: ['all'],
  },
};

// 单次付费产品配置
export const SINGLE_PURCHASE_PRODUCTS = {
  resume_download: {
    id: 'resume_download',
    name: '简历下载',
    price: 490,              // ¥4.9
    description: '下载优化后的简历 PDF',
  },
};
