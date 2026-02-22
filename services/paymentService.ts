import { supabase, isSupabaseConfigured } from './supabaseClient';

// ============ 付费产品类型 ============

export type ProductType = 'vip_monthly' | 'resume_download';

// ============ VIP 套餐配置 ============

export interface VIPPlan {
  id: string;
  name: string;
  price: number;           // 价格（分）
  originalPrice?: number;  // 原价（分）
  duration: number;        // 时长（天）
  description: string;
  features: string[];
  badge?: string;          // 角标
}

// 目前只有包月会员
export const VIP_PLANS: VIPPlan[] = [
  {
    id: 'vip_monthly',
    name: '月度会员',
    price: 1990,           // ¥19.9
    originalPrice: 2990,   // 原价 ¥29.9
    duration: 30,
    description: '求职黄金期必备',
    features: [
      '简历诊断 50次/天',
      '模拟面试 50次/天',
      'PDF 导出无限',
      '英文简历翻译无限',
      '面试记录导出',
    ],
    badge: '限时优惠',
  },
];

// ============ 单次付费产品 ============

export interface SingleProduct {
  id: string;
  name: string;
  price: number;
  description: string;
}

export const SINGLE_PRODUCTS: SingleProduct[] = [
  {
    id: 'resume_download',
    name: '简历下载',
    price: 490,            // ¥4.9
    description: '下载当前优化后的简历 PDF',
  },
];

// 获取产品信息
export const getProduct = (productId: string): VIPPlan | SingleProduct | null => {
  const vipPlan = VIP_PLANS.find(p => p.id === productId);
  if (vipPlan) return vipPlan;
  
  const singleProduct = SINGLE_PRODUCTS.find(p => p.id === productId);
  if (singleProduct) return singleProduct;
  
  return null;
};

// ============ 订单相关 ============

export interface PaymentOrder {
  id: string;
  user_id: string;
  product_id: string;      // 改为 product_id，支持会员和单次产品
  product_type: 'vip' | 'single';  // 产品类型
  amount: number;          // 金额（分）
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  payment_method?: string;
  created_at: string;
  paid_at?: string;
}

// 创建订单（支持会员和单次购买）
export const createOrder = async (
  userId: string,
  productId: string,
  productType: 'vip' | 'single' = 'vip'
): Promise<{ success: boolean; order?: PaymentOrder; error?: string }> => {
  if (!isSupabaseConfigured) {
    return { success: false, error: '服务未配置' };
  }

  const product = getProduct(productId);
  if (!product) {
    return { success: false, error: '无效的产品' };
  }

  try {
    const { data, error } = await supabase
      .from('payment_orders')
      .insert({
        user_id: userId,
        product_id: productId,
        product_type: productType,
        amount: product.price,
        status: 'pending',
      })
      .select()
      .single();

    if (error) throw error;
    return { success: true, order: data as PaymentOrder };
  } catch (error: any) {
    console.error('创建订单失败:', error);
    return { success: false, error: error.message || '创建订单失败' };
  }
};

// 查询订单状态
export const getOrderStatus = async (
  orderId: string
): Promise<{ success: boolean; order?: PaymentOrder; error?: string }> => {
  try {
    const { data, error } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error) throw error;
    return { success: true, order: data as PaymentOrder };
  } catch (error: any) {
    console.error('查询订单失败:', error);
    return { success: false, error: error.message };
  }
};

// 模拟支付完成（开发测试用，生产环境由 webhook 触发）
export const simulatePaymentComplete = async (
  orderId: string,
  userId: string,
  productId: string,
  productType: 'vip' | 'single'
): Promise<{ success: boolean; error?: string }> => {
  try {
    // 1. 更新订单状态
    const { error: orderError } = await supabase
      .from('payment_orders')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (orderError) throw orderError;

    // 2. 根据产品类型处理
    if (productType === 'vip') {
      // VIP 会员：更新会员状态
      const plan = VIP_PLANS.find(p => p.id === productId);
      if (!plan) {
        return { success: false, error: '无效的套餐' };
      }

      const currentDate = new Date();
      const expiresAt = new Date(currentDate.getTime() + plan.duration * 24 * 60 * 60 * 1000);

      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          membership_type: 'vip',
          vip_expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (profileError) throw profileError;
    } else if (productType === 'single') {
      // 单次购买：记录购买记录（用于验证下载权限）
      const { error: purchaseError } = await supabase
        .from('single_purchases')
        .insert({
          user_id: userId,
          product_id: productId,
          order_id: orderId,
        });

      if (purchaseError) throw purchaseError;
    }

    return { success: true };
  } catch (error: any) {
    console.error('处理支付完成失败:', error);
    return { success: false, error: error.message };
  }
};

// 检查用户是否有单次下载权限（已购买或是VIP）
export const checkDownloadPermission = async (
  userId: string,
  membershipType: string
): Promise<{ allowed: boolean; reason?: string }> => {
  // VIP 用户直接允许
  if (membershipType === 'vip' || membershipType === 'pro') {
    return { allowed: true };
  }

  // 检查是否有未使用的单次购买
  try {
    const { data, error } = await supabase
      .from('single_purchases')
      .select('*')
      .eq('user_id', userId)
      .eq('product_id', 'resume_download')
      .eq('used', false)
      .limit(1);

    if (error) throw error;

    if (data && data.length > 0) {
      return { allowed: true };
    }

    return { allowed: false, reason: '请购买下载次数或升级 VIP' };
  } catch (error) {
    console.error('检查下载权限失败:', error);
    return { allowed: false, reason: '检查权限失败' };
  }
};

// 使用一次下载权限
export const useDownloadCredit = async (
  userId: string
): Promise<{ success: boolean; error?: string }> => {
  try {
    // 找到一条未使用的购买记录并标记为已使用
    const { data, error: selectError } = await supabase
      .from('single_purchases')
      .select('id')
      .eq('user_id', userId)
      .eq('product_id', 'resume_download')
      .eq('used', false)
      .limit(1)
      .single();

    if (selectError || !data) {
      return { success: false, error: '没有可用的下载次数' };
    }

    const { error: updateError } = await supabase
      .from('single_purchases')
      .update({ used: true, used_at: new Date().toISOString() })
      .eq('id', data.id);

    if (updateError) throw updateError;

    return { success: true };
  } catch (error: any) {
    console.error('使用下载次数失败:', error);
    return { success: false, error: error.message };
  }
};

// ============ 用户订单历史 ============

export const getUserOrders = async (
  userId: string
): Promise<{ success: boolean; orders?: PaymentOrder[]; error?: string }> => {
  try {
    const { data, error } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return { success: true, orders: data as PaymentOrder[] };
  } catch (error: any) {
    console.error('获取订单历史失败:', error);
    return { success: false, error: error.message };
  }
};

// ============ 价格格式化工具 ============

export const formatPrice = (priceInCents: number): string => {
  return `¥${(priceInCents / 100).toFixed(priceInCents % 100 === 0 ? 0 : 2)}`;
};

export const calculateDiscount = (original: number, current: number): number => {
  return Math.round((1 - current / original) * 100);
};
