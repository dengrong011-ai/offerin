-- =============================================
-- 虎皮椒支付：payment_orders 增加回调字段
-- 供 api/xunhupay/notify 更新订单时使用
-- =============================================

ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS xunhu_order_id TEXT,
  ADD COLUMN IF NOT EXISTS transaction_id TEXT;

CREATE INDEX IF NOT EXISTS idx_payment_orders_xunhu_order_id
  ON payment_orders(xunhu_order_id);
