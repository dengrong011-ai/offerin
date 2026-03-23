-- interview_history / interview_messages（与 002 内容一致，供尚未执行过 002 的生产库补建）
-- 在 Supabase SQL Editor 中整段执行即可；已存在表/策略时幂等。

-- ============================================
-- 1. 面试历史记录表
-- ============================================

CREATE TABLE IF NOT EXISTS interview_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resume_hash TEXT NOT NULL,
  questions_asked TEXT[] DEFAULT '{}',
  experiences_covered TEXT[] DEFAULT '{}',
  interview_mode TEXT DEFAULT 'simulation' CHECK (interview_mode IN ('simulation', 'interactive')),
  interviewer_role TEXT DEFAULT 'peers',
  total_rounds INTEGER DEFAULT 8,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_history_user_id
  ON interview_history(user_id);

CREATE INDEX IF NOT EXISTS idx_interview_history_resume_hash
  ON interview_history(user_id, resume_hash);

CREATE INDEX IF NOT EXISTS idx_interview_history_created_at
  ON interview_history(created_at DESC);

-- ============================================
-- 2. 面试消息表（可选，应用当前未写入，预留）
-- ============================================

CREATE TABLE IF NOT EXISTS interview_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  history_id UUID NOT NULL REFERENCES interview_history(id) ON DELETE CASCADE,
  message_type TEXT NOT NULL CHECK (message_type IN ('system', 'round', 'interviewer', 'interviewee', 'summary', 'error')),
  content TEXT NOT NULL,
  round_num INTEGER,
  phase TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interview_messages_history_id
  ON interview_messages(history_id);

-- ============================================
-- 3. RLS
-- ============================================

ALTER TABLE interview_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own interview history" ON interview_history;
CREATE POLICY "Users can view own interview history" ON interview_history
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own interview history" ON interview_history;
CREATE POLICY "Users can create own interview history" ON interview_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own interview history" ON interview_history;
CREATE POLICY "Users can delete own interview history" ON interview_history
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own interview messages" ON interview_messages;
CREATE POLICY "Users can view own interview messages" ON interview_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM interview_history
      WHERE interview_history.id = interview_messages.history_id
        AND interview_history.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can create own interview messages" ON interview_messages;
CREATE POLICY "Users can create own interview messages" ON interview_messages
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM interview_history
      WHERE interview_history.id = interview_messages.history_id
        AND interview_history.user_id = auth.uid()
    )
  );

-- ============================================
-- 4. 清理函数（可按需用 Cron 调用；会删 30 天前历史）
-- ============================================

CREATE OR REPLACE FUNCTION cleanup_old_interview_history()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  DELETE FROM interview_history
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;

-- ============================================
-- 5. 按简历拉取历史（SECURITY DEFINER + search_path）
-- ============================================

CREATE OR REPLACE FUNCTION get_interview_history_for_resume(
  p_user_id UUID,
  p_resume_hash TEXT,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  questions_asked TEXT[],
  experiences_covered TEXT[],
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ih.questions_asked,
    ih.experiences_covered,
    ih.created_at
  FROM interview_history ih
  WHERE ih.user_id = p_user_id
    AND ih.resume_hash = p_resume_hash
  ORDER BY ih.created_at DESC
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_interview_history_for_resume(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION get_interview_history_for_resume(UUID, TEXT, INTEGER) TO service_role;
