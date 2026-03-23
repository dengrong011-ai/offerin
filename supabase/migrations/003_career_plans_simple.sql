-- ============================================================
-- 求职计划库（简化版 — 单表存储完整计划数据）
-- 
-- 在 Supabase Dashboard → SQL Editor 中执行此文件
-- ============================================================

CREATE TABLE IF NOT EXISTS saved_career_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  direction_name TEXT NOT NULL,
  match_score INTEGER,
  plan_data JSONB NOT NULL,
  direction_data JSONB NOT NULL,
  profile_data JSONB NOT NULL,
  total_weeks INTEGER,
  completed_tasks INTEGER DEFAULT 0,
  total_tasks INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_saved_plans_user ON saved_career_plans(user_id, status);

ALTER TABLE saved_career_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own plans" ON saved_career_plans
  FOR ALL USING (auth.uid() = user_id);
