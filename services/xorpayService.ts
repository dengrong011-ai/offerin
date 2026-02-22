/**
 * XorPay 支付服务
 * 文档: https://xorpay.com/doc/api.html
 */

import { supabase, isSupabaseConfigured } from './supabaseClient';

// ============ XorPay 配置 ============

// 从环境变量获取配置（在 .env 文件中设置）
const XORPAY_APP_ID = import.meta.env.VITE_XORPAY_APP_ID || '';
const XORPAY_APP_SECRET = import.meta.env.VITE_XORPAY_APP_SECRET || '';

// API 端点
const XORPAY_API_BASE = 'https://xorpay.com/api';

// 检查 XorPay 是否已配置
export const isXorPayConfigured = (): boolean => {
  return !!(XORPAY_APP_ID && XORPAY_APP_SECRET);
};

// ============ 签名算法 ============

/**
 * MD5 签名算法
 * 将参数按顺序拼接后进行 MD5 加密，转小写
 */
const md5 = async (message: string): Promise<string> => {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  // 注意：XorPay 使用 MD5，但浏览器原生不支持 MD5
  // 这里我们使用一个简单的 MD5 实现
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
};

/**
 * 简单的 MD5 实现（用于浏览器环境）
 */
const md5Simple = (string: string): string => {
  function md5cycle(x: number[], k: number[]) {
    let a = x[0], b = x[1], c = x[2], d = x[3];

    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);

    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);

    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);

    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);

    x[0] = add32(a, x[0]);
    x[1] = add32(b, x[1]);
    x[2] = add32(c, x[2]);
    x[3] = add32(d, x[3]);
  }

  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }

  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & c) | ((~b) & d), a, b, x, s, t);
  }

  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & d) | (c & (~d)), a, b, x, s, t);
  }

  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }

  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(c ^ (b | (~d)), a, b, x, s, t);
  }

  function md5blk(s: string) {
    const md5blks: number[] = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i)
        + (s.charCodeAt(i + 1) << 8)
        + (s.charCodeAt(i + 2) << 16)
        + (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }

  function md5blk_array(a: number[]) {
    const md5blks: number[] = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = a[i]
        + (a[i + 1] << 8)
        + (a[i + 2] << 16)
        + (a[i + 3] << 24);
    }
    return md5blks;
  }

  function md51(s: string) {
    const n = s.length;
    let state = [1732584193, -271733879, -1732584194, 271733878];
    let i: number;
    for (i = 64; i <= n; i += 64) {
      md5cycle(state, md5blk(s.substring(i - 64, i)));
    }
    s = s.substring(i - 64);
    const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < s.length; i++) {
      tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    }
    tail[i >> 2] |= 0x80 << ((i % 4) << 3);
    if (i > 55) {
      md5cycle(state, tail);
      for (i = 0; i < 16; i++) tail[i] = 0;
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }

  function rhex(n: number) {
    const hex_chr = '0123456789abcdef';
    let s = '';
    for (let j = 0; j < 4; j++) {
      s += hex_chr.charAt((n >> (j * 8 + 4)) & 0x0F) + hex_chr.charAt((n >> (j * 8)) & 0x0F);
    }
    return s;
  }

  function hex(x: number[]) {
    return x.map(rhex).join('');
  }

  function add32(a: number, b: number) {
    return (a + b) & 0xFFFFFFFF;
  }

  // UTF-8 编码
  function utf8Encode(str: string): string {
    return unescape(encodeURIComponent(str));
  }

  return hex(md51(utf8Encode(string)));
};

/**
 * 生成 XorPay 签名
 * 签名规则：将参数值按顺序拼接后 MD5 加密
 */
export const generateSign = (...params: string[]): string => {
  const str = params.join('');
  return md5Simple(str);
};

// ============ 产品配置 ============

export type XorPayProductType = 'vip_monthly' | 'resume_download';

export interface XorPayProduct {
  id: XorPayProductType;
  name: string;
  price: string;  // 格式如 "19.90"
  priceInCents: number;
  description: string;
}

