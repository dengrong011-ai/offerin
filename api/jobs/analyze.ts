import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const CORS_ORIGINS = [
  'https://offerin.co',
  'https://www.offerin.co',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
];

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function getSupabaseAuth(jwt: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

function setCors(res: VercelResponse) {
  const origin = res.req.headers.origin;
  if (origin && CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getAuthenticatedUserId(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const jwt = authHeader.slice(7).trim();
  if (!jwt) return null;
  try {
    const { data, error } = await getSupabaseAuth(jwt).auth.getUser();
    if (error || !data.user) return null;
    return data.user.id;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { jd_text, page_url, title, source } = req.body as {
    jd_text?: string;
    page_url?: string;
    title?: string;
    source?: string;
  };

  if (!jd_text || typeof jd_text !== 'string') {
    res.status(400).json({ error: 'jd_text is required.' });
    return;
  }
  const jdTrim = jd_text.trim();
  if (jdTrim.length < 50) {
    res.status(400).json({ error: 'jd_text should be at least 50 characters.' });
    return;
  }
  if (jdTrim.length > 50000) {
    res.status(400).json({ error: 'jd_text exceeds maximum length (50000 characters).' });
    return;
  }

  const now = new Date().toISOString();

  try {
    const { data: job, error } = await supabaseAdmin
      .from('jobs')
      .insert({
        user_id: userId,
        source: source || 'other',
        source_url: page_url || null,
        title: title || '未命名岗位',
        company: '',
        description: jdTrim,
        scraped_at: now,
        updated_at: now,
      })
      .select('*')
      .single();

    if (error || !job) {
      res.status(500).json({ error: 'Failed to save job.' });
      return;
    }

    res.status(200).json({
      job,
      match: null,
    });
  } catch (e) {
    res.status(500).json({ error: 'Internal server error' });
  }
}

