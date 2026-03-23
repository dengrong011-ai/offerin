/**
 * 虎皮椒支付回调接口 (Vercel Serverless Function)
 * 
 * 当用户支付成功后，虎皮椒会向这个接口发送 POST 请求
 * 回调地址格式：https://你的域名/api/xunhupay/notify
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// 环境变量
const XUNHU_APP_SECRET = process.env.XUNHU_APP_SECRET || '';
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

// 初始化 Supabase 客户端（使用 Service Role Key 绕过 RLS）
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// --- subscriptionGrant 内联（与 xorpay/notify 一致）---
const SUBSCRIPTION_PRODUCT_IDS = [
  'vip_sprint', 'vip_monthly', 'resume_pass_10d', 'full_monthly',
] as const;
type SubscriptionProductId = (typeof SUBSCRIPTION_PRODUCT_IDS)[number];
function isSubscriptionProductId(id: string): id is SubscriptionProductId {
  return (SUBSCRIPTION_PRODUCT_IDS as readonly string[]).includes(id);
}
const SUBSCRIPTION_CFG: Record<SubscriptionProductId, { membership: string; days: number }> = {
  vip_sprint: { membership: 'vip', days: 10 },
  vip_monthly: { membership: 'vip', days: 30 },
  resume_pass_10d: { membership: 'resume_pass', days: 10 },
  full_monthly: { membership: 'full_monthly', days: 30 },
};

async function applySubscriptionGrant(
  sb: SupabaseClient,
  userId: string,
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSubscriptionProductId(productId)) return { ok: true };
  const { membership, days } = SUBSCRIPTION_CFG[productId];
  const now = new Date();
  const { data: profileData } = await sb
    .from('profiles')
    .select('vip_expires_at, membership_type')
    .eq('id', userId)
    .single();

  // membership_type 为 free 但仍有未过期的 vip_expires_at：只需改 type 即可
  if (profileData?.membership_type === 'free' && profileData?.vip_expires_at) {
    const existingExpiry = new Date(profileData.vip_expires_at);
    if (existingExpiry > now) {
      const { error: profileError } = await sb
        .from('profiles')
        .update({ membership_type: membership, updated_at: now.toISOString() })
        .eq('id', userId);
      if (profileError) return { ok: false, error: profileError.message };
      return { ok: true };
    }
  }

  let baseDate = now;
  if (profileData?.membership_type === membership && profileData?.vip_expires_at) {
    const existingExpiry = new Date(profileData.vip_expires_at);
    if (existingExpiry > now) baseDate = existingExpiry;
  }
  const expiresAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

  const { error: profileError } = await sb
    .from('profiles')
    .update({
      membership_type: membership,
      vip_expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  if (profileError) return { ok: false, error: profileError.message };
  return { ok: true };
}

/**
 * 简单的 MD5 实现
 */
function md5(string: string): string {
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
}

/**
 * 生成虎皮椒签名
 */
function generateSign(params: Record<string, string>, appSecret: string): string {
  const filteredParams: Record<string, string> = {};
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (key !== 'hash' && value !== null && value !== undefined && value !== '') {
      filteredParams[key] = String(value);
    }
  }

  const sortedKeys = Object.keys(filteredParams).sort();
  const stringA = sortedKeys.map(key => `${key}=${filteredParams[key]}`).join('&');
  const stringSignTemp = stringA + appSecret;
  
  return md5(stringSignTemp);
}

/**
 * 验证虎皮椒回调签名
 */