export const XORPAY_PRODUCTS: Record<XorPayProductType, XorPayProduct> = {
  vip_monthly: {
    id: 'vip_monthly',
    name: 'VIP月度会员',
    price: '19.90',
    priceInCents: 1990,
    description: '无限简历诊断、模拟面试、PDF导出',
  },
  resume_download: {
    id: 'resume_download',
    name: '简历下载',
    price: '4.90',
    priceInCents: 490,
    description: '下载当前优化后的简历PDF',
  },
};

// ============ 订单相关 ============

export interface XorPayOrderResult {
  success: boolean;
  orderId?: string;        // 本地订单ID
  xorpayOrderId?: string;  // XorPay 平台订单号 (aoid)
  qrCode?: string;         // 支付二维码内容
  expiresIn?: number;      // 过期时间（秒）
  error?: string;
}

export type XorPayOrderStatus = 
  | 'not_exist'   // 订单不存在
  | 'new'         // 订单未支付
  | 'payed'       // 已支付但未通知成功
  | 'fee_error'   // 手续费扣除失败
  | 'success'     // 已支付，通知成功
  | 'expire';     // 订单过期

/**
 * 创建本地订单记录
 */
const createLocalOrder = async (
  userId: string,
  productId: XorPayProductType,
  amount: number
): Promise<{ success: boolean; orderId?: string; error?: string }> => {
  if (!isSupabaseConfigured) {
    // 开发模式：生成一个临时订单ID
    const tempOrderId = `dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return { success: true, orderId: tempOrderId };
  }

  try {
    const productType = productId === 'vip_monthly' ? 'vip' : 'single';
    const { data, error } = await supabase
      .from('payment_orders')
      .insert({
        user_id: userId,
        product_id: productId,
        product_type: productType,
        amount: amount,
        status: 'pending',
        payment_method: 'xorpay',
      })
      .select('id')
      .single();

    if (error) throw error;
    return { success: true, orderId: data.id };
  } catch (error: any) {
    console.error('创建本地订单失败:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 更新本地订单的 XorPay 订单号
 */
const updateOrderXorPayId = async (
  orderId: string,
  xorpayOrderId: string
): Promise<void> => {
  if (!isSupabaseConfigured) return;

  try {
    await supabase
      .from('payment_orders')
      .update({ xorpay_order_id: xorpayOrderId })
      .eq('id', orderId);
  } catch (error) {
    console.error('更新 XorPay 订单号失败:', error);
  }
};

/**
 * 创建 XorPay 支付订单（微信扫码）
 * 
 * @param userId 用户ID
 * @param productId 产品ID
 * @param notifyUrl 异步回调地址
 */
export const createXorPayOrder = async (
  userId: string,
  productId: XorPayProductType,
  notifyUrl: string
): Promise<XorPayOrderResult> => {
  const product = XORPAY_PRODUCTS[productId];
  if (!product) {
    return { success: false, error: '无效的产品' };
  }

  // 1. 创建本地订单
  const localOrder = await createLocalOrder(userId, productId, product.priceInCents);
  if (!localOrder.success || !localOrder.orderId) {
    return { success: false, error: localOrder.error || '创建订单失败' };
  }

  // 2. 检查 XorPay 配置
  if (!isXorPayConfigured()) {
    console.warn('XorPay 未配置，使用模拟模式');
    // 返回模拟数据用于开发测试
    return {
      success: true,
      orderId: localOrder.orderId,
      xorpayOrderId: `mock_${Date.now()}`,
      qrCode: `weixin://wxpay/mock?order=${localOrder.orderId}`,
      expiresIn: 7200,
    };
  }

  // 3. 生成签名
  // 签名规则：name + pay_type + price + order_id + notify_url + app_secret
  const sign = generateSign(
    product.name,
    'native',
    product.price,
    localOrder.orderId,
    notifyUrl,
    XORPAY_APP_SECRET
  );

  // 4. 调用 XorPay API
  try {
    const formData = new URLSearchParams();
    formData.append('name', product.name);
    formData.append('pay_type', 'native');
    formData.append('price', product.price);
    formData.append('order_id', localOrder.orderId);
    formData.append('notify_url', notifyUrl);
    formData.append('sign', sign);
    formData.append('expire', '7200');

    const response = await fetch(`${XORPAY_API_BASE}/pay/${XORPAY_APP_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const result = await response.json();

    if (result.status === 'ok') {
      // 更新本地订单的 XorPay 订单号
      await updateOrderXorPayId(localOrder.orderId, result.aoid);

      return {
        success: true,
        orderId: localOrder.orderId,
        xorpayOrderId: result.aoid,
        qrCode: result.info?.qr || '',
        expiresIn: result.expires_in || 7200,
      };
    } else {
      console.error('XorPay 创建订单失败:', result);
      return {
        success: false,
        orderId: localOrder.orderId,
        error: getXorPayErrorMessage(result.status),
      };
    }
  } catch (error: any) {
    console.error('XorPay API 调用失败:', error);
    return {
      success: false,
      orderId: localOrder.orderId,
      error: '支付服务暂时不可用，请稍后重试',
    };
  }
};

/**
 * 查询 XorPay 订单状态
 * 
 * @param orderId 本地订单号
 */
export const queryXorPayOrderStatus = async (
  orderId: string
): Promise<{ success: boolean; status?: XorPayOrderStatus; error?: string }> => {
  if (!isXorPayConfigured()) {
    // 模拟模式：返回未支付状态
    return { success: true, status: 'new' };
  }

  try {
    // 使用商户订单号查询（方式2）
    const sign = generateSign(orderId, XORPAY_APP_SECRET);
    
    const url = `${XORPAY_API_BASE}/query2/${XORPAY_APP_ID}?order_id=${encodeURIComponent(orderId)}&sign=${sign}`;
    const response = await fetch(url);
    const result = await response.json();

    return {
      success: true,
      status: result.status as XorPayOrderStatus,
    };
  } catch (error: any) {
    console.error('查询订单状态失败:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 验证 XorPay 回调签名
 */
export const verifyXorPayNotify = (
  aoid: string,
  orderId: string,
  payPrice: string,
  payTime: string,
  sign: string
): boolean => {
  // 签名规则：aoid + order_id + pay_price + pay_time + app_secret
  const expectedSign = generateSign(aoid, orderId, payPrice, payTime, XORPAY_APP_SECRET);
  return sign === expectedSign;
};

/**
 * 处理支付成功后的业务逻辑
 */
export const handlePaymentSuccess = async (
  orderId: string,
  userId: string,
  productId: XorPayProductType
): Promise<{ success: boolean; error?: string }> => {
  if (!isSupabaseConfigured) {
    console.log('开发模式：模拟支付成功处理');
    return { success: true };
  }

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
    if (productId === 'vip_monthly') {
      // VIP 会员：更新会员状态
      const currentDate = new Date();
      const expiresAt = new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1000); // 30天

      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          membership_type: 'vip',
          vip_expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);

      if (profileError) throw profileError;
    } else if (productId === 'resume_download') {
      // 单次购买：记录购买记录
      const { error: purchaseError } = await supabase
        .from('single_purchases')
        .insert({
          user_id: userId,
          product_id: productId,
          order_id: orderId,
          used: false,
        });

      if (purchaseError) throw purchaseError;
    }

    return { success: true };
  } catch (error: any) {
    console.error('处理支付成功失败:', error);
    return { success: false, error: error.message };
  }
};

/**
 * XorPay 错误码转中文消息
 */
const getXorPayErrorMessage = (status: string): string => {
  const errorMessages: Record<string, string> = {
    'sign_error': '签名错误',
    'order_exist': '订单已存在',
    'price_error': '金额格式错误',
    'notify_url_error': '回调地址格式错误',
    'name_error': '商品名称不能为空',
    'pay_type_error': '支付类型错误',
    'app_error': '应用配置错误',
    'risk_control': '触发风控，请稍后重试',
  };
  return errorMessages[status] || `支付失败 (${status})`;
};

// ============ 辅助函数 ============

/**
 * 生成二维码图片URL（使用第三方服务）
 */
export const generateQRCodeUrl = (content: string, size: number = 200): string => {
  // 使用 QR Server API（免费服务）
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(content)}`;
};

/**
 * 格式化价格显示
 */
export const formatXorPayPrice = (priceInCents: number): string => {
  return `¥${(priceInCents / 100).toFixed(priceInCents % 100 === 0 ? 0 : 2)}`;
};
