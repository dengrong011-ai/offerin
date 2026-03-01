-- =============================================
-- 首次导出免费功能
-- 为 profiles 表添加首次导出标记字段
-- =============================================

-- 添加首次 PDF 导出标记（是否已使用）
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS first_pdf_export_used BOOLEAN DEFAULT false NOT NULL;

-- 添加首次面试记录导出标记（是否已使用）
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS first_interview_export_used BOOLEAN DEFAULT false NOT NULL;

-- 添加字段注释
COMMENT ON COLUMN profiles.first_pdf_export_used IS '是否已使用首次免费 PDF 导出';
COMMENT ON COLUMN profiles.first_interview_export_used IS '是否已使用首次免费面试记录导出';
