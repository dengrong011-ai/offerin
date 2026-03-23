import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
/**
 * 服务端默认 fallback 链（与 services/geminiModelRouting.ts 中 PROXY_DEFAULT_FALLBACK_CHAIN 保持一致）
 * ⚠️ 不要用 import 引入 ../../services/*，Vercel @vercel/node 打包 api/ 时无法解析外部路径
 */
const PROXY_DEFAULT_FALLBACK_CHAIN: readonly string[] = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

const CORS_ORIGINS = ['https://offerin.co', 'https://www.offerin.co', 'http://localhost:3000', 'http://localhost:5173', 'http://localhost:5174'];

/**
 * Vercel Serverless 代理 — 安全版
 * 
 * 安全特性：
 * 1. JWT 鉴权：验证 Supabase Auth Token，获取用户身份
 * 2. 服务端使用量校验：检查用户配额，防止前端绕过
 * 3. IP 级别 Rate Limiting（Upstash Redis）：分布式限流，跨实例共享状态
 * 4. VIP 白名单从数据库读取：不硬编码在代码中
 */

/** Pro：单函数最长 300s，适合 Gemini 流式诊断/面试。若降回 Hobby 请改为 60 并同步 vercel.json */
export const maxDuration = 300;

const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** 非流式 generateContent 单次上游超时，避免 Google 无响应时前端一直转圈 */
const GOOGLE_GENERATE_FETCH_TIMEOUT_MS = 120_000;
/**
 * 职业探索：主请求已是 gemini-3.1-pro-preview；若 200 但 JSON 不可用，按质量→速度短链重试（勿遍历冗长 Pro 链）。
 * 顺序：2.5-pro → 2.5-flash → 2.0-flash；各次受 GOOGLE_GENERATE_FETCH_TIMEOUT_MS 约束。
 */
const CAREER_JSON_RECOVERY_MODELS: readonly string[] = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

/** 客户端为整场面试生成的场次 ID；与 usage_logs.interview_session_id 对应 */
const INTERVIEW_SESSION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseInterviewSessionId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return INTERVIEW_SESSION_UUID_RE.test(s) ? s : null;
}

/** 免费试用按「场次」计：distinct interview_session_id；无 session 的旧记录整体算 1 场 */
async function countInterviewTrialSessionsUsed(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('usage_logs')
    .select('interview_session_id')
    .eq('user_id', userId)
    .eq('action_type', 'interview');

  if (error || !data?.length) return 0;

  const distinct = new Set(
    data.map((r: { interview_session_id: string | null }) => r.interview_session_id).filter(Boolean)
  );
  const hasLegacy = data.some((r: { interview_session_id: string | null }) => !r.interview_session_id);
  return distinct.size + (hasLegacy ? 1 : 0);
}

function utcMonthRange(): { monthStart: string; monthEnd: string } {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)
  ).toISOString();
  return { monthStart, monthEnd };
}

/** 全局畅享：当月 distinct 面试场次（有 session_id 按 distinct；无则每行算一场） */
async function countInterviewSessionsInMonth(
  supabaseAdmin: SupabaseClient,
  userId: string,
  monthStart: string,
  monthEnd: string
): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('usage_logs')
    .select('interview_session_id')
    .eq('user_id', userId)
    .eq('action_type', 'interview')
    .gte('created_at', monthStart)
    .lte('created_at', monthEnd);

  if (error || !data?.length) return 0;
  const distinct = new Set(data.map((r) => r.interview_session_id).filter(Boolean));
  const nullRows = data.filter((r) => !r.interview_session_id).length;
  return distinct.size + nullRows;
}

// ============ Upstash Redis Rate Limiting ============

// 初始化 Redis 客户端（懒加载）
let redis: Redis | null = null;
let ratelimit: Ratelimit | null = null;

