-- 职业探索成功后在 usage_logs 写入 career_explore_* / *_retry；
-- 若库上曾对 action_type 加过白名单 CHECK，会触发 23514，Supabase 里查不到 career 行、前端额度也不减。
-- 本迁移仅删除「定义里包含 action_type」的 CHECK，不碰 RLS/索引。

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.usage_logs'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%action_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.usage_logs DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

COMMENT ON TABLE usage_logs IS '用量记账；action_type 含 diagnosis/interview/translation 及 career_explore_* 等，勿对 action_type 做过窄 CHECK';
