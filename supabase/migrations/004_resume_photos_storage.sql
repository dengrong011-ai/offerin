-- =============================================
-- 简历照片存储：Supabase Storage bucket
-- 用户上传证件照/头像到简历中
-- =============================================

-- 创建 storage bucket（需在 Supabase Dashboard 手动创建，此 SQL 作为参考）
-- Bucket name: resume-photos
-- Public: true（公开读取，无需认证即可访问图片 URL）
-- File size limit: 2MB
-- Allowed MIME types: image/jpeg, image/png, image/webp

-- 注意：Supabase Storage bucket 需要通过 Dashboard 或 API 创建
-- INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
-- VALUES ('resume-photos', 'resume-photos', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp']);

-- Storage RLS 策略

-- 允许已认证用户上传到自己的目录
CREATE POLICY "用户可上传自己的照片"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'resume-photos' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 允许已认证用户更新自己的照片
CREATE POLICY "用户可更新自己的照片"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'resume-photos' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 允许已认证用户删除自己的照片
CREATE POLICY "用户可删除自己的照片"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'resume-photos' 
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- 公开读取（bucket 已设为 public，此策略可选）
CREATE POLICY "任何人可查看简历照片"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'resume-photos');
