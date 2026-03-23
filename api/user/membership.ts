import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  resolveSupabaseAnonKey,
  resolveSupabaseServiceRoleKey,
  resolveSupabaseUrl,
} from '../../server/supabaseServerEnv';

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
    const { data } = await getSupabaseAdmin()
      .from('email_whitelist')
      .select('email, whitelist_type, expires_at, is_active')
      .eq('is_active', true);
    whitelistCache = new Map();
    if (data) {
      for (const entry of data) {
        whitelistCache.set(entry.email.toLowerCase(), entry);
      }
    }
    whitelistCacheTime = now;
  }
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

    if (whitelistEntry) {
      const rawTier = profileResult.data?.membership_type || 'free';
      const rawExp = profileResult.data?.vip_expires_at;
      const paidNewTierActive =
        (rawTier === 'full_monthly' || rawTier === 'resume_pass') &&
        !!rawExp &&
        new Date(rawExp) >= new Date();
      if (!(whitelistEntry.whitelist_type === 'vip' && paidNewTierActive)) {
        membershipType = whitelistEntry.whitelist_type;
      }
    }

    return res.status(200).json({ membershipType });
  } catch {
    return res.status(500).json({ error: 'Internal server error' });
  }
}
