/**
 * 虎皮椒支付服务 (XunhuPay)
 * 文档: https://www.xunhupay.com/doc/api/pay.html
 * 
 * 支持微信支付和支付宝，个人可申请
 */

import { supabase, isSupabaseConfigured } from './supabaseClient';

// ============ 虎皮椒配置 ============

// 从环境变量获取配置
const XUNHU_APP_ID = import.meta.env.VITE_XUNHU_APP_ID || '';
const XUNHU_APP_SECRET = import.meta.env.VITE_XUNHU_APP_SECRET || '';

// API 端点
const XUNHU_API_URL = 'https://api.xunhupay.com/payment/do.html';
const XUNHU_API_URL_BACKUP = 'https://api.dpweixin.com/payment/do.html';

// 检查虎皮椒是否已配置
export const isXunhuPayConfigured = (): boolean => {
  return !!(XUNHU_APP_ID && XUNHU_APP_SECRET);
};

// ============ MD5 签名算法 ============

/**
 * 简单的 MD5 实现（用于浏览器环境）
 */
const md5 = (string: string): string => {
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

  function utf8Encode(str: string): string {
    return unescape(encodeURIComponent(str));
  }

  return hex(md51(utf8Encode(string)));
};

/**
 * 生成虎皮椒签名
 * 签名规则：将参数按键名 ASCII 排序，拼接成 key=value& 格式，最后加上密钥，再 MD5
 */
export const generateXunhuSign = (params: Record<string, string | number>, appSecret: string): string => {
  // 1. 过滤空值和 hash 字段
  const filteredParams: Record<string, string> = {};
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (key !== 'hash' && value !== null && value !== undefined && value !== '') {
      filteredParams[key] = String(value);
    }
  }

  // 2. 按键名 ASCII 排序
  const sortedKeys = Object.keys(filteredParams).sort();

  // 3. 拼接成 key=value& 格式
  const stringA = sortedKeys.map(key => `${key}=${filteredParams[key]}`).join('&');

  // 4. 拼接密钥并 MD5
  const stringSignTemp = stringA + appSecret;
  return md5(stringSignTemp);
};

// ============ 产品配置 ============

export type XunhuProductType = 'vip_monthly' | 'resume_download';

export interface XunhuProduct {
  id: XunhuProductType;
  name: string;
  price: string;  // 格式如 "19.90"
  priceInCents: number;
  description: string;
}

export const XUNHU_PRODUCTS: Record<XunhuProductType, XunhuProduct> = {
  vip_monthly: {
    id: 'vip_monthly',
    name: 'Offerin VIP月度会员',
    price: '29.90',
    priceInCents: 2990,
    description: '无限简历诊断、模拟面试10次/月、PDF导出',
  },
  resume_download: {
    id: 'resume_download',
    name: 'Offerin 简历下载',
    price: '4.90',
    priceInCents: 490,
    description: '下载当前优化后的简历PDF',
  },
};

// ============ 订单相关 ============

export interface XunhuOrderResult {
  success: boolean;
  orderId?: string;           // 本地订单ID
  payUrl?: string;            // 手机端支付链接
  qrCodeUrl?: string;         // PC端二维码地址
  error?: string;
}

/**
 * 生成随机字符串
 */
const generateNonceStr = (): string => {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
};

/**
 * 创建本地订单记录
 */
const createLocalOrder = async (
  userId: string,
  productId: XunhuProductType,
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
        payment_method: 'xunhupay',
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
 * 创建虎皮椒支付订单
 * 
 * @param userId 用户ID
 * @param productId 产品ID
 * @param notifyUrl 异步回调地址
 */
export const createXunhuPayOrder = async (
  userId: string,
  productId: XunhuProductType,
  notifyUrl: string
): Promise<XunhuOrderResult> => {
  const product = XUNHU_PRODUCTS[productId];
  if (!product) {
    return { success: false, error: '无效的产品' };
  }

  // 1. 创建本地订单
  const localOrder = await createLocalOrder(userId, productId, product.priceInCents);
  if (!localOrder.success || !localOrder.orderId) {
    return { success: false, error: localOrder.error || '创建订单失败' };
  }

  // 2. 检查虎皮椒配置
  if (!isXunhuPayConfigured()) {
    console.warn('虎皮椒未配置，使用模拟模式');
    // 返回模拟数据用于开发测试
    return {
      success: true,
      orderId: localOrder.orderId,
      payUrl: `https://mock.xunhupay.com/pay?order=${localOrder.orderId}`,
      qrCodeUrl: `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`alipay://mock?order=${localOrder.orderId}`)}`,
    };
  }

  // 3. 构建请求参数
  const timestamp = Math.floor(Date.now() / 1000);
  const nonceStr = generateNonceStr();
  
  const params: Record<string, string | number> = {
    version: '1.1',
    appid: XUNHU_APP_ID,
    trade_order_id: localOrder.orderId,
    total_fee: product.price,
    title: product.name,
    time: timestamp,
    notify_url: notifyUrl,
    nonce_str: nonceStr,
  };

  // 4. 生成签名
  params.hash = generateXunhuSign(params, XUNHU_APP_SECRET);

  // 5. 调用虎皮椒 API
  try {
    const formData = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      formData.append(key, String(value));
    }

    const response = await fetch(XUNHU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const result = await response.json();

    if (result.errcode === 0) {
      return {
        success: true,
        orderId: localOrder.orderId,
        payUrl: result.url,           // 手机端跳转链接
        qrCodeUrl: result.url_qrcode, // PC端二维码
      };
    } else {
      console.error('虎皮椒创建订单失败:', result);
      return {
        success: false,
        orderId: localOrder.orderId,
        error: result.errmsg || '创建订单失败',
      };
    }
  } catch (error: any) {
    console.error('虎皮椒 API 调用失败:', error);
    
    // 尝试备用接口
    try {
      const formData = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        formData.append(key, String(value));
      }

      const response = await fetch(XUNHU_API_URL_BACKUP, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      const result = await response.json();

      if (result.errcode === 0) {
        return {
          success: true,
          orderId: localOrder.orderId,
          payUrl: result.url,
          qrCodeUrl: result.url_qrcode,
        };
      }
    } catch (backupError) {
      console.error('虎皮椒备用接口也失败:', backupError);
    }

    return {
      success: false,
      orderId: localOrder.orderId,
      error: '支付服务暂时不可用，请稍后重试',
    };
  }
};

/**
 * 验证虎皮椒回调签名
 */
export const verifyXunhuNotify = (
  params: Record<string, string>,
  appSecret: string
): boolean => {
  const receivedHash = params.hash;
  const calculatedHash = generateXunhuSign(params, appSecret);
  return receivedHash === calculatedHash;
};

/**
 * 处理支付成功后的业务逻辑
 */
export const handleXunhuPaymentSuccess = async (
  orderId: string,
  userId: string,
  productId: XunhuProductType
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

// ============ 辅助函数 ============

/**
 * 格式化价格显示
 */
export const formatXunhuPrice = (priceInCents: number): string => {
  return `¥${(priceInCents / 100).toFixed(priceInCents % 100 === 0 ? 0 : 2)}`;
};
