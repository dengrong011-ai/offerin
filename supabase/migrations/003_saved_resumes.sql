-- =============================================
-- 简历库功能：保存、管理多版本简历
-- VIP 专属功能，免费用户不可用
-- =============================================

-- 创建简历库表
CREATE TABLE IF NOT EXISTS saved_resumes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- 简历内容
  title TEXT NOT NULL,                    -- 简历标题（默认: "姓名-目标岗位"）
  resume_markdown TEXT NOT NULL,          -- 简历 Markdown 内容
  english_resume_markdown TEXT,           -- 英文版（如果有）
  
  -- 关联的上下文（方便后续再次诊断/面试）
  job_description TEXT,                   -- 关联的 JD
  aspiration TEXT,                        -- 特别诉求
  
  -- 排版设置
  density_multiplier REAL DEFAULT 1.0,    -- 排版密度设置
  
  -- 元数据
  source TEXT DEFAULT 'reconstruction',   -- 来源: reconstruction(AI重构) / manual(手动创建) / import(导入)
  is_favorited BOOLEAN DEFAULT false,     -- 是否收藏/置顶
  
  -- 时间戳
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_saved_resumes_user_id ON saved_resumes(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_resumes_updated ON saved_resumes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_resumes_favorited ON saved_resumes(user_id, is_favorited, updated_at DESC);

-- RLS 策略
ALTER TABLE saved_resumes ENABLE ROW LEVEL SECURITY;

-- 用户只能操作自己的简历
CREATE POLICY "用户可查看自己的简历"
  ON saved_resumes FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "用户可创建自己的简历"
  ON saved_resumes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "用户可更新自己的简历"
  ON saved_resumes FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "用户可删除自己的简历"
  ON saved_resumes FOR DELETE
  USING (auth.uid() = user_id);

-- 自动更新 updated_at 的触发器
CREATE OR REPLACE FUNCTION update_saved_resumes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_saved_resumes_updated_at
  BEFORE UPDATE ON saved_resumes
  FOR EACH ROW
  EXECUTE FUNCTION update_saved_resumes_updated_at();
