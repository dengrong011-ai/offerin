-- ============================================================
-- 求职笔记本（关联到求职计划）
--
-- 在 Supabase Dashboard → SQL Editor 中执行此文件
-- 另需在 Storage 中新建 bucket: plan-notes (public: false)
-- ============================================================

CREATE TABLE IF NOT EXISTS plan_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES saved_career_plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content TEXT NOT NULL DEFAULT '',
  linked_weeks INTEGER[] DEFAULT '{}',
  linked_task_ids TEXT[] DEFAULT '{}',
  images JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_notes_plan ON plan_notes(plan_id, created_at DESC);

ALTER TABLE plan_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own notes" ON plan_notes
  FOR ALL USING (auth.uid() = user_id);

-- ============================================================
-- Storage: plan-notes bucket (private)
--
-- 方式一：在 Dashboard → Storage 手动新建 bucket，名称 plan-notes，不勾选 Public
-- 方式二：取消下方注释直接执行：
-- INSERT INTO storage.buckets (id, name, public) VALUES ('plan-notes', 'plan-notes', false);
-- ============================================================

-- 用户可上传到自己的目录
CREATE POLICY "用户可上传笔记图片"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'plan-notes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 用户可读取自己的图片（createSignedUrl 需要 SELECT 权限）
CREATE POLICY "用户可查看自己的笔记图片"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'plan-notes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 用户可删除自己的图片
CREATE POLICY "用户可删除笔记图片"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'plan-notes'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