function verifySign(params: Record<string, string>): boolean {
  const receivedHash = params.hash;
  const calculatedHash = generateSign(params, XUNHU_APP_SECRET);
  return receivedHash === calculatedHash;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 只接受 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 解析回调参数
    const params = req.body as Record<string, string>;
    const {
      trade_order_id,  // 商户订单号
      total_fee,       // 实际支付金额
      transaction_id,  // 支付平台交易号
      open_order_id,   // 虎皮椒内部订单号
      status,          // 订单状态: OD=已支付, CD=已退款
      hash,
    } = params;

    console.log('收到虎皮椒回调:', { trade_order_id, total_fee, status, transaction_id });

    // 验证签名
    if (!verifySign(params)) {
      console.error('签名验证失败');
      return res.status(400).send('sign error');
    }

    // 检查支付状态
    if (status !== 'OD') {
      console.log('非支付成功状态:', status);
      return res.status(200).send('success');
    }

    // 查询订单信息
    const { data: order, error: orderError } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('id', trade_order_id)
      .single();

    if (orderError || !order) {
      console.error('订单不存在:', trade_order_id);
      return res.status(400).send('order not found');
    }

    // 检查订单是否已处理 — 仍需尝试补写 profiles（可能上次回调只改了 status 未写 profiles）
    if (order.status === 'paid') {
      console.log('订单已处理，检查 profiles 是否需补写:', trade_order_id);
      if (isSubscriptionProductId(order.product_id)) {
        const grant = await applySubscriptionGrant(supabase, order.user_id, order.product_id);
        if (!grant.ok) {
          console.error('补写会员失败(已付订单):', grant.error);
        }
      }
      return res.status(200).send('success');
    }

    // 金额校验：虎皮椒 total_fee 是元（字符串），订单 amount 是分（整数）
    const payYuan = parseFloat(String(total_fee).replace(/[^\d.]/g, ''));
    const payCents = Math.round(payYuan * 100);
    const expectedCents = Number(order.amount);
    if (!Number.isFinite(payCents) || payCents !== expectedCents) {
      console.error('回调金额与订单不一致:', total_fee, 'parsed=', payCents, 'expected=', expectedCents);
      return res.status(400).send('amount mismatch');
    }

    // CAS 乐观锁：仅将 pending → paid（并发回调只一方成功）
    const paidAt = new Date().toISOString();
    const { data: updatedRows, error: updateError } = await supabase
      .from('payment_orders')
      .update({
        status: 'paid',
        paid_at: paidAt,
        xunhu_order_id: open_order_id,
        transaction_id: transaction_id,
      })
      .eq('id', trade_order_id)
      .eq('status', 'pending')
      .select('id');

    if (updateError) {
      console.error('更新订单状态失败:', updateError);
      return res.status(500).send('update order failed');
    }

    // 如果没有更新到行，说明被并发请求抢先了
    if (!updatedRows || updatedRows.length === 0) {
      const { data: recheck } = await supabase
        .from('payment_orders')
        .select('status')
        .eq('id', trade_order_id)
        .single();
      if (recheck?.status === 'paid') {
        console.log('订单已由并发请求标记为已支付:', trade_order_id);
        if (isSubscriptionProductId(order.product_id)) {
          const grant = await applySubscriptionGrant(supabase, order.user_id, order.product_id);
          if (!grant.ok) console.error('并发路径补写会员失败:', grant.error);
        }
        return res.status(200).send('success');
      }
      console.error('订单非 pending，无法标记已支付:', trade_order_id);
      return res.status(409).send('conflict');
    }

    // 根据产品类型处理业务逻辑 — 使用统一的 applySubscriptionGrant
    if (isSubscriptionProductId(order.product_id)) {
      const grant = await applySubscriptionGrant(supabase, order.user_id, order.product_id);
      if (!grant.ok) {
        console.error('更新用户会员状态失败:', grant.error);
      }
    } else if (order.product_id === 'resume_download' || order.product_id === 'interview_export') {
      // 单次购买：记录购买记录
      const { error: purchaseError } = await supabase
        .from('single_purchases')
        .insert({
          user_id: order.user_id,
          product_id: order.product_id,
          order_id: trade_order_id,
          used: false,
        });

      if (purchaseError) {
        console.error('记录购买失败:', purchaseError);
      }
    }

    console.log('支付回调处理成功:', trade_order_id);
    
    // 返回 success 告诉虎皮椒已收到通知
    return res.status(200).send('success');

  } catch (error) {
    console.error('处理支付回调出错:', error);
    return res.status(500).send('internal error');
  }
}
