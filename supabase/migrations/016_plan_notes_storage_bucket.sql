-- 创建求职笔记本图片私有 bucket（若尚未在 Dashboard 手动创建）
-- 修复客户端 upload 时报 StorageApiError: Bucket not found

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'plan-notes') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('plan-notes', 'plan-notes', false);
  END IF;
END $$;
