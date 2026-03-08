-- 月度次数统计查询优化（user_id + action_type + created_at 范围）
-- 用于 api/gemini/proxy 中 VIP 本月诊断/面试次数统计，数据量增大时避免全表扫描
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_action_created
  ON usage_logs(user_id, action_type, created_at);
