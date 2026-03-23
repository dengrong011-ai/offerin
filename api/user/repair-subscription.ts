/**
 * 支付回调偶发未写入 profiles，或 Vercel 未配置 VITE_SUPABASE_URL 导致 notify 空客户端时，
 * 订单已 paid 但 membership 仍为 free。用户登录态下可调用本接口，按订单补写会员（与 xorpay/notify 一致）。
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  applySubscriptionGrant,
  isSubscriptionProductId,
  profileNeedsSubscriptionGrantForProduct,
} from '../../server/subscriptionGrant';
import {
  resolveSupabaseAnonKey,
  resolveSupabaseServiceRoleKey,
  resolveSupabaseUrl,
} from '../../server/supabaseServerEnv';

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

    // 无 orderId：最近 7 天内已支付的订阅订单，且当前仍为 free → 补写一次
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: latest, error: lErr } = await admin
      .from('payment_orders')
      .select('id, product_id, paid_at, status')
      .eq('user_id', userId)
      .eq('status', 'paid')
      .in('product_id', [...SUB_IDS])
      .gte('paid_at', cutoff)
      .order('paid_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lErr || !latest?.product_id) {
      return res.json({ ok: true, repaired: false, reason: 'no_recent_order' });
    }

    const needs = await profileNeedsSubscriptionGrantForProduct(admin, userId, latest.product_id);
    if (!needs) {
      return res.json({ ok: true, repaired: false, reason: 'already_has_tier' });
    }

    const grant = await applySubscriptionGrant(admin, userId, latest.product_id);
    if (!grant.ok) {
      return res.status(500).json({ ok: false, error: grant.error });
    }
    return res.json({ ok: true, repaired: true });
  } catch (e) {
    console.error('[repair-subscription]', e);
    return res.status(500).json({ error: 'INTERNAL' });
  }
}
