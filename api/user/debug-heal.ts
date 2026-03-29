/**
 * 临时调试端点：逐步展示自愈逻辑执行过程
 * 部署后访问 /api/user/debug-heal （带 Authorization header）
 * 排查完毕后删除此文件
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

function resolveSupabaseUrl(): string {
  return (
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
}
function resolveSupabaseServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}
function resolveSupabaseAnonKey(): string {
  return (
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();
}

const SUBSCRIPTION_PRODUCT_IDS = [
  'vip_sprint', 'vip_monthly', 'resume_pass_10d', 'full_monthly',
] as const;

const CORS_ORIGINS = ['https://offerin.co', 'https://www.offerin.co', 'http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (CORS_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const jwt = authHeader.slice(7).trim();
  if (!jwt) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const steps: Record<string, unknown> = {};

  try {
    // Step 0: 环境变量检查
    const supaUrl = resolveSupabaseUrl();
    const serviceKey = resolveSupabaseServiceRoleKey();
    const anonKey = resolveSupabaseAnonKey();
    steps['step0_env'] = {
      hasSupaUrl: !!supaUrl,
      supaUrlPrefix: supaUrl ? supaUrl.substring(0, 30) + '...' : 'MISSING',
      hasServiceKey: !!serviceKey,
      serviceKeyPrefix: serviceKey ? serviceKey.substring(0, 10) + '...' : 'MISSING',
      hasAnonKey: !!anonKey,
    };

    // Step 1: 验证 JWT、获取用户
    const authClient = createClient(supaUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    steps['step1_auth'] = {
      userId: user?.id || null,
      email: user?.email || null,
      authError: authErr?.message || null,
    };
    if (authErr || !user) {
      return res.status(200).json({ steps });
    }

    const admin = createClient(supaUrl, serviceKey);

    // Step 2: 读取 profiles
    const { data: profile, error: profErr } = await admin
      .from('profiles')
      .select('id, membership_type, vip_expires_at, email, nickname')
      .eq('id', user.id)
      .single();
    steps['step2_profile'] = {
      profile,
      error: profErr?.message || null,
    };

    // Step 3: 查询 payment_orders（不加任何过滤，看全量数据）
    const { data: allOrders, error: ordErr } = await admin
      .from('payment_orders')
      .select('id, user_id, product_id, product_type, status, amount, paid_at, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10);
    steps['step3_all_orders'] = {
      count: allOrders?.length || 0,
      orders: allOrders,
      error: ordErr?.message || null,
    };

    // Step 4: 查询 payment_orders — 仅 status='paid'
    const { data: paidOrders, error: paidErr } = await admin
      .from('payment_orders')
      .select('id, product_id, product_type, status, paid_at, created_at')
      .eq('user_id', user.id)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(10);
    steps['step4_paid_orders'] = {
      count: paidOrders?.length || 0,
      orders: paidOrders,
      error: paidErr?.message || null,
    };

    // Step 5: 执行与 healStale 相同的查询（90天窗口）
    const type = profile?.membership_type || 'free';
    const exp = profile?.vip_expires_at ? new Date(profile.vip_expires_at) : null;
    const expValid = !!exp && exp > new Date();
    const windowDays = type === 'free' && expValid ? 366 : 90;
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

    steps['step5_heal_params'] = {
      type,
      exp: profile?.vip_expires_at,
      expValid,
      windowDays,
      cutoff,
      now: new Date().toISOString(),
    };

    const { data: healRow, error: healErr } = await admin
      .from('payment_orders')
      .select('id, product_id, status, paid_at, created_at')
      .eq('user_id', user.id)
      .eq('status', 'paid')
      .in('product_id', [...SUBSCRIPTION_PRODUCT_IDS])
      .or(`paid_at.gte.${cutoff},(paid_at.is.null,created_at.gte.${cutoff})`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    steps['step6_heal_query_result'] = {
      row: healRow,
      error: healErr?.message || null,
      errorDetails: healErr ? JSON.stringify(healErr) : null,
    };

    // Step 7: 如果 step6 没结果，尝试不加时间窗口限制
    if (!healRow) {
      const { data: noWindowRow, error: nwErr } = await admin
        .from('payment_orders')
        .select('id, product_id, status, paid_at, created_at')
        .eq('user_id', user.id)
        .eq('status', 'paid')
        .in('product_id', [...SUBSCRIPTION_PRODUCT_IDS])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      steps['step7_no_window_query'] = {
        row: noWindowRow,
        error: nwErr?.message || null,
        note: '不加时间窗口限制的查询',
      };
    }

    return res.status(200).json({ steps });
  } catch (e: unknown) {
    steps['catch_error'] = e instanceof Error ? e.message : String(e);
    return res.status(200).json({ steps });
  }
}
