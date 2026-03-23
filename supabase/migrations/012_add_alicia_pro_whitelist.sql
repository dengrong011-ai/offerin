-- 添加 aliciagu36@gmail.com 为 pro 白名单（无上限）
INSERT INTO email_whitelist (email, whitelist_type, note) VALUES
  ('aliciagu36@gmail.com', 'pro', 'Pro 白名单')
ON CONFLICT (email) DO UPDATE SET
  whitelist_type = EXCLUDED.whitelist_type,
  note = EXCLUDED.note;
