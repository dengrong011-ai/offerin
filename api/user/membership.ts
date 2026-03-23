import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
/**
 * ⚠️ 以下代码从 ../../server/ 内联
 * Vercel @vercel/node 打包 api/ 时无法解析 api/ 外部的相对路径
 */
// --- supabaseServerEnv ---
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

// --- membershipWhitelistMerge ---
const PAID_PROFILE_TIERS = new Set(['vip', 'resume_pass', 'full_monthly']);
type WhitelistType = 'vip' | 'special' | 'pro';
interface WhitelistEntryLike {
  whitelist_type: WhitelistType;
}
function mergeWhitelistIntoPaidProfile(
  membershipType: string,
  vipExpiresAt: string | null,
  whitelistEntry: WhitelistEntryLike | null,
): { membershipType: string; vipExpiresAt: string | null } {
  if (!whitelistEntry) return { membershipType, vipExpiresAt };
  if (whitelistEntry.whitelist_type === 'pro') return { membershipType: 'pro', vipExpiresAt: null };
  if (membershipType === 'pro') return { membershipType, vipExpiresAt };
  if (PAID_PROFILE_TIERS.has(membershipType)) return { membershipType, vipExpiresAt };
  return { membershipType: whitelistEntry.whitelist_type, vipExpiresAt: null };
}

// --- subscriptionGrant ---
const SUBSCRIPTION_PRODUCT_IDS = [
  'vip_sprint', 'vip_monthly', 'resume_pass_10d', 'full_monthly',
] as const;
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

async function findLatestPaidSubscriptionOrderInWindow(
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

async function profileNeedsSubscriptionGrantForProduct(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
): Promise<boolean> {
  if (!isSubscriptionProductId(productId)) return false;
  const expectedMembership = SUBSCRIPTION_CFG[productId].membership;
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

async function applySubscriptionGrant(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSubscriptionProductId(productId)) return { ok: true };
  const { membership, days } = SUBSCRIPTION_CFG[productId];
  const now = new Date();
  const { data: profileData } = await supabase
    .from('profiles')
    .select('vip_expires_at, membership_type')
    .eq('id', userId)
    .single();
  if (profileData?.membership_type === 'free' && profileData?.vip_expires_at) {
    const existingExpiry = new Date(profileData.vip_expires_at);
    if (existingExpiry > now) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ membership_type: membership, updated_at: now.toISOString() })
        .eq('id', userId);
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
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ membership_type: membership, vip_expires_at: expiresAt.toISOString(), updated_at: new Date().toISOString() })
    .eq('id', userId);
  if (profileError) return { ok: false, error: profileError.message };
  return { ok: true };
}

async function healStaleSubscriptionProfile(supabase: SupabaseClient, userId: string): Promise<void> {
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

const CORS_ORIGINS = ['https://offerin.co', 'https://www.offerin.co', 'http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174'];

let supabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(resolveSupabaseUrl(), resolveSupabaseServiceRoleKey());
  }
  return supabaseAdmin;
}

interface WhitelistEntry {
  email: string;
  whitelist_type: 'vip' | 'special' | 'pro';
  expires_at: string | null;
  is_active: boolean;
}

let whitelistCache: Map<string, WhitelistEntry> | null = null;
let whitelistCacheTime = 0;
const WHITELIST_CACHE_TTL = 5 * 60 * 1000;

async function getWhitelistEntry(email: string): Promise<WhitelistEntry | null> {
  const now = Date.now();
  if (!whitelistCache || now - whitelistCacheTime > WHITELIST_CACHE_TTL) {
    const { data, error } = await getSupabaseAdmin()
      .from('email_whitelist')
      .select('email, whitelist_type, expires_at, is_active')
      .eq('is_active', true);

    if (error) {
      console.error('[api/user/membership] email_whitelist load failed:', error.message, error.code);
      if (whitelistCache) {
        whitelistCacheTime = now;
      }
    } else {
      const next = new Map<string, WhitelistEntry>();
      if (data) {
        for (const entry of data) {
          next.set(entry.email.toLowerCase(), entry);
        }
      }
      whitelistCache = next;
      whitelistCacheTime = now;
    }
  }
  if (!whitelistCache) return null;
  const entry = whitelistCache.get(email.toLowerCase());
  if (!entry || (entry.expires_at && new Date(entry.expires_at) < new Date())) return null;
  return entry;
}

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

  try {
    const authClient = createClient(resolveSupabaseUrl(), resolveSupabaseAnonKey(), {
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    });
    const { data: { user }, error } = await authClient.auth.getUser();
    if (error || !user) return res.status(401).json({ error: 'UNAUTHORIZED' });

    await healStaleSubscriptionProfile(getSupabaseAdmin(), user.id);

    const [profileResult, whitelistEntry] = await Promise.all([
      getSupabaseAdmin().from('profiles').select('membership_type, vip_expires_at').eq('id', user.id).single(),
      user.email ? getWhitelistEntry(user.email) : Promise.resolve(null),
    ]);

    let membershipType = profileResult.data?.membership_type || 'free';
    const exp = profileResult.data?.vip_expires_at;
    const paidTierExpired =
      (membershipType === 'vip' || membershipType === 'resume_pass' || membershipType === 'full_monthly') &&
      !!exp &&
      new Date(exp) < new Date();

    // 与 proxy 一致：会员到期先规范为 free（清空 vip_expires_at），再算白名单；老用户上限不因新档位逻辑被改写
    if (paidTierExpired) {
      membershipType = 'free';
      const { error: normErr } = await getSupabaseAdmin()
        .from('profiles')
        .update({
          membership_type: 'free',
          vip_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (normErr) console.error('[api/user/membership] expiry normalize failed:', user.id, normErr);
    }

    const merged = mergeWhitelistIntoPaidProfile(membershipType, exp ?? null, whitelistEntry);
    membershipType = merged.membershipType;

    return res.status(200).json({ membershipType });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
