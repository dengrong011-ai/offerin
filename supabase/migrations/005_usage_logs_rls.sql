-- =============================================
-- usage_logs 表安全策略
-- 防止用户篡改或删除自己的使用记录
-- =============================================

-- 确保 usage_logs 表存在（如尚未通过迁移创建）
CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  action_type TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- 创建索引加速查询
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_action 
  ON usage_logs(user_id, action_type);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_created 
  ON usage_logs(user_id, created_at);

-- 启用 RLS
ALTER TABLE usage_logs ENABLE ROW LEVEL SECURITY;

-- 删除已有策略（幂等）
DROP POLICY IF EXISTS "Users can insert own usage logs" ON usage_logs;
DROP POLICY IF EXISTS "Users can read own usage logs" ON usage_logs;
DROP POLICY IF EXISTS "Service role full access to usage logs" ON usage_logs;

-- 用户只能插入自己的记录（前端 logUsage 调用）
CREATE POLICY "Users can insert own usage logs" ON usage_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 用户可以读取自己的记录（前端 checkUsageLimit 查询）
CREATE POLICY "Users can read own usage logs" ON usage_logs
  FOR SELECT
  USING (auth.uid() = user_id);

-- 注意：不创建 UPDATE / DELETE 策略
-- 用户无法修改或删除自己的使用记录
-- 服务端 proxy 使用 service_role key，绕过 RLS，可正常写入
