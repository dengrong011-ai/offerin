/**
 * 服务端 API（Vercel）用的 Supabase 环境变量：与 gemini/proxy 对齐。
 * 生产环境常只配 SUPABASE_URL / NEXT_PUBLIC_*，不配 VITE_SUPABASE_URL，否则 URL 为空会导致整段支付回调无法写库。
 */
export function resolveSupabaseUrl(): string {
  return (
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
}

export function resolveSupabaseServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

export function resolveSupabaseAnonKey(): string {
  return (
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ''
  ).trim();
}
