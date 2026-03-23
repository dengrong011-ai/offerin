-- 修复 001 中误用的「全员 true」策略：authenticated 也会命中 RLS，曾导致任意用户可改任意订单。
-- service_role 在 Supabase 中默认绕过 RLS，支付回调使用 service role 无需额外策略。

DROP POLICY IF EXISTS "Service role can update orders" ON payment_orders;
DROP POLICY IF EXISTS "Service role can insert purchases" ON single_purchases;

-- 用户仅能更新自己的 pending 订单（例如回写 xorpay_order_id），不能把状态改为 paid（WITH CHECK 要求仍为 pending）
DROP POLICY IF EXISTS "Users can update own pending orders" ON payment_orders;
CREATE POLICY "Users can update own pending orders" ON payment_orders
  FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

-- 单次购买：开发/模拟支付等场景下用户插入自己的记录；正式支付由 service_role 回调写入（绕过 RLS）
DROP POLICY IF EXISTS "Users can insert own single_purchases" ON single_purchases;
CREATE POLICY "Users can insert own single_purchases" ON single_purchases
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 标记已使用下载次数等
DROP POLICY IF EXISTS "Users can update own single_purchases" ON single_purchases;
CREATE POLICY "Users can update own single_purchases" ON single_purchases
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
