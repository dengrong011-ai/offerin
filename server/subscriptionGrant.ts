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
  let baseDate = now;
  const { data: profileData } = await supabase
    .from('profiles')
    .select('vip_expires_at, membership_type')
    .eq('id', userId)
    .single();
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
