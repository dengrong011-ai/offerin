/**
 * XorPay 创建支付订单接口（服务端）
 * 解决浏览器端直接调用 XorPay API 的 CORS 问题
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// 初始化 Supabase 客户端
const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// XorPay 配置
const XORPAY_APP_ID = process.env.VITE_XORPAY_APP_ID || '';
const XORPAY_APP_SECRET = process.env.VITE_XORPAY_APP_SECRET || '';
const XORPAY_API_BASE = 'https://xorpay.com/api';

// 产品配置
const PRODUCTS: Record<string, { name: string; price: string; priceInCents: number }> = {
  vip_monthly: {
    name: 'VIP月度会员',
    price: '19.90',
    priceInCents: 1990,
  },
  resume_download: {
    name: '简历下载',
    price: '4.90',
    priceInCents: 490,
  },
};

/**
 * MD5 签名算法
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
 * 生成签名
 */
const generateSign = (...params: string[]): string => {
  const str = params.join('');
  return md5Simple(str);
};

/**
 * XorPay 错误码转中文消息
 */
const getErrorMessage = (status: string): string => {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 设置 CORS 头
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 处理预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 只接受 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const { userId, productId, notifyUrl } = req.body;

    // 验证参数
    if (!userId || !productId) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }

    const product = PRODUCTS[productId];
    if (!product) {
      return res.status(400).json({ success: false, error: '无效的产品' });
    }

    // 检查 XorPay 配置
    if (!XORPAY_APP_ID || !XORPAY_APP_SECRET) {
      console.warn('XorPay 未配置');
      return res.status(500).json({ success: false, error: 'XorPay 未配置' });
    }

    // 1. 创建本地订单
    const productType = productId === 'vip_monthly' ? 'vip' : 'single';
    const { data: orderData, error: orderError } = await supabase
      .from('payment_orders')
      .insert({
        user_id: userId,
        product_id: productId,
        product_type: productType,
        amount: product.priceInCents,
        status: 'pending',
        payment_method: 'xorpay',
      })
      .select('id')
      .single();

    if (orderError) {
      console.error('创建订单失败:', orderError);
      return res.status(500).json({ success: false, error: '创建订单失败' });
    }

    const orderId = orderData.id;

    // 2. 生成签名
    const finalNotifyUrl = notifyUrl || `${req.headers.origin}/api/xorpay/notify`;
    const sign = generateSign(
      product.name,
      'native',
      product.price,
      orderId,
      finalNotifyUrl,
      XORPAY_APP_SECRET
    );

    // 3. 调用 XorPay API
    const formData = new URLSearchParams();
    formData.append('name', product.name);
    formData.append('pay_type', 'native');
    formData.append('price', product.price);
    formData.append('order_id', orderId);
    formData.append('notify_url', finalNotifyUrl);
    formData.append('sign', sign);
    formData.append('expire', '7200');

    const xorpayResponse = await fetch(`${XORPAY_API_BASE}/pay/${XORPAY_APP_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    });

    const xorpayResult = await xorpayResponse.json();

    console.log('XorPay 响应:', xorpayResult);

    if (xorpayResult.status === 'ok') {
      // 更新订单的 XorPay 订单号
      await supabase
        .from('payment_orders')
        .update({ xorpay_order_id: xorpayResult.aoid })
        .eq('id', orderId);

      return res.status(200).json({
        success: true,
        orderId: orderId,
        xorpayOrderId: xorpayResult.aoid,
        qrCode: xorpayResult.info?.qr || '',
        expiresIn: xorpayResult.expires_in || 7200,
      });
    } else {
      console.error('XorPay 创建订单失败:', xorpayResult);
      return res.status(400).json({
        success: false,
        orderId: orderId,
        error: getErrorMessage(xorpayResult.status),
      });
    }
  } catch (error: any) {
    console.error('创建支付订单异常:', error);
    return res.status(500).json({
      success: false,
      error: '支付服务暂时不可用，请稍后重试',
    });
  }
}
