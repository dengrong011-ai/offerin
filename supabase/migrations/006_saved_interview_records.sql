-- 面试记录库数据库迁移脚本
-- 运行方式：在 Supabase SQL Editor 中执行

-- ============================================
-- 1. 创建保存的面试记录表
-- ============================================

CREATE TABLE IF NOT EXISTS saved_interview_records (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  interview_mode TEXT DEFAULT 'simulation' CHECK (interview_mode IN ('simulation', 'interactive')),
  interviewer_role TEXT DEFAULT 'peers',
  total_rounds INTEGER DEFAULT 8,
  messages_json TEXT NOT NULL,           -- 完整对话记录 JSON
  summary TEXT DEFAULT '',               -- 面试评估摘要
  is_favorited BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_saved_interview_records_user_id 
ON saved_interview_records(user_id);

CREATE INDEX IF NOT EXISTS idx_saved_interview_records_updated 
ON saved_interview_records(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_saved_interview_records_favorited 
ON saved_interview_records(user_id, is_favorited, updated_at DESC);

-- ============================================
-- 2. 启用 RLS
-- ============================================

ALTER TABLE saved_interview_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own interview records" ON saved_interview_records;
CREATE POLICY "Users can view own interview records" ON saved_interview_records
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own interview records" ON saved_interview_records;
CREATE POLICY "Users can create own interview records" ON saved_interview_records
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own interview records" ON saved_interview_records;
CREATE POLICY "Users can update own interview records" ON saved_interview_records
  FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own interview records" ON saved_interview_records;
CREATE POLICY "Users can delete own interview records" ON saved_interview_records
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- 3. 自动更新 updated_at 触发器
-- ============================================

CREATE OR REPLACE FUNCTION update_saved_interview_records_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_saved_interview_records_updated_at ON saved_interview_records;
CREATE TRIGGER trigger_update_saved_interview_records_updated_at
  BEFORE UPDATE ON saved_interview_records
  FOR EACH ROW
  EXECUTE FUNCTION update_saved_interview_records_updated_at();
