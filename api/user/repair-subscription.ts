/**
 * 支付回调偶发未写入 profiles，或 Vercel 未配置 VITE_SUPABASE_URL 导致 notify 空客户端时，
 * 订单已 paid 但 membership 仍为 free。用户登录态下可调用本接口，按订单补写会员（与 xorpay/notify 一致）。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
/**
 * ⚠️ 以下代码从 ../../server/ 内联
 * Vercel @vercel/node 打包 api/ 时无法解析 api/ 外部的相对路径
 */
// --- supabaseServerEnv ---
function resolveSupabaseUrl(): string {
  return (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
}
function resolveSupabaseServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}
function resolveSupabaseAnonKey(): string {
  return (process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').trim();
}

// --- subscriptionGrant ---
const SUBSCRIPTION_PRODUCT_IDS = ['vip_sprint', 'vip_monthly', 'resume_pass_10d', 'full_monthly'] as const;
type SubscriptionProductId = (typeof SUBSCRIPTION_PRODUCT_IDS)[number];
function isSubscriptionProductId(id: string): id is SubscriptionProductId {
  return (SUBSCRIPTION_PRODUCT_IDS as readonly string[]).includes(id);
}
const SUBSCRIPTION_CFG: Record<SubscriptionProductId, { membership: string; days: number }> = {
  vip_sprint: { membership: 'vip', days: 10 },
  vip_monthly: { membership: 'vip', days: 30 },
  resume_pass_10d: { membership: 'resume_pass', days: 10 },
  full_monthly: { membership: 'full_monthly', days: 30 },
};

async function profileNeedsSubscriptionGrantForProduct(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  userId: string,
  productId: string,
): Promise<boolean> {
  if (!isSubscriptionProductId(productId)) return false;
  const expectedMembership = SUBSCRIPTION_CFG[productId].membership;
  const { data: profile } = await supabase.from('profiles').select('membership_type, vip_expires_at').eq('id', userId).single();
  const type = profile?.membership_type || 'free';
  const now = new Date();
  const exp = profile?.vip_expires_at ? new Date(profile.vip_expires_at) : null;
  const expValid = !!exp && exp > now;
  if (type === 'free') return true;
  if (type === expectedMembership) {
    if (expValid) return false;
    if (!profile?.vip_expires_at && type === 'vip') return false;
    return true;
  }
  return true;
}

async function findLatestPaidSubscriptionOrderInWindow(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  userId: string,
  windowDays: number,
): Promise<SubscriptionProductId | null> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: row, error } = await supabase
    .from('payment_orders')
    .select('product_id')
    .eq('user_id', userId)
    .eq('status', 'paid')
    .in('product_id', [...SUBSCRIPTION_PRODUCT_IDS])
    .or(`paid_at.gte.${cutoff},and(paid_at.is.null,created_at.gte.${cutoff})`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !row?.product_id || !isSubscriptionProductId(row.product_id)) return null;
  return row.product_id;
}

async function applySubscriptionGrant(
  supabase: import('@supabase/supabase-js').SupabaseClient,
  userId: string,
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSubscriptionProductId(productId)) return { ok: true };
  const { membership, days } = SUBSCRIPTION_CFG[productId];
  const now = new Date();
  const { data: profileData } = await supabase.from('profiles').select('vip_expires_at, membership_type').eq('id', userId).single();
  if (profileData?.membership_type === 'free' && profileData?.vip_expires_at) {
    const existingExpiry = new Date(profileData.vip_expires_at);
    if (existingExpiry > now) {
      const { error: profileError } = await supabase.from('profiles').update({ membership_type: membership, updated_at: now.toISOString() }).eq('id', userId);
      if (profileError) return { ok: false, error: profileError.message };
      return { ok: true };
    }
  }
  let baseDate = now;
  if (profileData?.membership_type === membership && profileData?.vip_expires_at) {
    const existingExpiry = new Date(profileData.vip_expires_at);
    if (existingExpiry > now) baseDate = existingExpiry;
  }
  const expiresAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);
  const { error: profileError } = await supabase.from('profiles').update({ membership_type: membership, vip_expires_at: expiresAt.toISOString(), updated_at: new Date().toISOString() }).eq('id', userId);
  if (profileError) return { ok: false, error: profileError.message };
  return { ok: true };
}

const CORS_ORIGINS = ['https://offerin.co', 'https://www.offerin.co', 'http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174'];

const SUB_IDS = ['vip_sprint', 'vip_monthly', 'resume_pass_10d', 'full_monthly'] as const;

async function getAuthenticatedUserId(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const jwt = authHeader.slice(7).trim();
  if (!jwt) return null;
  const url = resolveSupabaseUrl();
  const anon = resolveSupabaseAnonKey();
  if (!url || !anon) return null;
  try {
    const authClient = createClient(url, anon, {
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    });
    const {
      data: { user },
      error,
    } = await authClient.auth.getUser();
    return error || !user ? null : user.id;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (CORS_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const userId = await getAuthenticatedUserId(req);
  if (!userId) return res.status(401).json({ error: 'UNAUTHORIZED' });

  const url = resolveSupabaseUrl();
  const serviceKey = resolveSupabaseServiceRoleKey();
  if (!url || !serviceKey) {
    console.error('[repair-subscription] 缺少 Supabase URL 或 SUPABASE_SERVICE_ROLE_KEY');
    return res.status(500).json({ error: 'SERVER_CONFIG' });
  }
  const admin = createClient(url, serviceKey);

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';

  try {
    if (orderId) {
      const { data: order, error: oErr } = await admin
        .from('payment_orders')
        .select('id, user_id, product_id, status')
        .eq('id', orderId)
        .single();

      if (oErr || !order || order.user_id !== userId) {
        return res.status(403).json({ error: 'ORDER_FORBIDDEN' });
      }
      if (order.status !== 'paid') {
        return res.status(409).json({ error: 'ORDER_NOT_PAID' });
      }
      if (!isSubscriptionProductId(order.product_id)) {
        return res.json({ ok: true, repaired: false, reason: 'not_subscription' });
      }

      const needs = await profileNeedsSubscriptionGrantForProduct(admin, userId, order.product_id);
      if (!needs) {
        return res.json({ ok: true, repaired: false, reason: 'already_has_tier' });
      }

      const grant = await applySubscriptionGrant(admin, userId, order.product_id);
      if (!grant.ok) {
        return res.status(500).json({ ok: false, error: grant.error });
      }
      return res.json({ ok: true, repaired: true });
    }

    // 无 orderId：最近 90 天内已付订阅单（含 paid_at 为空的行，用 created_at），与 healStale 一致
    const latestProductId = await findLatestPaidSubscriptionOrderInWindow(admin, userId, 90);
    if (!latestProductId) {
      return res.json({ ok: true, repaired: false, reason: 'no_recent_order' });
    }

    const needs = await profileNeedsSubscriptionGrantForProduct(admin, userId, latestProductId);
    if (!needs) {
      return res.json({ ok: true, repaired: false, reason: 'already_has_tier' });
    }

    const grant = await applySubscriptionGrant(admin, userId, latestProductId);
    if (!grant.ok) {
      return res.status(500).json({ ok: false, error: grant.error });
    }
    return res.json({ ok: true, repaired: true });
  } catch (e) {
    console.error('[repair-subscription]', e);
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
