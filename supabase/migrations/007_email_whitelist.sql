-- =============================================
-- 邮箱白名单表：管理 VIP/Special 白名单
-- 将硬编码的白名单迁移到数据库，便于管理
-- =============================================

-- 创建白名单类型枚举
CREATE TYPE whitelist_type AS ENUM ('vip', 'special', 'pro');

-- 创建邮箱白名单表
CREATE TABLE IF NOT EXISTS email_whitelist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  whitelist_type whitelist_type NOT NULL DEFAULT 'special',
  note TEXT,                              -- 备注（如：内测用户、合作方等）
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  expires_at TIMESTAMPTZ,                 -- 可选：白名单过期时间
  is_active BOOLEAN DEFAULT true NOT NULL -- 是否启用
);

-- 创建索引加速查询
CREATE INDEX idx_email_whitelist_email ON email_whitelist(email);
CREATE INDEX idx_email_whitelist_active ON email_whitelist(is_active) WHERE is_active = true;

-- 启用 RLS
ALTER TABLE email_whitelist ENABLE ROW LEVEL SECURITY;

-- RLS 策略：普通用户无法读写，只有 service_role 可访问
-- 这确保白名单只能通过服务端 API 读取

-- 插入初始白名单数据（从硬编码迁移）
INSERT INTO email_whitelist (email, whitelist_type, note) VALUES
  ('dengrong011@gmail.com', 'pro', '管理员'),
  ('814341364@qq.com', 'special', '内测用户'),
  ('aliciagu36@hotmail.com', 'special', '内测用户'),
  ('805786138@qq.com', 'special', '内测用户')
ON CONFLICT (email) DO NOTHING;

-- 添加注释
COMMENT ON TABLE email_whitelist IS '邮箱白名单表：存储 VIP/Special/Pro 特权用户';
COMMENT ON COLUMN email_whitelist.whitelist_type IS 'vip=VIP会员特权, special=每日20次限额, pro=无限制管理员';
COMMENT ON COLUMN email_whitelist.expires_at IS '白名单过期时间，NULL表示永不过期';
