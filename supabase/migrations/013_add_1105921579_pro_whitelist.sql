-- 将 1105921579@qq.com 设置为 Pro 会员（白名单 + profiles 双保险）

-- 1. 加入 email_whitelist（优先级最高，覆盖 profiles.membership_type）
INSERT INTO email_whitelist (email, whitelist_type, note) VALUES
  ('1105921579@qq.com', 'pro', 'Pro 会员 - 已付费VIP用户升级')
ON CONFLICT (email) DO UPDATE SET
  whitelist_type = EXCLUDED.whitelist_type,
  note = EXCLUDED.note,
  is_active = true;

-- 2. 同步更新 profiles 表（确保前端 profile.membership_type 也正确显示）
UPDATE profiles
SET membership_type = 'pro',
    updated_at = now()
WHERE email = '1105921579@qq.com';
