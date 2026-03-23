-- ============================================================
-- 求职助手 — 数据库迁移（探索阶段）
-- 
-- ⚠️ 仅保存在本地，不要在生产环境执行！
-- 部署前需要在 Supabase Dashboard → SQL Editor 中手动执行
-- ============================================================

-- 1. 用户偏好
CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  core_needs TEXT[],
  core_needs_priority TEXT[],
  salary_min INTEGER,
  salary_max INTEGER,
  open_to_industry_change TEXT DEFAULT 'maybe',
  open_to_city_change TEXT DEFAULT 'maybe',
  target_cities TEXT[],
  target_industries TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own preferences" ON user_preferences
  FOR ALL USING (auth.uid() = user_id);

-- 2. 职业方向
CREATE TABLE IF NOT EXISTS career_directions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction_name TEXT NOT NULL,
  match_score INTEGER,
  analysis JSONB,
  search_keywords TEXT[],
  suggested_filters JSONB,
  status TEXT DEFAULT 'recommended',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_directions_user ON career_directions(user_id, status);

ALTER TABLE career_directions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own directions" ON career_directions
  FOR ALL USING (auth.uid() = user_id);

-- 3. 求职计划
CREATE TABLE IF NOT EXISTS career_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction_id UUID REFERENCES career_directions(id),
  title TEXT NOT NULL,
  total_weeks INTEGER,
  plan_mode TEXT DEFAULT 'ai_suggested',
  start_date DATE,
  target_date DATE,
  phases JSONB,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE career_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own plans" ON career_plans
  FOR ALL USING (auth.uid() = user_id);

-- 4. 计划任务
CREATE TABLE IF NOT EXISTS plan_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES career_plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  phase TEXT,
  title TEXT NOT NULL,
  description TEXT,
  completion_criteria TEXT,
  priority TEXT DEFAULT 'medium',
  resources JSONB,
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_plan ON plan_tasks(plan_id, week_number);

ALTER TABLE plan_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own tasks" ON plan_tasks
  FOR ALL USING (auth.uid() = user_id);

-- 5. 岗位（Week 2 使用，先建表）
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction_id UUID REFERENCES career_directions(id),
  source TEXT NOT NULL,
  source_job_id TEXT,
  source_url TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  company_size TEXT,
  industry TEXT,
  salary_range TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  city TEXT,
  experience TEXT,
  education TEXT,
  description TEXT,
  tags TEXT[],
  published_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ,
  status TEXT DEFAULT 'new',
  applied_at TIMESTAMPTZ,
  user_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, source, source_job_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_user_direction ON jobs(user_id, direction_id);

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own jobs" ON jobs
  FOR ALL USING (auth.uid() = user_id);

-- 6. 岗位匹配分析（Week 2 使用，先建表）
CREATE TABLE IF NOT EXISTS job_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  overall_score INTEGER,
  skill_score INTEGER,
  experience_score INTEGER,
  project_score INTEGER,
  strengths JSONB,
  gaps JSONB,
  focus_points JSONB,
  market_salary TEXT,
  career_path TEXT,
  raw_analysis TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, job_id)
);

ALTER TABLE job_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own matches" ON job_matches
  FOR ALL USING (auth.uid() = user_id);
