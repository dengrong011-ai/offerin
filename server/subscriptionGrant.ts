/**
 * 订阅类订单开通会员：与 api/xorpay/notify 中逻辑保持一致，供回调与「补单」接口共用。
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const SUBSCRIPTION_PRODUCT_IDS = [
  'vip_sprint',
  'vip_monthly',
  'resume_pass_10d',
  'full_monthly',
] as const;

export type SubscriptionProductId = (typeof SUBSCRIPTION_PRODUCT_IDS)[number];

export function isSubscriptionProductId(id: string): id is SubscriptionProductId {
  return (SUBSCRIPTION_PRODUCT_IDS as readonly string[]).includes(id);
}

const CFG: Record<SubscriptionProductId, { membership: string; days: number }> = {
  vip_sprint: { membership: 'vip', days: 10 },
  vip_monthly: { membership: 'vip', days: 30 },
  resume_pass_10d: { membership: 'resume_pass', days: 10 },
  full_monthly: { membership: 'full_monthly', days: 30 },
};

/** 判断「这笔订阅订单对应的资料」是否仍需开通（幂等回调 / 已付未写 profile 场景） */
export async function profileNeedsSubscriptionGrantForProduct(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
): Promise<boolean> {
  if (!isSubscriptionProductId(productId)) return false;
  const expectedMembership = CFG[productId].membership;
  const { data: profile } = await supabase
    .from('profiles')
    .select('membership_type, vip_expires_at')
    .eq('id', userId)
    .single();

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

/**
 * 查找用于「补写 profile」的最近一笔已付订阅订单。
 * - 含 paid_at 为 NULL 的旧数据：用 created_at 落在窗口内匹配（仅 .gte('paid_at') 会永远筛不到 NULL）。
 * - 按 created_at 排序，避免 paid_at 空时顺序不稳定。
 */
export async function findLatestPaidSubscriptionOrderInWindow(
  supabase: SupabaseClient,
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

/**
 * 打开 App / 拉会员接口时：若订单已 paid 但 profiles 未同步，按最近已付订阅单补写。
 * free+未来 vip_expires_at 脏数据用更长窗口；普通 free 用 90 天（原 7 天易漏掉仅 created_at 或稍早的已付单）。
 */
export async function healStaleSubscriptionProfile(supabase: SupabaseClient, userId: string): Promise<void> {
  const { data: p } = await supabase
    .from('profiles')
    .select('membership_type, vip_expires_at')
    .eq('id', userId)
    .single();
  if (!p) return;

  const type = p.membership_type || 'free';
  const exp = p.vip_expires_at ? new Date(p.vip_expires_at) : null;
  const expValid = !!exp && exp > new Date();

  const windowDays = type === 'free' && expValid ? 366 : 90;
  const productId = await findLatestPaidSubscriptionOrderInWindow(supabase, userId, windowDays);
  if (!productId) return;

  const needs = await profileNeedsSubscriptionGrantForProduct(supabase, userId, productId);
  if (!needs) return;

  await applySubscriptionGrant(supabase, userId, productId);
}

export async function applySubscriptionGrant(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSubscriptionProductId(productId)) {
    return { ok: true };
  }
  const { membership, days } = CFG[productId];
  const now = new Date();
  const { data: profileData } = await supabase
    .from('profiles')
    .select('vip_expires_at, membership_type')
    .eq('id', userId)
    .single();

  // 脏数据：仍为 free 但 vip_expires_at 未清空 — 只补 membership_type，保留原到期时间，避免用户被当免费版拦截
  if (profileData?.membership_type === 'free' && profileData?.vip_expires_at) {
    const existingExpiry = new Date(profileData.vip_expires_at);
    if (existingExpiry > now) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          membership_type: membership,
          updated_at: now.toISOString(),
        })
        .eq('id', userId);
      if (profileError) {
        return { ok: false, error: profileError.message };
      }
      return { ok: true };
    }
  }

  let baseDate = now;
  if (profileData?.membership_type === membership && profileData?.vip_expires_at) {
    const existingExpiry = new Date(profileData.vip_expires_at);
    if (existingExpiry > now) {
      baseDate = existingExpiry;
    }
  }
  const expiresAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      membership_type: membership,
      vip_expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (profileError) {
    return { ok: false, error: profileError.message };
  }
  return { ok: true };
}
