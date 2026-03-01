import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

/**
 * Vercel Serverless 代理 — 安全版
 * 
 * 安全特性：
 * 1. JWT 鉴权：验证 Supabase Auth Token，获取用户身份
 * 2. 服务端使用量校验：检查用户配额，防止前端绕过
 * 3. IP 级别 Rate Limiting（Upstash Redis）：分布式限流，跨实例共享状态
 * 4. VIP 白名单从数据库读取：不硬编码在代码中
 */

export const maxDuration = 60;

const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ============ Upstash Redis Rate Limiting ============

// 初始化 Redis 客户端（懒加载）
let redis: Redis | null = null;
let ratelimit: Ratelimit | null = null;

function getRedisRatelimit(): Ratelimit | null {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  // 如果未配置 Upstash，返回 null（回退到内存限流）
  if (!redisUrl || !redisToken) {
    return null;
  }
  
  if (!ratelimit) {
    redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });
    
    // 滑动窗口限流：每分钟 30 次请求
    ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(30, '1 m'),
      analytics: true,
      prefix: 'offerin:ratelimit:',
    });
  }
  
  return ratelimit;
}

// ============ 白名单缓存（减少数据库查询） ============

interface WhitelistEntry {
  email: string;
  whitelist_type: 'vip' | 'special' | 'pro';
  expires_at: string | null;
  is_active: boolean;
}

// 缓存白名单，5 分钟过期
let whitelistCache: Map<string, WhitelistEntry> | null = null;
let whitelistCacheTime = 0;
const WHITELIST_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

