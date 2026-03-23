-- 面试按「场次」聚合：同一会话内多次 Gemini 调用共享 interview_session_id，免费试用按场计数

ALTER TABLE usage_logs
  ADD COLUMN IF NOT EXISTS interview_session_id UUID NULL;

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_interview_session
  ON usage_logs (user_id, action_type, interview_session_id)
  WHERE action_type = 'interview' AND interview_session_id IS NOT NULL;

COMMENT ON COLUMN usage_logs.interview_session_id IS '模拟面试场次 ID；同一场多轮请求共用，免费试用按 distinct 场次计';
