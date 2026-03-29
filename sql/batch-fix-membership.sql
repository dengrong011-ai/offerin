-- ============================================================
-- 批量修复：已付款但 profiles.membership_type 仍为 free 的用户
-- 在 Supabase SQL Editor 中执行
-- ============================================================

-- ================================
-- STEP 1: 先查看受影响的用户（只读，不修改数据）
-- ================================
SELECT 
  p.id AS user_id,
  p.email,
  p.membership_type,
  p.vip_expires_at,
  po.id AS order_id,
  po.product_id,
  po.status AS order_status,
  po.paid_at,
  po.created_at AS order_created_at
FROM profiles p
INNER JOIN payment_orders po ON po.user_id = p.id
WHERE po.status = 'paid'
  AND po.product_id IN ('vip_sprint', 'vip_monthly', 'resume_pass_10d', 'full_monthly')
  AND (
    p.membership_type = 'free' 
    OR p.membership_type IS NULL
    OR (p.vip_expires_at IS NOT NULL AND p.vip_expires_at < NOW())
  )
ORDER BY po.paid_at DESC;

-- ================================
-- STEP 2: 批量修复（请先执行 STEP 1 确认受影响用户后再执行此段）
-- 逻辑：找到每个用户最近一笔 paid 订阅订单，根据 product_id 设置正确的 membership_type 和 vip_expires_at
-- ================================

-- 用 CTE 找到每个用户的最新已付订阅订单
WITH latest_paid_orders AS (
  SELECT DISTINCT ON (user_id)
    user_id,
    product_id,
    paid_at,
    created_at
  FROM payment_orders
  WHERE status = 'paid'
    AND product_id IN ('vip_sprint', 'vip_monthly', 'resume_pass_10d', 'full_monthly')
  ORDER BY user_id, COALESCE(paid_at, created_at) DESC
),
-- 计算每个用户应该设置的 membership_type 和 vip_expires_at
fix_data AS (
  SELECT
    lpo.user_id,
    CASE lpo.product_id
      WHEN 'vip_sprint' THEN 'vip'
      WHEN 'vip_monthly' THEN 'vip'
      WHEN 'resume_pass_10d' THEN 'resume_pass'
      WHEN 'full_monthly' THEN 'full_monthly'
    END AS correct_membership,
    CASE lpo.product_id
      WHEN 'vip_sprint' THEN COALESCE(lpo.paid_at, lpo.created_at) + INTERVAL '10 days'
      WHEN 'vip_monthly' THEN COALESCE(lpo.paid_at, lpo.created_at) + INTERVAL '30 days'
      WHEN 'resume_pass_10d' THEN COALESCE(lpo.paid_at, lpo.created_at) + INTERVAL '10 days'
      WHEN 'full_monthly' THEN COALESCE(lpo.paid_at, lpo.created_at) + INTERVAL '30 days'
    END AS correct_expires_at
  FROM latest_paid_orders lpo
  INNER JOIN profiles p ON p.id = lpo.user_id
  WHERE p.membership_type = 'free' 
     OR p.membership_type IS NULL
     OR (p.vip_expires_at IS NOT NULL AND p.vip_expires_at < NOW() 
         AND COALESCE(lpo.paid_at, lpo.created_at) + 
             CASE lpo.product_id
               WHEN 'vip_sprint' THEN INTERVAL '10 days'
               WHEN 'vip_monthly' THEN INTERVAL '30 days'
               WHEN 'resume_pass_10d' THEN INTERVAL '10 days'
               WHEN 'full_monthly' THEN INTERVAL '30 days'
             END > NOW()
        )
)
UPDATE profiles
SET 
  membership_type = fix_data.correct_membership,
  vip_expires_at = fix_data.correct_expires_at,
  updated_at = NOW()
FROM fix_data
WHERE profiles.id = fix_data.user_id
  -- 只修复那些 expires_at 还没过期的（即用户确实还应该有会员）
  AND fix_data.correct_expires_at > NOW();
