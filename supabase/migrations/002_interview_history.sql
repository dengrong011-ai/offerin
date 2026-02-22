-- 面试历史记录数据库迁移脚本
-- 运行方式：在 Supabase SQL Editor 中执行

-- ============================================
-- 1. 创建面试历史记录表
-- ============================================

CREATE TABLE IF NOT EXISTS interview_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resume_hash TEXT NOT NULL,              -- 简历内容的哈希（用于识别同一份简历）
  questions_asked TEXT[] DEFAULT '{}',    -- 已问过的核心问题列表
  experiences_covered TEXT[] DEFAULT '{}',-- 已深挖的项目/经历关键词
  interview_mode TEXT DEFAULT 'simulation' CHECK (interview_mode IN ('simulation', 'interactive')),
  interviewer_role TEXT DEFAULT 'peers',   -- 面试官角色
  total_rounds INTEGER DEFAULT 8,          -- 总轮数
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_interview_history_user_id 
ON interview_history(user_id);

CREATE INDEX IF NOT EXISTS idx_interview_history_resume_hash 
ON interview_history(user_id, resume_hash);

CREATE INDEX IF NOT EXISTS idx_interview_history_created_at 
ON interview_history(created_at DESC);

-- ============================================
-- 2. 创建面试消息记录表（可选，用于完整对话记录）
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

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_interview_messages_history_id 
ON interview_messages(history_id);

-- ============================================
-- 3. 启用 RLS（行级安全）
-- ============================================

ALTER TABLE interview_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE interview_messages ENABLE ROW LEVEL SECURITY;

-- interview_history 策略
DROP POLICY IF EXISTS "Users can view own interview history" ON interview_history;
CREATE POLICY "Users can view own interview history" ON interview_history
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own interview history" ON interview_history;
CREATE POLICY "Users can create own interview history" ON interview_history
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own interview history" ON interview_history;
CREATE POLICY "Users can delete own interview history" ON interview_history
  FOR DELETE USING (auth.uid() = user_id);

-- interview_messages 策略
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
-- 4. 创建清理旧记录的函数（可选）
-- ============================================

-- 删除超过 30 天的面试历史记录
CREATE OR REPLACE FUNCTION cleanup_old_interview_history()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM interview_history 
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;

-- 可以通过 Supabase Cron 定期执行此函数

-- ============================================
-- 5. 创建获取面试历史的函数
-- ============================================

-- 获取用户针对特定简历的最近面试历史
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
