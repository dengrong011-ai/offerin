-- XorPay 支付系统数据库迁移脚本
-- 运行方式：在 Supabase SQL Editor 中执行

-- ============================================
-- 1. 修改 payment_orders 表，添加 XorPay 相关字段
-- ============================================

-- 添加 xorpay_order_id 字段（XorPay 平台订单号）
ALTER TABLE payment_orders 
ADD COLUMN IF NOT EXISTS xorpay_order_id TEXT;

-- 添加 payment_detail 字段（支付详情 JSON）
ALTER TABLE payment_orders 
ADD COLUMN IF NOT EXISTS payment_detail TEXT;

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_payment_orders_xorpay_order_id 
ON payment_orders(xorpay_order_id);

-- ============================================
-- 2. 确保 single_purchases 表存在
-- ============================================

CREATE TABLE IF NOT EXISTS single_purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  order_id UUID REFERENCES payment_orders(id),
  used BOOLEAN DEFAULT false,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_single_purchases_user_product 
ON single_purchases(user_id, product_id);

-- ============================================
-- 3. 确保 payment_orders 表结构完整
-- ============================================

-- 如果 payment_orders 表不存在，创建它
CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_type TEXT NOT NULL CHECK (product_type IN ('vip', 'single')),
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  payment_method TEXT DEFAULT 'xorpay',
  xorpay_order_id TEXT,
  payment_detail TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

-- 添加索引
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status);

-- ============================================
-- 4. 添加 RLS 策略（行级安全）
-- ============================================

-- 启用 RLS
ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE single_purchases ENABLE ROW LEVEL SECURITY;

-- payment_orders 策略
DROP POLICY IF EXISTS "Users can view own orders" ON payment_orders;
CREATE POLICY "Users can view own orders" ON payment_orders
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own orders" ON payment_orders;
CREATE POLICY "Users can create own orders" ON payment_orders
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- single_purchases 策略
DROP POLICY IF EXISTS "Users can view own purchases" ON single_purchases;
CREATE POLICY "Users can view own purchases" ON single_purchases
  FOR SELECT USING (auth.uid() = user_id);

-- ============================================
-- 5. 创建 Service Role 更新策略（用于 Webhook）
-- ============================================

-- 允许 service_role 更新订单状态
DROP POLICY IF EXISTS "Service role can update orders" ON payment_orders;
CREATE POLICY "Service role can update orders" ON payment_orders
  FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Service role can insert purchases" ON single_purchases;
CREATE POLICY "Service role can insert purchases" ON single_purchases
  FOR INSERT WITH CHECK (true);