function getRedisRatelimit(): Ratelimit | null {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  // 如果未配置 Upstash，返回 null（回退到内存限流）
  if (!redisUrl || !redisToken) {
    return null;
  }

  if (!ratelimit) {
    redis = new Redis({
      url: redisUrl,
      token: redisToken,
    });
    
    // 滑动窗口限流：每分钟 150 次（8 轮面试约 17 次，诊断/重构/多轮叠加需余量，减少 429）
    ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(150, '1 m'),
      analytics: false,
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
const RATE_LIMIT_MAX = 150;

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
  monthly_diagnosis?: number;
  diagnosis_warning_threshold?: number;
  interview_warning_threshold?: number;
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
    monthly_interview: 300,       // 每月300次面试（显示为无限）
    diagnosis_warning_threshold: 100, // 诊断月使用 >100 次发出预警
    interview_warning_threshold: 240, // 面试月使用 >240 次发出预警
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
const ALLOWED_ACTION_TYPES = new Set(['diagnosis', 'interview', 'translation', 'resume_edit', 'auto_rewrite', 'file_extract', 'transcribe', 'career_explore']);

// 职业探索：仅成功返回后写入 usage_logs；日上限默认 50（仅统计 career_explore_*）；免费用户另享 3 次「计费」体验池（画像/方向/计划每次成功调用各可占 1 格，计划多次生成多次占格），同一步 24h 内第 2 次成功为免费重试不计入体验池
const CAREER_LOG_PROFILE = 'career_explore_profile';
const CAREER_LOG_DIRECTIONS = 'career_explore_directions';
const CAREER_LOG_PLAN = 'career_explore_plan';
const CAREER_LOG_JD_DEMO = 'career_explore_jd_demo';
const CAREER_LOG_RETRY_SUFFIX = '_retry';
const CAREER_BILLABLE_TYPES = [CAREER_LOG_PROFILE, CAREER_LOG_DIRECTIONS, CAREER_LOG_PLAN, CAREER_LOG_JD_DEMO];
const CAREER_FREE_TRIAL_BILLABLE = 3;
/** 全局畅享：职业探索计费步、简历侧（诊断+划选+重构）各自自然月硬上限（产品文案可写「不限」） */
const FULL_MONTHLY_CAREER_MONTHLY_CAP = 200;
const FULL_MONTHLY_RESUME_SIDE_MONTHLY_CAP = 200;

function careerStepToBaseLogType(step: string): string {
  if (step === 'profile') return CAREER_LOG_PROFILE;
  if (step === 'directions') return CAREER_LOG_DIRECTIONS;
  if (step === 'plan') return CAREER_LOG_PLAN;
  if (step === 'jd_demo') return CAREER_LOG_JD_DEMO;
  return CAREER_LOG_PLAN;
}

/** 统一小写，避免客户端大小写不一致导致 actionType 落回 diagnosis */
function normalizeCareerExploreStep(
  step: unknown,
): 'profile' | 'directions' | 'plan' | 'jd_demo' | null {
  if (typeof step !== 'string') return null;
  const s = step.trim().toLowerCase();
  if (s === 'profile' || s === 'directions' || s === 'plan' || s === 'jd_demo') return s;
  return null;
}

async function countCareerBillableInMonth(
  supabaseAdmin: SupabaseClient,
  userId: string,
  monthStart: string,
  monthEnd: string
): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('action_type', CAREER_BILLABLE_TYPES)
    .gte('created_at', monthStart)
    .lte('created_at', monthEnd);

  if (error) return 0;
  return count || 0;
}

function getCareerExploreDailyMax(): number {
  const n = parseInt(process.env.CAREER_EXPLORE_DAILY_MAX || '50', 10);
  return Number.isFinite(n) && n > 0 ? n : 50;
}

async function countCareerExploreCallsToday(supabaseAdmin: SupabaseClient, userId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const { count } = await supabaseAdmin
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .like('action_type', 'career_explore%')
    .gte('created_at', `${today}T00:00:00.000Z`)
    .lte('created_at', `${today}T23:59:59.999Z`);
  return count || 0;
}

async function countCareerStepCallsSince(
  supabaseAdmin: SupabaseClient,
  userId: string,
  step: string,
  sinceIso: string,
): Promise<number> {
  const base = careerStepToBaseLogType(step);
  const { count } = await supabaseAdmin
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('action_type', [base, base + CAREER_LOG_RETRY_SUFFIX])
    .gte('created_at', sinceIso);
  return count || 0;
}

async function countCareerBillableLifetime(supabaseAdmin: SupabaseClient, userId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('usage_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('action_type', CAREER_BILLABLE_TYPES);
  return count || 0;
}

async function checkCareerExplorePrecheck(
  userId: string,
  membershipType: string,
  step: 'profile' | 'directions' | 'plan' | 'jd_demo',
): Promise<{ allowed: boolean; reason?: string }> {
  const supabaseAdmin = getSupabaseAdmin();

  // pro：不限
  if (membershipType === 'pro') {
    return { allowed: true };
  }

  // special 白名单：日 20 次总上限（与 checkUsageEligibility 中 special 逻辑一致）
  if (membershipType === 'special') {
    const today = new Date().toISOString().split('T')[0];
    const { count } = await supabaseAdmin
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`);
    if ((count || 0) >= (MEMBERSHIP_LIMITS.special.daily_diagnosis || 20)) {
      return { allowed: false, reason: 'DAILY_LIMIT_EXCEEDED' };
    }
    return { allowed: true };
  }

  // 老 VIP：保留「当日 career_explore* 总次数」上限（默认 50）
  if (membershipType === 'vip') {
    const dailyMax = getCareerExploreDailyMax();
    const todayCount = await countCareerExploreCallsToday(supabaseAdmin, userId);
    if (todayCount >= dailyMax) {
      return { allowed: false, reason: 'CAREER_EXPLORE_DAILY_LIMIT_EXCEEDED' };
    }
    return { allowed: true };
  }

  // 全局畅享：职业探索按自然月（UTC）计费步上限（仅 base 类型；与 FULL_MONTHLY_CAREER_MONTHLY_CAP 一致）
  if (membershipType === 'full_monthly') {
    const { monthStart, monthEnd } = utcMonthRange();
    const used = await countCareerBillableInMonth(supabaseAdmin, userId, monthStart, monthEnd);
    if (used >= FULL_MONTHLY_CAREER_MONTHLY_CAP) {
      return { allowed: false, reason: 'CAREER_EXPLORE_MONTHLY_LIMIT_EXCEEDED' };
    }
    return { allowed: true };
  }

  // 免费 / 简历畅改 / 未知类型：共 3 次计费成功（24h 内第 2 次同一步为免费重试）
  // ⚠️ 兜底走 free 限制，防止未知 membershipType 绕过配额
  {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const n24 = await countCareerStepCallsSince(supabaseAdmin, userId, step, since24h);
    const nextIsBillable = n24 % 2 === 0;
    if (nextIsBillable) {
      const lifetime = await countCareerBillableLifetime(supabaseAdmin, userId);
      if (lifetime >= CAREER_FREE_TRIAL_BILLABLE) {
        return { allowed: false, reason: 'CAREER_EXPLORE_TRIAL_EXCEEDED' };
      }
    }
    return { allowed: true };
  }
}

async function recordCareerExploreSuccess(
  userId: string,
  step: 'profile' | 'directions' | 'plan' | 'jd_demo',
): Promise<void> {
  const url = resolveSupabaseUrl();
  const sk = resolveSupabaseServiceRoleKey();
  if (!url || !sk) {
    console.error(
      '[gemini proxy] recordCareerExploreSuccess: missing Supabase URL or SUPABASE_SERVICE_ROLE_KEY — set on Vercel (same project as VITE_SUPABASE_URL). usage_logs will stay empty.',
    );
    throw new Error('SUPABASE_ADMIN_NOT_CONFIGURED');
  }
  const supabaseAdmin = getSupabaseAdmin();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const n24 = await countCareerStepCallsSince(supabaseAdmin, userId, step, since24h);
  const isRetrySlot = n24 % 2 === 1;
  const base = careerStepToBaseLogType(step);
  const actionType = isRetrySlot ? base + CAREER_LOG_RETRY_SUFFIX : base;
  const { error } = await supabaseAdmin.from('usage_logs').insert({ user_id: userId, action_type: actionType });
  if (error) {
    console.error(
      'recordCareerExploreSuccess insert failed',
      actionType,
      userId,
      error.message,
      error.code,
      error.hint,
      '| If code is 42501 / RLS: Vercel must use service_role key, not anon.',
    );
    throw error;
  }
}

// 允许的模型白名单（防止调用非预期的昂贵模型）
const ALLOWED_MODELS = new Set([
  'gemini-3.1-pro-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  // 旧 preview ID（部分项目仍可用，保留白名单以免历史客户端 400）
  'gemini-2.5-pro-preview-05-06',
  'gemini-2.5-flash-preview-05-20',
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

// ============ Supabase 服务端客户端（单例复用，避免每次请求创建新实例） ============

/** Vercel 上常只配 NEXT_PUBLIC_* / SUPABASE_URL；与 Vite 本地 VITE_* 对齐 */
function resolveSupabaseUrl(): string {
  return (
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
}

function resolveSupabaseServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
}

function resolveSupabaseAnonKey(): string {
  return (
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ''
  ).trim();
}

let _supabaseAdmin: SupabaseClient | null = null;

function getSupabaseAdmin(): SupabaseClient {
  if (!_supabaseAdmin) {
    const url = resolveSupabaseUrl();
    const serviceKey = resolveSupabaseServiceRoleKey();
    if (!url || !serviceKey) {
      console.error(
        '[gemini proxy] getSupabaseAdmin: VITE_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set for usage_logs.',
      );
    }
    _supabaseAdmin = createClient(url, serviceKey);
  }
  return _supabaseAdmin;
}

/** 每请求独立 client，避免 Serverless 并发下复用单例导致 JWT 串用户 */
function createSupabaseAuthClient(jwt: string): SupabaseClient {
  const url = resolveSupabaseUrl();
  const anonKey = resolveSupabaseAnonKey();
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

// ============ 核心鉴权 + 配额校验 ============

interface AuthResult {
  userId: string;
  email: string;
  membershipType: string;
  /** 付费档位到期时间；内存中已降级为 free 时为 null */
  vipExpiresAt: string | null;
}

const PAID_MEMBERSHIP_TIERS = new Set(['vip', 'resume_pass', 'full_monthly']);

async function authenticateUser(authHeader: string | undefined): Promise<AuthResult | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  
  const jwt = authHeader.slice(7);
  if (!jwt) return null;

  try {
    const supabaseAuth = createSupabaseAuthClient(jwt);
    const { data: { user }, error } = await supabaseAuth.auth.getUser();
    if (error || !user) return null;

    // 并行查询 profile 和 whitelist（减少串行等待时间）
    const supabaseAdmin = getSupabaseAdmin();
    const [profileResult, whitelistEntry] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('membership_type, vip_expires_at')
        .eq('id', user.id)
        .single(),
      user.email ? getWhitelistEntry(user.email, supabaseAdmin) : Promise.resolve(null),
    ]);

    let membershipType = profileResult.data?.membership_type || 'free';
    let vipExpiresAt: string | null = profileResult.data?.vip_expires_at ?? null;

    // 付费档位过期 → 视为 free（老 VIP 与新档位共用 vip_expires_at）
    if (PAID_MEMBERSHIP_TIERS.has(membershipType) && vipExpiresAt) {
      if (new Date(vipExpiresAt) < new Date()) {
        membershipType = 'free';
        vipExpiresAt = null;
        Promise.resolve(
          supabaseAdmin
            .from('profiles')
            .update({ membership_type: 'free', updated_at: new Date().toISOString() })
            .eq('id', user.id)
        ).catch(() => {});
      }
    }

    // 白名单优先级最高；但若用户已购买「全局畅享 / 简历畅改」且在有效期内，不得以白名单里的老 vip 覆盖，
    // 否则充值后 profiles 已是 full_monthly，仍走月 300 次面试等旧逻辑，表现为「付费了额度不刷新」。
    if (whitelistEntry) {
      const rawTier = profileResult.data?.membership_type || 'free';
      const rawExp = profileResult.data?.vip_expires_at;
      const paidNewTierActive =
        (rawTier === 'full_monthly' || rawTier === 'resume_pass') &&
        !!rawExp &&
        new Date(rawExp) >= new Date();
      const skipWhitelistVipForPaidNewTier =
        whitelistEntry.whitelist_type === 'vip' && paidNewTierActive;

      if (!skipWhitelistVipForPaidNewTier) {
        membershipType = whitelistEntry.whitelist_type;
        vipExpiresAt = null;
      }
    }

    return {
      userId: user.id,
      email: user.email || '',
      membershipType,
      vipExpiresAt,
    };
  } catch {
    return null;
  }
}

// 用量校验短期缓存：同一用户 10 秒内的连续请求跳过 DB 查询（诊断 + 自动重构场景）
const usageCacheMap = new Map<string, { allowed: boolean; time: number }>();
const USAGE_CACHE_TTL = 10_000; // 10 秒

function getCachedUsage(userId: string, actionType: string): { allowed: boolean } | null {
  const key = `${userId}:${actionType}`;
  const entry = usageCacheMap.get(key);
  if (entry && Date.now() - entry.time < USAGE_CACHE_TTL) {
    return { allowed: entry.allowed };
  }
  return null;
}

function setCachedUsage(userId: string, actionType: string, allowed: boolean) {
  const key = `${userId}:${actionType}`;
  usageCacheMap.set(key, { allowed, time: Date.now() });
  // 清理过期条目（避免内存泄漏）
  if (usageCacheMap.size > 500) {
    const now = Date.now();
    for (const [k, v] of usageCacheMap) {
      if (now - v.time > USAGE_CACHE_TTL) usageCacheMap.delete(k);
    }
  }
}

/** 仅校验配额，不写入 usage_logs；成功调用 Google 后再 recordUsageSuccess */
async function checkUsageEligibility(
  userId: string,
  membershipType: string,
  actionType: string,
  interviewSessionId: string | null = null,
  vipExpiresAt: string | null = null
): Promise<{ allowed: boolean; reason?: string }> {
  const supabaseAdmin = getSupabaseAdmin();
  const limits = MEMBERSHIP_LIMITS[membershipType] || MEMBERSHIP_LIMITS.free;

  if (membershipType === 'pro') {
    return { allowed: true };
  }

  if (actionType === 'auto_rewrite' || actionType === 'file_extract' || actionType === 'transcribe') {
    return { allowed: true };
  }

  if (membershipType === 'special') {
    const today = new Date().toISOString().split('T')[0];
    const dailyLimit = limits.daily_diagnosis;

    const { count } = await supabaseAdmin
      .from('usage_logs')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', `${today}T00:00:00.000Z`)
      .lte('created_at', `${today}T23:59:59.999Z`);

    if ((count || 0) >= dailyLimit) {
      return { allowed: false, reason: 'DAILY_LIMIT_EXCEEDED' };
    }

    return { allowed: true };
  }

  // —— 老 VIP：逻辑不变（月 300 次面试请求、月 200 次诊断链路等）——
  if (membershipType === 'vip') {
    const cached = getCachedUsage(userId, actionType);
    if (cached?.allowed) {
      return { allowed: true };
    }

    if (actionType === 'interview') {
      const monthlyLimit = limits.monthly_interview;
      const warningThreshold = (limits as any).interview_warning_threshold || 80;

      if (monthlyLimit > 0) {
        const now = new Date();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
        const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString();

        const { count } = await supabaseAdmin
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('action_type', 'interview')
          .gte('created_at', monthStart)
          .lte('created_at', monthEnd);

        const currentCount = count || 0;

        if (currentCount >= warningThreshold && currentCount < monthlyLimit) {
          console.warn(`⚠️ VIP 用户高频使用预警: userId=${userId}, 本月面试次数=${currentCount + 1}/${monthlyLimit}`);
        }

        if (currentCount >= monthlyLimit) {
          console.error(`🚫 VIP 用户月度面试超限: userId=${userId}, 本月面试次数=${currentCount}/${monthlyLimit}`);
          return { allowed: false, reason: 'MONTHLY_INTERVIEW_LIMIT_EXCEEDED' };
        }
      }
    } else if (actionType === 'diagnosis' || actionType === 'resume_edit' || actionType === 'auto_rewrite') {
      const monthlyLimit = (limits as any).monthly_diagnosis || -1;
      const warningThreshold = (limits as any).diagnosis_warning_threshold || 100;

      if (monthlyLimit > 0) {
        const now = new Date();
        const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
        const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)).toISOString();

        const { count } = await supabaseAdmin
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .in('action_type', ['diagnosis', 'resume_edit', 'auto_rewrite'])
          .gte('created_at', monthStart)
          .lte('created_at', monthEnd);

        const currentCount = count || 0;

        if (currentCount >= warningThreshold && currentCount < monthlyLimit) {
          console.warn(`⚠️ VIP 用户高频使用预警: userId=${userId}, 本月诊断次数=${currentCount + 1}/${monthlyLimit}`);
        }

        if (currentCount >= monthlyLimit) {
          console.error(`🚫 VIP 用户月度诊断超限: userId=${userId}, 本月诊断次数=${currentCount}/${monthlyLimit}`);
          return { allowed: false, reason: 'MONTHLY_DIAGNOSIS_LIMIT_EXCEEDED' };
        }
      }
    }

    return { allowed: true };
  }

  // —— 全局畅享（新）：月 30 场面试、简历侧月上限 FULL_MONTHLY_RESUME_SIDE_MONTHLY_CAP、职业探索月上限 FULL_MONTHLY_CAREER_MONTHLY_CAP ——
  if (membershipType === 'full_monthly') {
    const cached = getCachedUsage(userId, actionType);
    if (cached?.allowed) {
      return { allowed: true };
    }

    const { monthStart, monthEnd } = utcMonthRange();

    if (actionType === 'interview') {
      if (interviewSessionId) {
        const { count: inSessionCount } = await supabaseAdmin
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('action_type', 'interview')
          .eq('interview_session_id', interviewSessionId);

        if ((inSessionCount || 0) > 0) {
          return { allowed: true };
        }
      }

      const sessionsUsed = await countInterviewSessionsInMonth(supabaseAdmin, userId, monthStart, monthEnd);
      if (sessionsUsed >= 30) {
        return { allowed: false, reason: 'MONTHLY_INTERVIEW_SESSION_LIMIT_EXCEEDED' };
      }
      return { allowed: true };
    }

    if (actionType === 'diagnosis' || actionType === 'resume_edit' || actionType === 'auto_rewrite') {
      const { count } = await supabaseAdmin
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('action_type', ['diagnosis', 'resume_edit', 'auto_rewrite'])
        .gte('created_at', monthStart)
        .lte('created_at', monthEnd);

      if ((count || 0) >= FULL_MONTHLY_RESUME_SIDE_MONTHLY_CAP) {
        return { allowed: false, reason: 'MONTHLY_DIAGNOSIS_LIMIT_EXCEEDED' };
      }
      return { allowed: true };
    }

    return { allowed: true };
  }

  // —— 简历畅改（新）：10 天内 50 次诊断；划选 resume_edit 不限；面试/翻译同免费 ——
  if (membershipType === 'resume_pass') {
    if (actionType === 'resume_edit') {
      return { allowed: true };
    }

    if (actionType === 'interview') {
      const trialLimit = MEMBERSHIP_LIMITS.free.interview_trial_count;
      if (interviewSessionId) {
        const { count: inSessionCount } = await supabaseAdmin
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('action_type', 'interview')
          .eq('interview_session_id', interviewSessionId);

        if ((inSessionCount || 0) > 0) {
          return { allowed: true };
        }

        const usedSessions = await countInterviewTrialSessionsUsed(supabaseAdmin, userId);
        if (usedSessions >= trialLimit) {
          return { allowed: false, reason: 'INTERVIEW_TRIAL_LIMIT_EXCEEDED' };
        }
      } else {
        const usedSessions = await countInterviewTrialSessionsUsed(supabaseAdmin, userId);
        if (usedSessions >= trialLimit) {
          return { allowed: false, reason: 'INTERVIEW_TRIAL_LIMIT_EXCEEDED' };
        }
      }
      return { allowed: true };
    }

    if (actionType === 'diagnosis') {
      if (!vipExpiresAt) {
        return { allowed: false, reason: 'SUBSCRIPTION_EXPIRED' };
      }
      const exp = new Date(vipExpiresAt);
      const now = new Date();
      if (exp < now) {
        return { allowed: false, reason: 'SUBSCRIPTION_EXPIRED' };
      }
      const windowStart = new Date(exp.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const endIso = now < exp ? now.toISOString() : exp.toISOString();
      const { count } = await supabaseAdmin
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('action_type', 'diagnosis')
        .gte('created_at', windowStart)
        .lte('created_at', endIso);

      if ((count || 0) >= 50) {
        return { allowed: false, reason: 'RESUME_PASS_DIAGNOSIS_LIMIT_EXCEEDED' };
      }
      return { allowed: true };
    }

    if (actionType === 'translation') {
      const tlim = MEMBERSHIP_LIMITS.free.translation_trial_count;
      const { count } = await supabaseAdmin
        .from('usage_logs')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('action_type', 'translation');

      if ((count || 0) >= tlim) {
        return { allowed: false, reason: 'TRANSLATION_LIMIT_EXCEEDED' };
      }
      return { allowed: true };
    }

    return { allowed: true };
  }

  if (membershipType === 'free') {
    if (actionType === 'interview') {
      const trialLimit = limits.interview_trial_count;

      if (interviewSessionId) {
        const { count: inSessionCount } = await supabaseAdmin
          .from('usage_logs')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('action_type', 'interview')
          .eq('interview_session_id', interviewSessionId);

        if ((inSessionCount || 0) > 0) {
          return { allowed: true };
        }

        const usedSessions = await countInterviewTrialSessionsUsed(supabaseAdmin, userId);
        if (usedSessions >= trialLimit) {
          return { allowed: false, reason: 'INTERVIEW_TRIAL_LIMIT_EXCEEDED' };
        }
      } else {
        const usedSessions = await countInterviewTrialSessionsUsed(supabaseAdmin, userId);
        if (usedSessions >= trialLimit) {
          return { allowed: false, reason: 'INTERVIEW_TRIAL_LIMIT_EXCEEDED' };
        }
      }
    }

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

  return { allowed: true };
}

/** 非流式 JSON：存在有效正文且未被安全拦截时才计次 */
function shouldBillGeminiRestResponse(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (d.error) return false;
  const pf = d.promptFeedback as { blockReason?: string } | undefined;
  if (pf?.blockReason) return false;
  const candidates = d.candidates as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(candidates) || candidates.length === 0) return false;
  const c0 = candidates[0];
  const fr = c0?.finishReason as string | undefined;
  if (fr === 'SAFETY' || fr === 'RECITATION' || fr === 'BLOCKLIST' || fr === 'PROHIBITED_CONTENT') {
    return false;
  }
  const content = c0?.content as { parts?: Array<{ text?: string }> } | undefined;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return false;
  return parts.some((p) => typeof p.text === 'string' && p.text.length > 0);
}

/** Google 偶发将单个 part 写成对象而非数组，严格 shouldBill 会恒 false → 职业探索永不写 usage_logs */
function geminiContentPartsAsArray(content: Record<string, unknown> | undefined): unknown[] {
  if (!content) return [];
  const parts = content.parts;
  if (Array.isArray(parts)) return parts;
  if (parts !== undefined && parts !== null && typeof parts === 'object') return [parts];
  return [];
}

/** 从首条 candidate 抽取可计费文本（兼容 parts 非数组、content 为字符串等变体） */
function extractCandidateTextFlexible(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  const candidates = d.candidates as Array<Record<string, unknown>> | undefined;
  const c0 = candidates?.[0];
  if (!c0) return '';
  const raw = c0.content;
  if (typeof raw === 'string') return raw;
  if (!raw || typeof raw !== 'object') return '';
  const list = geminiContentPartsAsArray(raw as Record<string, unknown>);
  let s = '';
  for (const p of list) {
    if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>;
      if (typeof o.text === 'string') s += o.text;
    }
  }
  return s;
}

/** 职业探索非流式：在标准判定之上用宽松文本提取，避免漏记账 */
function shouldBillCareerExploreRest(data: unknown): boolean {
  if (shouldBillGeminiRestResponse(data)) return true;
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (d.error) return false;
  const pf = d.promptFeedback as { blockReason?: string } | undefined;
  if (pf?.blockReason) return false;
  const candidates = d.candidates as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(candidates) || candidates.length === 0) return false;
  const c0 = candidates[0];
  const fr = c0?.finishReason as string | undefined;
  if (fr === 'SAFETY' || fr === 'RECITATION' || fr === 'BLOCKLIST' || fr === 'PROHIBITED_CONTENT') {
    return false;
  }
  const compact = extractCandidateTextFlexible(data).replace(/\s/g, '');
  return compact.length >= 8;
}

/** 拼接首条候选中的全部文本（多 part 时合并） */
function extractFirstCandidateTextConcat(data: unknown): string {
  const flex = extractCandidateTextFlexible(data);
  if (flex) return flex;
  if (!data || typeof data !== 'object') return '';
  const d = data as Record<string, unknown>;
  const candidates = d.candidates as Array<Record<string, unknown>> | undefined;
  const c0 = candidates?.[0];
  const parts = (c0?.content as { parts?: Array<{ text?: string }> } | undefined)?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('');
}

/** 与 careerService.repairTruncatedJson 前段一致：去围栏、去前言后再 parse */
function tryParseStructuredJson(text: string): boolean {
  let s = text.trim();
  if (!s) return false;
  s = s.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const jsonStart = s.search(/[\[{]/);
  if (jsonStart > 0) s = s.slice(jsonStart);
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** 职业探索 + JSON：正文必须可解析为 JSON，否则换模型重试 */
function careerExploreJsonResponseOk(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (d.error) return false;
  const pf = d.promptFeedback as { blockReason?: string } | undefined;
  if (pf?.blockReason) return false;
  const candidates = d.candidates as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(candidates) || candidates.length === 0) return false;
  const c0 = candidates[0];
  const fr = c0?.finishReason as string | undefined;
  if (fr === 'SAFETY' || fr === 'RECITATION' || fr === 'BLOCKLIST' || fr === 'PROHIBITED_CONTENT') {
    return false;
  }
  const text = extractCandidateTextFlexible(data);
  if (!text.trim()) return false;
  if (tryParseStructuredJson(text)) return true;
  if (fr) {
    console.warn(`[gemini proxy] career JSON parse failed, finishReason=${fr}`);
  }
  return false;
}

type SseUsageAcc = { sawModelText: boolean; blocked: boolean; carry: string; bytesIn: number };

/** 解析流式 SSE 片段，判断是否出现模型正文 / 安全拦截 */
function feedGeminiSseUsageAcc(acc: SseUsageAcc, chunkStr: string): void {
  acc.bytesIn += chunkStr.length;
  acc.carry += chunkStr;
  acc.carry = acc.carry.replace(/\r\n/g, '\n');
  let sep: number;
  while ((sep = acc.carry.indexOf('\n\n')) !== -1) {
    const event = acc.carry.slice(0, sep);
    acc.carry = acc.carry.slice(sep + 2);
    const dataLines = event.split('\n').filter((l) => l.startsWith('data:'));
    if (dataLines.length === 0) continue;
    const payload = dataLines.map((l) => l.slice(5).trim()).join('');
    if (payload === '' || payload === '[DONE]') continue;
    try {
      const j = JSON.parse(payload) as Record<string, unknown>;
      if (j.error) acc.blocked = true;
      const pff = j.promptFeedback as { blockReason?: string } | undefined;
      if (pff?.blockReason) acc.blocked = true;
      const cand = j.candidates as Array<Record<string, unknown>> | undefined;
      const c0 = cand?.[0];
      const fr = c0?.finishReason as string | undefined;
      if (fr === 'SAFETY' || fr === 'RECITATION' || fr === 'BLOCKLIST' || fr === 'PROHIBITED_CONTENT') {
        acc.blocked = true;
      }
      const parts = (c0?.content as { parts?: Array<{ text?: string }> } | undefined)?.parts;
      if (Array.isArray(parts)) {
        for (const p of parts) {
          if (typeof p?.text === 'string' && p.text.length > 0) acc.sawModelText = true;
        }
      }
    } catch {
      /* 分片/非完整 JSON：仍可能已含 text 片段（职业探索流式常见） */
      if (payload.length > 12 && /"text"\s*:\s*"[^"]{1,}/.test(payload)) {
        acc.sawModelText = true;
      }
    }
  }
}

/**
 * 职业探索等流式 JSON：整段 carry 上再扫一遍，避免 SSE 分片导致从未成功 JSON.parse 而 sawModelText 恒为 false、usage_logs 不写入。
 */
function finalizeCareerExploreStreamUsageAcc(acc: SseUsageAcc, forCareerStep: boolean): void {
  if (!forCareerStep || acc.blocked || acc.sawModelText) return;
  const tail = acc.carry.length > 900_000 ? acc.carry.slice(-900_000) : acc.carry;
  if (tail.length < 24) return;
  if (/"text"\s*:\s*"[^"]{1,}/.test(tail) || /"text"\s*:\s*"([^"\\]|\\.){1,}/.test(tail)) {
    acc.sawModelText = true;
  }
}

/** Google 调用成功后再记账，避免失败仍扣次 */
function recordUsageSuccess(
  userId: string,
  membershipType: string,
  actionType: string,
  interviewSessionId: string | null = null
): void {
  if (actionType === 'auto_rewrite' || actionType === 'file_extract' || actionType === 'transcribe') {
    return;
  }
  const supabaseAdmin = getSupabaseAdmin();
  if (membershipType === 'vip' || membershipType === 'full_monthly') {
    setCachedUsage(userId, actionType, true);
  }
  const row: { user_id: string; action_type: string; interview_session_id?: string | null } = {
    user_id: userId,
    action_type: actionType,
  };
  if (actionType === 'interview' && interviewSessionId) {
    row.interview_session_id = interviewSessionId;
  }
  void supabaseAdmin
    .from('usage_logs')
    .insert(row)
    .then(
      () => {},
      () => {},
    );
}

// ============ 主处理函数 ============

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (CORS_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
  // 生产环境必须配置 Upstash Redis，否则多实例限流失效
  const isProduction = process.env.VERCEL_ENV === 'production';
  if (isProduction && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) {
    console.error('Production requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
    return res.status(503).json({
      error: 'UPSTASH_REDIS_REQUIRED',
      message: 'Rate limiting requires Redis in production. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel.',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  // ---- 鉴权 + 限流（登录用户按 user_id 计限，避免同 IP 多用户互相抢额度）
  const authUser = await authenticateUser(req.headers.authorization);
  if (!authUser) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
                   req.socket?.remoteAddress || 'unknown';
  const rateLimitKey = authUser ? `user:${authUser.userId}` : `ip:${clientIp}`;
  const rateLimitResult = await checkRateLimit(rateLimitKey);

  if (!rateLimitResult.success) {
    return res.status(429).json({ 
      error: 'RATE_LIMIT_EXCEEDED',
      remaining: rateLimitResult.remaining ?? 0
    });
  }

  try {
    let bodyRaw: unknown = req.body;
    if (typeof bodyRaw === 'string') {
      try {
        bodyRaw = JSON.parse(bodyRaw);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON body' });
      }
    }
    const body = bodyRaw as Record<string, unknown>;
    if (body == null || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ error: 'Missing or invalid JSON body' });
    }

    const {
      model,
      contents,
      config,
      mode,
      actionType,
      careerExploreStep,
      fallbackModels: rawFallbackModels,
      interviewSessionId: rawInterviewSessionId,
    } = body as {
      model?: string;
      contents?: unknown;
      config?: unknown;
      mode?: string;
      actionType?: string;
      careerExploreStep?: string;
      fallbackModels?: unknown;
      interviewSessionId?: unknown;
    };

    if (!model || typeof model !== 'string' || !contents) {
      return res.status(400).json({ error: 'Missing required fields: model, contents' });
    }
    if (!Array.isArray(contents)) {
      return res.status(400).json({ error: 'contents must be an array' });
    }

    // ---- 模型白名单校验 ----
    if (!ALLOWED_MODELS.has(model)) {
      return res.status(400).json({ error: 'INVALID_MODEL' });
    }

    // ---- 服务端使用量校验（仅检查，成功响应后再写入 usage_logs）----
    // career_explore：成功返回后由 recordCareerExploreSuccess 记账
    const actionTypeNorm = typeof actionType === 'string' ? actionType.trim().toLowerCase() : '';
    const careerStepNorm = normalizeCareerExploreStep(careerExploreStep);
    let normalizedAction: string;
    // 合法 careerExploreStep 优先于 actionType：避免异常请求同时带 interview/diagnosis 与 step 时被错记成 interview（usage_logs 里只有 interview、没有 career_explore_*）
    if (careerStepNorm) {
      normalizedAction = 'career_explore';
    } else if (actionTypeNorm && ALLOWED_ACTION_TYPES.has(actionTypeNorm)) {
      normalizedAction = actionTypeNorm;
    } else {
      normalizedAction = 'diagnosis';
    }
    const interviewSessionId =
      normalizedAction === 'interview' ? parseInterviewSessionId(rawInterviewSessionId) : null;
    let pendingCareerStep: 'profile' | 'directions' | 'plan' | 'jd_demo' | null = null;

    if (normalizedAction === 'career_explore') {
      if (!careerStepNorm) {
        return res.status(400).json({ error: 'INVALID_CAREER_EXPLORE_STEP' });
      }
      try {
        const pre = await checkCareerExplorePrecheck(authUser.userId, authUser.membershipType, careerStepNorm);
        if (!pre.allowed) {
          return res.status(403).json({ error: pre.reason || 'CAREER_EXPLORE_LIMIT_EXCEEDED' });
        }
      } catch (preErr) {
        console.error('checkCareerExplorePrecheck failed:', preErr);
        return res.status(503).json({
          error: 'QUOTA_CHECK_FAILED',
          message: 'Unable to verify quota. Check Supabase and retry.',
        });
      }
      pendingCareerStep = careerStepNorm;
    } else {
      try {
        const usageCheck = await checkUsageEligibility(
          authUser.userId,
          authUser.membershipType,
          normalizedAction,
          interviewSessionId,
          authUser.vipExpiresAt
        );
        if (!usageCheck.allowed) {
          return res.status(403).json({ error: usageCheck.reason || 'USAGE_LIMIT_EXCEEDED' });
        }
      } catch (usageErr) {
        console.error('checkUsageEligibility failed:', usageErr);
        return res.status(503).json({
          error: 'QUOTA_CHECK_FAILED',
          message: 'Unable to verify quota. Check Supabase and retry.',
        });
      }
    }

    // ---- 转发到 Google API ----
    const normalizedContents = contents.map((item: any) => ({
      role: item.role || 'user',
      parts: item.parts,
    }));

    const requestBody: any = { contents: normalizedContents };

    if (config && typeof config === 'object') {
      const cfg = config as Record<string, any>;
      if (cfg.systemInstruction) {
        requestBody.systemInstruction = {
          parts: [{ text: cfg.systemInstruction }]
        };
      }
      const genConfig: any = {};
      if (cfg.temperature !== undefined) genConfig.temperature = cfg.temperature;
      if (cfg.maxOutputTokens !== undefined) genConfig.maxOutputTokens = cfg.maxOutputTokens;
      if (cfg.topP !== undefined) genConfig.topP = cfg.topP;
      if (cfg.topK !== undefined) genConfig.topK = cfg.topK;
      if (cfg.responseMimeType) genConfig.responseMimeType = cfg.responseMimeType;
      if (Object.keys(genConfig).length > 0) {
        requestBody.generationConfig = genConfig;
      }
      if (cfg.safetySettings) {
        requestBody.safetySettings = cfg.safetySettings;
      }
    }

    const isStream = mode === 'stream';
    const action = isStream ? 'streamGenerateContent' : 'generateContent';
    const streamParam = isStream ? '&alt=sse' : '';
    /** 命中这些模型且 Google 返回 429/404 时，在同一请求内按自定义或默认顺序再试 */
    const PRO_MODELS_429_FALLBACK = new Set([
      'gemini-3.1-pro-preview',
      'gemini-2.5-pro', 'gemini-2.5-flash',
      'gemini-2.5-pro-preview-05-06', 'gemini-2.5-flash-preview-05-20',
      'gemini-2.0-flash', 'gemini-2.0-flash-lite',
    ]);
    /** 未传或传入无效/空 fallbackModels 时与 geminiModelRouting 一致（避免空数组导致完全不 fallback） */
    const DEFAULT_GOOGLE_FALLBACKS = [...PROXY_DEFAULT_FALLBACK_CHAIN];

    let serverFallbackSequence: string[] = DEFAULT_GOOGLE_FALLBACKS;
    if (rawFallbackModels !== undefined) {
      if (Array.isArray(rawFallbackModels) && rawFallbackModels.length <= 8) {
        const custom: string[] = [];
        let allValid = true;
        for (const m of rawFallbackModels) {
          if (typeof m !== 'string' || !ALLOWED_MODELS.has(m)) {
            allValid = false;
            break;
          }
          if (!custom.includes(m)) custom.push(m);
        }
        // 仅当非空且全部在白名单内时采用客户端链；[] 或非法数组回退默认链
        if (allValid && custom.length > 0) {
          serverFallbackSequence = custom;
        }
      }
    }

    const doFetch = (targetModel: string, timeoutMs?: number) => {
      const url = `${GOOGLE_API_BASE}/models/${targetModel}:${action}?key=${apiKey}${streamParam}`;
      if (isStream) {
        return fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
      }
      const ms = timeoutMs ?? GOOGLE_GENERATE_FETCH_TIMEOUT_MS;
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), ms);
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      }).finally(() => clearTimeout(t));
    };

    let googleResponse: Response;
    /** 客户端可通过响应头 X-Gemini-Model 查看实际命中的模型（含 fallback） */
    let resolvedModel = model;
    try {
      googleResponse = await doFetch(model);
    } catch (fetchErr: any) {
      const isAbort =
        fetchErr?.name === 'AbortError' || String(fetchErr?.message || '').toLowerCase().includes('abort');
      console.error('Google API fetch error:', fetchErr?.message || fetchErr);
      return res.status(isAbort ? 504 : 502).json({
        error: isAbort ? 'AI_UPSTREAM_TIMEOUT' : 'AI_SERVICE_ERROR',
        message: isAbort
          ? '上游模型响应超时，请稍后重试或缩短简历正文'
          : 'Model unavailable or network error',
      });
    }

    // 主模型 429 时依次 fallback（不同配额池），尽量让用户能用上
    if (googleResponse.status === 429 && PRO_MODELS_429_FALLBACK.has(model)) {
      for (const fallback of serverFallbackSequence) {
        if (fallback === model) continue;
        console.warn(`主模型 ${model} 429，尝试 fallback: ${fallback}`);
        try {
          const fallbackRes = await doFetch(fallback);
          if (fallbackRes.ok) {
            googleResponse = fallbackRes;
            resolvedModel = fallback;
            break;
          }
        } catch (_) { /* 继续下一个 */ }
      }
    }

    // 404 ENTITY_NOT_FOUND：主模型不可用（如 API Key 无权限）时尝试 fallback
    if (googleResponse.status === 404 && PRO_MODELS_429_FALLBACK.has(model)) {
      for (const fallback of serverFallbackSequence) {
        if (fallback === model) continue;
        console.warn(`主模型 ${model} 404，尝试 fallback: ${fallback}`);
        try {
          const fallbackRes = await doFetch(fallback);
          if (fallbackRes.ok) {
            googleResponse = fallbackRes;
            resolvedModel = fallback;
            break;
          }
        } catch (_) { /* 继续下一个 */ }
      }
    }

    if (!googleResponse.ok) {
      const errorText = await googleResponse.text();
      if (googleResponse.status === 429) {
        // 解析 Google 429 详情，便于判断是哪个模型/配额用尽
        try {
          const err = JSON.parse(errorText);
          const details = err?.error?.details?.[0];
          const quotaMetric = details?.metadata?.['quota_metric'] || details?.metadata?.['service'] || 'unknown';
          const quotaLimit = details?.metadata?.['quota_limit_value'] || '?';
          console.warn(`[429] model=${model} quota_metric=${quotaMetric} quota_limit=${quotaLimit}`);
        } catch (_) {
          console.error('Google API 429:', errorText);
        }
        return res.status(429).json({
          error: 'AI_RATE_LIMIT_EXCEEDED',
          message: 'AI 服务当前请求较多，请 1-2 分钟后再试',
        });
      }
      console.error('Google API error:', googleResponse.status, errorText);
      return res.status(502).json({
        error: 'AI_SERVICE_ERROR',
      });
    }

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Gemini-Model', resolvedModel);
      res.setHeader('Access-Control-Expose-Headers', 'X-Gemini-Model');

      const body = googleResponse.body;
      if (!body) {
        return res.status(500).json({ error: 'Failed to get response stream' });
      }

      const sseAcc: SseUsageAcc = { sawModelText: false, blocked: false, carry: '', bytesIn: 0 };
      let streamCompleted = false;
      try {
        for await (const chunk of body as any) {
          const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
          feedGeminiSseUsageAcc(sseAcc, text);
          res.write(text);
        }
        streamCompleted = true;
        feedGeminiSseUsageAcc(sseAcc, '\n\n');
        finalizeCareerExploreStreamUsageAcc(sseAcc, !!pendingCareerStep);
      } catch (e) {
        console.error('Stream error:', e);
      } finally {
        res.end();
      }
      /**
       * 职业探索（pendingCareerStep）走流式时：前端已能完整消费 SSE 即视为成功。
       * 注意：carry 是「未拼完的 SSE 缓冲区」，完整事件解析后会被从 carry 里摘掉，流正常结束时 carry 往往很短甚至空，
       * 不能用 carry.length 判断是否有正文（否则会永远不记账）。用 sawModelText 或上游累计字节数 bytesIn。
       * 非职业探索流（诊断等）仍要求 sawModelText。
       */
      const careerStreamLooksSuccessful =
        sseAcc.sawModelText || sseAcc.bytesIn >= 64;
      const shouldBill =
        streamCompleted &&
        !sseAcc.blocked &&
        (pendingCareerStep ? careerStreamLooksSuccessful : sseAcc.sawModelText);
      if (shouldBill) {
        if (pendingCareerStep) {
          try {
            await recordCareerExploreSuccess(authUser.userId, pendingCareerStep);
          } catch (e) {
            console.error('recordCareerExploreSuccess failed:', e);
          }
        } else {
          recordUsageSuccess(
            authUser.userId,
            authUser.membershipType,
            normalizedAction,
            interviewSessionId
          );
        }
      } else if (pendingCareerStep) {
        console.warn('[gemini proxy] career stream completed but not billed', {
          step: pendingCareerStep,
          streamCompleted,
          blocked: sseAcc.blocked,
          sawModelText: sseAcc.sawModelText,
          bytesIn: sseAcc.bytesIn,
        });
      }
      return;
    } else {
      let data: unknown;
      try {
        data = await googleResponse.json();
      } catch (parseErr) {
        console.error('Gemini JSON parse error:', parseErr);
        return res.status(502).json({ error: 'AI_SERVICE_ERROR' });
      }

      const reqMime = (requestBody as { generationConfig?: { responseMimeType?: string } })
        .generationConfig?.responseMimeType;
      const requireCareerStructuredJson =
        normalizedAction === 'career_explore' &&
        (reqMime === 'application/json' || reqMime === 'text/json');

      if (requireCareerStructuredJson && !careerExploreJsonResponseOk(data)) {
        const tried = new Set<string>([resolvedModel]);
        let recovered: unknown | null = null;
        let finalModel = resolvedModel;
        for (const tryM of CAREER_JSON_RECOVERY_MODELS) {
          if (tried.has(tryM) || !ALLOWED_MODELS.has(tryM)) continue;
          tried.add(tryM);
          try {
            const r2 = await doFetch(tryM);
            if (!r2.ok) continue;
            const d2 = await r2.json();
            if (!careerExploreJsonResponseOk(d2)) continue;
            recovered = d2;
            finalModel = tryM;
            break;
          } catch {
            /* 超时或网络：试下一个 Flash */
          }
        }
        if (recovered == null) {
          return res.status(502).json({
            error: 'AI_EMPTY_OR_UNPARSABLE',
            message: '模型返回为空或无法解析为 JSON，已自动换模型重试仍失败，请稍后重试',
          });
        }
        data = recovered;
        resolvedModel = finalModel;
      }

      res.setHeader('X-Gemini-Model', resolvedModel);
      res.setHeader('Access-Control-Expose-Headers', 'X-Gemini-Model');
      const billNonStream = pendingCareerStep
        ? shouldBillCareerExploreRest(data)
        : shouldBillGeminiRestResponse(data);
      if (billNonStream) {
        if (pendingCareerStep) {
          try {
            await recordCareerExploreSuccess(authUser.userId, pendingCareerStep);
          } catch (e) {
            console.error('recordCareerExploreSuccess failed:', e);
          }
        } else {
          recordUsageSuccess(
            authUser.userId,
            authUser.membershipType,
            normalizedAction,
            interviewSessionId
          );
        }
      } else if (pendingCareerStep) {
        console.warn('[gemini proxy] career REST response not billed', {
          step: pendingCareerStep,
          flexTextLen: extractCandidateTextFlexible(data).length,
        });
      }
      return res.status(200).json(data);
    }
  } catch (error: any) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: 'AI_SERVICE_ERROR' });
  }

  } catch (err: any) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: 'AI_SERVICE_ERROR' });
  }
}
