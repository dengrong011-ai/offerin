-- 简历模板字段
-- 为 saved_resumes 表添加 template 列，记录用户选择的简历排版模板
-- 默认值 'classic' 对应现有的简洁专业模板

ALTER TABLE saved_resumes 
  ADD COLUMN IF NOT EXISTS template TEXT DEFAULT 'classic';

-- 为已有记录设置默认值
UPDATE saved_resumes SET template = 'classic' WHERE template IS NULL;