async function getWhitelistEntry(email: string, supabaseAdmin: SupabaseClient): Promise<WhitelistEntry | null> {
  const now = Date.now();
  
  // 缓存过期或不存在，重新加载
  if (!whitelistCache || now - whitelistCacheTime > WHITELIST_CACHE_TTL) {
    const { data } = await supabaseAdmin
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
  if (!entry) return null;
  
  // 检查是否过期
  if (entry.expires_at && new Date(entry.expires_at) < new Date()) {
    return null;
  }
  
  return entry;
}

// ============ 内存级 Rate Limiting（Upstash 未配置时的回退方案） ============

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;

function checkRateLimitMemory(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  
  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

function cleanupRateLimitMemory() {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}

// ============ 服务端配置 ============

// 会员配额（服务端权威配置）
const MEMBERSHIP_LIMITS: Record<string, {
  diagnosis_trial_count: number;
  interview_trial_count: number;
  translation_trial_count: number;
  daily_diagnosis: number;
  daily_interview: number;
  monthly_interview: number;
}> = {
  free: {
    diagnosis_trial_count: 3,    // 简历诊断+全局重构 独立3次
    interview_trial_count: 1,    // 模拟面试 独立1次
    translation_trial_count: 3,
    daily_diagnosis: -1,
    daily_interview: -1,
    monthly_interview: -1,
  },
  vip: {
    diagnosis_trial_count: -1,
    interview_trial_count: -1,
    translation_trial_count: -1,
    daily_diagnosis: -1,          // 诊断不限每日，改为月限
    daily_interview: -1,          // 面试不限每日，改为月限
    monthly_diagnosis: 200,       // 每月200次诊断（显示为无限）
    monthly_interview: 100,       // 每月100次面试（显示为无限）
    diagnosis_warning_threshold: 100, // 诊断月使用 >100 次发出预警
    interview_warning_threshold: 80,  // 面试月使用 >80 次发出预警
  },
  pro: {
    diagnosis_trial_count: -1,
    interview_trial_count: -1,
    translation_trial_count: -1,
    daily_diagnosis: -1,
    daily_interview: -1,
    monthly_interview: -1,
  },
  special: {
    diagnosis_trial_count: -1,   // 不限体验次数（用日限额控制）
    interview_trial_count: -1,
    translation_trial_count: -1,
    daily_diagnosis: 20,         // 每日所有操作共 20 次
    daily_interview: 20,
    monthly_interview: -1,       // 不限月度，用日限额统一控制
  },
};

// 允许的 actionType 白名单（防止前端传入非法值绕过配额）
const ALLOWED_ACTION_TYPES = new Set(['diagnosis', 'interview', 'translation', 'resume_edit', 'auto_rewrite']);

// 允许的模型白名单（防止调用非预期的昂贵模型）
const ALLOWED_MODELS = new Set([
  'gemini-3.1-pro-preview',
  'gemini-3-pro-preview',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
]);

// ============ 统一 Rate Limiting 接口 ============

async function checkRateLimit(key: string): Promise<{ success: boolean; remaining?: number }> {
  const upstashRatelimit = getRedisRatelimit();
  
  if (upstashRatelimit) {
    // 使用 Upstash Redis（分布式，跨实例共享）
    try {
      const result = await upstashRatelimit.limit(key);
      return { success: result.success, remaining: result.remaining };
    } catch (e) {
      console.warn('Upstash rate limit error, falling back to memory:', e);
      // Upstash 出错时回退到内存限流
    }
  }
  
  // 回退：内存级限流（单实例有效）
  cleanupRateLimitMemory();
  return { success: checkRateLimitMemory(key) };
}

// ============ Supabase 服务端客户端 ============

function getSupabaseAdmin() {
  const url = process.env.VITE_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  return createClient(url, serviceKey);
}

function getSupabaseAuth(jwt: string) {
  const url = process.env.VITE_SUPABASE_URL || '';
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
}

// ============ 核心鉴权 + 配额校验 ============

interface AuthResult {
  userId: string;
  email: string;
  membershipType: string;
}

async function authenticateUser(authHeader: string | undefined): Promise<AuthResult | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  
  const jwt = authHeader.slice(7);
  if (!jwt) return null;

  try {
    const supabaseAuth = getSupabaseAuth(jwt);
    const { data: { user }, error } = await supabaseAuth.auth.getUser();
    if (error || !user) return null;

    // 用 service role 获取 profile（绕过 RLS 读用户会员状态）
    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('membership_type, vip_expires_at')
      .eq('id', user.id)
      .single();

    let membershipType = profile?.membership_type || 'free';

    // 检查 VIP 是否过期
    if (membershipType === 'vip' && profile?.vip_expires_at) {
      if (new Date(profile.vip_expires_at) < new Date()) {
        // VIP 过期，降级为 free
        await supabaseAdmin
          .from('profiles')
          .update({ membership_type: 'free', updated_at: new Date().toISOString() })
          .eq('id', user.id);
        membershipType = 'free';
      }
    }

    // 从数据库查询白名单（替代硬编码）
    if (user.email) {
      const whitelistEntry = await getWhitelistEntry(user.email, supabaseAdmin);
      if (whitelistEntry) {
        // 白名单类型映射到会员类型
        membershipType = whitelistEntry.whitelist_type;
      }
    }

    return {
      userId: user.id,
      email: user.email || '',
      membershipType,
    };
  } catch {
    return null;
  }
}

async function checkAndLogUsage(
  userId: string,
  membershipType: string,
  actionType: string
): Promise<{ allowed: boolean; reason?: string }> {
  const supabaseAdmin = getSupabaseAdmin();
  const limits = MEMBERSHIP_LIMITS[membershipType] || MEMBERSHIP_LIMITS.free;

  // Pro 用户无限制
  if (membershipType === 'pro') {
    await supabaseAdmin.from('usage_logs').insert({ user_id: userId, action_type: actionType });
    return { allowed: true };
  }

  // auto_rewrite: 诊断后自动触发的重构，不单独计配额（诊断时已记录）
  if (actionType === 'auto_rewrite') {
    return { allowed: true };
  }

  // Special 白名单用户：所有操作共享每日 10 次限额
  if (membershipType === 'special') {
    const today = new Date().toISOString().split('T')[0];
    const dailyLimit = limits.daily_diagnosis; // 10
    
    // 统计今日所有操作的总次数
    const { count } = await supabaseAdmin
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`);

    if ((count || 0) >= dailyLimit) {
      return { allowed: false, reason: 'DAILY_LIMIT_EXCEEDED' };
    }

    await supabaseAdmin.from('usage_logs').insert({ user_id: userId, action_type: actionType });
    return { allowed: true };
  }

  if (membershipType === 'free') {
    // 免费用户：诊断(含全局重构)3次 和 面试1次，分开计算
    
    // 面试独立限额（1次）
    if (actionType === 'interview') {
      const { count: interviewCount } = await supabaseAdmin
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('action_type', 'interview');
      
      if ((interviewCount || 0) >= limits.interview_trial_count) {
        return { allowed: false, reason: 'INTERVIEW_TRIAL_LIMIT_EXCEEDED' };
      }
    }
    
    // 诊断(含全局重构/resume_edit) 独立限额（3次）
    if (actionType === 'diagnosis' || actionType === 'resume_edit') {
      const { count } = await supabaseAdmin
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('action_type', ['diagnosis', 'resume_edit']);

      if ((count || 0) >= limits.diagnosis_trial_count) {
        return { allowed: false, reason: 'DIAGNOSIS_TRIAL_LIMIT_EXCEEDED' };
      }
    }

    if (actionType === 'translation') {
      const { count } = await supabaseAdmin
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('action_type', 'translation');

      if ((count || 0) >= limits.translation_trial_count) {
        return { allowed: false, reason: 'TRANSLATION_LIMIT_EXCEEDED' };
      }
    }
  }

  if (membershipType === 'vip') {
    // VIP 用户：面试按月限制（100次/月，显示为无限），其他按日限制（50次/天）
    if (actionType === 'interview') {
      // 月度面试限额
      const monthlyLimit = limits.monthly_interview;
      const warningThreshold = (limits as any).interview_warning_threshold || 80;
      
      if (monthlyLimit > 0) {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
        
        const { count } = await supabaseAdmin
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('action_type', 'interview')
          .gte('created_at', monthStart)
          .lte('created_at', monthEnd);

        const currentCount = count || 0;

        // 预警：使用次数超过阈值时记录日志
        if (currentCount >= warningThreshold && currentCount < monthlyLimit) {
          console.warn(`⚠️ VIP 用户高频使用预警: userId=${userId}, 本月面试次数=${currentCount + 1}/${monthlyLimit}`);
        }

        if (currentCount >= monthlyLimit) {
          console.error(`🚫 VIP 用户月度面试超限: userId=${userId}, 本月面试次数=${currentCount}/${monthlyLimit}`);
          return { allowed: false, reason: 'MONTHLY_INTERVIEW_LIMIT_EXCEEDED' };
        }
      }
    } else if (actionType === 'diagnosis' || actionType === 'resume_edit' || actionType === 'auto_rewrite') {
      // 诊断/编辑 按月限制（200次/月）
      const monthlyLimit = (limits as any).monthly_diagnosis || -1;
      const warningThreshold = (limits as any).diagnosis_warning_threshold || 100;
      
      if (monthlyLimit > 0) {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
        
        // 统计诊断相关的所有操作
        const { count } = await supabaseAdmin
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .in('action_type', ['diagnosis', 'resume_edit', 'auto_rewrite'])
          .gte('created_at', monthStart)
          .lte('created_at', monthEnd);

        const currentCount = count || 0;

        // 预警：使用次数超过阈值时记录日志
        if (currentCount >= warningThreshold && currentCount < monthlyLimit) {
          console.warn(`⚠️ VIP 用户高频使用预警: userId=${userId}, 本月诊断次数=${currentCount + 1}/${monthlyLimit}`);
        }

        if (currentCount >= monthlyLimit) {
          console.error(`🚫 VIP 用户月度诊断超限: userId=${userId}, 本月诊断次数=${currentCount}/${monthlyLimit}`);
          return { allowed: false, reason: 'MONTHLY_DIAGNOSIS_LIMIT_EXCEEDED' };
        }
      }
    }
    // 翻译暂不限制
  }

  // 记录使用
  await supabaseAdmin.from('usage_logs').insert({ user_id: userId, action_type: actionType });
  return { allowed: true };
}

// ============ 主处理函数 ============

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  const allowedOrigins = [
    'https://offerin.co',
    'https://www.offerin.co',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
  ];
  const origin = req.headers.origin || '';
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  // ---- Rate Limiting (IP 级别，支持 Upstash Redis 分布式限流) ----
  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
                   req.socket?.remoteAddress || 'unknown';
  const rateLimitResult = await checkRateLimit(clientIp);
  if (!rateLimitResult.success) {
    return res.status(429).json({ 
      error: 'RATE_LIMIT_EXCEEDED',
      remaining: rateLimitResult.remaining ?? 0
    });
  }

  // ---- JWT 鉴权 ----
  const authUser = await authenticateUser(req.headers.authorization);
  if (!authUser) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  try {
    const { model, contents, config, mode, actionType } = req.body;

    if (!model || !contents) {
      return res.status(400).json({ error: 'Missing required fields: model, contents' });
    }

    // ---- 模型白名单校验 ----
    if (!ALLOWED_MODELS.has(model)) {
      return res.status(400).json({ error: 'INVALID_MODEL' });
    }

    // ---- 服务端使用量校验 ----
    // actionType 由前端传入，用于区分操作类型；白名单校验防止绕过配额
    const normalizedAction = (actionType && ALLOWED_ACTION_TYPES.has(actionType)) ? actionType : 'diagnosis';
    const usageCheck = await checkAndLogUsage(authUser.userId, authUser.membershipType, normalizedAction);
    if (!usageCheck.allowed) {
      return res.status(403).json({ error: usageCheck.reason || 'USAGE_LIMIT_EXCEEDED' });
    }

    // ---- 转发到 Google API ----
    const normalizedContents = contents.map((item: any) => ({
      role: item.role || 'user',
      parts: item.parts,
    }));

    const requestBody: any = { contents: normalizedContents };

    if (config) {
      if (config.systemInstruction) {
        requestBody.systemInstruction = {
          parts: [{ text: config.systemInstruction }]
        };
      }
      const genConfig: any = {};
      if (config.temperature !== undefined) genConfig.temperature = config.temperature;
      if (config.maxOutputTokens !== undefined) genConfig.maxOutputTokens = config.maxOutputTokens;
      if (config.topP !== undefined) genConfig.topP = config.topP;
      if (config.topK !== undefined) genConfig.topK = config.topK;
      if (config.responseMimeType) genConfig.responseMimeType = config.responseMimeType;
      if (Object.keys(genConfig).length > 0) {
        requestBody.generationConfig = genConfig;
      }
      if (config.safetySettings) {
        requestBody.safetySettings = config.safetySettings;
      }
    }

    const isStream = mode === 'stream';
    const action = isStream ? 'streamGenerateContent' : 'generateContent';
    const streamParam = isStream ? '&alt=sse' : '';
    const url = `${GOOGLE_API_BASE}/models/${model}:${action}?key=${apiKey}${streamParam}`;

    const googleResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!googleResponse.ok) {
      const errorText = await googleResponse.text();
      console.error('Google API error:', googleResponse.status, errorText);
      return res.status(googleResponse.status).json({
        error: `Google API error: ${googleResponse.status}`,
        details: errorText,
      });
    }

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const body = googleResponse.body;
      if (!body) {
        return res.status(500).json({ error: 'Failed to get response stream' });
      }

      try {
        for await (const chunk of body as any) {
          const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
          res.write(text);
        }
      } catch (e) {
        console.error('Stream error:', e);
      } finally {
        res.end();
      }
    } else {
      const data = await googleResponse.json();
      return res.status(200).json(data);
    }
  } catch (error: any) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: error.message || 'Internal proxy error' });
  }
}
