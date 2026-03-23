/**
 * XorPay 支付回调接口
 * 用于接收 XorPay 支付成功通知
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
/**
 * ⚠️ 以下代码从 ../../server/supabaseServerEnv 和 ../../server/subscriptionGrant 内联
 * Vercel @vercel/node 打包 api/ 时无法解析 api/ 外部的相对路径
 */
function resolveSupabaseUrl(): string {
  return (
    process.env.VITE_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ''
  ).trim();
}
function resolveSupabaseServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

// --- subscriptionGrant 内联 ---
const SUBSCRIPTION_PRODUCT_IDS = [
  'vip_sprint',
  'vip_monthly',
  'resume_pass_10d',
  'full_monthly',
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

async function profileNeedsSubscriptionGrantForProduct(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
): Promise<boolean> {
  if (!isSubscriptionProductId(productId)) return false;
  const expectedMembership = SUBSCRIPTION_CFG[productId].membership;
  const { data: profile } = await supabase
    .from('profiles')
    .select('membership_type, vip_expires_at')
    .eq('id', userId)
    .single();

  const type = profile?.membership_type || 'free';
  const now = new Date();
  const exp = profile?.vip_expires_at ? new Date(profile.vip_expires_at) : null;
  const expValid = !!exp && exp > now;

  if (type === 'free') return true;
  if (type === expectedMembership) {
    if (expValid) return false;
    if (!profile?.vip_expires_at && type === 'vip') return false;
    return true;
  }
  return true;
}

async function applySubscriptionGrant(
  supabase: SupabaseClient,
  userId: string,
  productId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isSubscriptionProductId(productId)) {
    return { ok: true };
  }
  const { membership, days } = SUBSCRIPTION_CFG[productId];
  const now = new Date();
  const { data: profileData } = await supabase
    .from('profiles')
    .select('vip_expires_at, membership_type')
    .eq('id', userId)
    .single();

  if (profileData?.membership_type === 'free' && profileData?.vip_expires_at) {
    const existingExpiry = new Date(profileData.vip_expires_at);
    if (existingExpiry > now) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          membership_type: membership,
          updated_at: now.toISOString(),
        })
        .eq('id', userId);
      if (profileError) {
        return { ok: false, error: profileError.message };
      }
      return { ok: true };
    }
  }

  let baseDate = now;
  if (profileData?.membership_type === membership && profileData?.vip_expires_at) {
    const existingExpiry = new Date(profileData.vip_expires_at);
    if (existingExpiry > now) {
      baseDate = existingExpiry;
    }
  }
  const expiresAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000);

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      membership_type: membership,
      vip_expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (profileError) {
    return { ok: false, error: profileError.message };
  }
  return { ok: true };
}

function getServiceClient(): SupabaseClient | null {
  const url = resolveSupabaseUrl();
  const key = resolveSupabaseServiceRoleKey();
  if (!url || !key) {
    console.error('[xorpay/notify] 缺少 Supabase URL 或 SUPABASE_SERVICE_ROLE_KEY，无法写库（请检查 Vercel 环境变量）');
    return null;
  }
  return createClient(url, key);
}

// XorPay 配置（仅使用服务端变量，勿用 VITE_ 前缀以免泄露）
const XORPAY_APP_SECRET = process.env.XORPAY_APP_SECRET || '';

/**
 * MD5 签名算法（与前端一致）
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
 * 验证 XorPay 签名
 */
const verifySign = (aoid: string, orderId: string, payPrice: string, payTime: string, sign: string): boolean => {
  // 签名规则：aoid + order_id + pay_price + pay_time + app_secret
  const expectedSign = md5Simple(aoid + orderId + payPrice + payTime + XORPAY_APP_SECRET);
  return sign === expectedSign;
};

/**
 * 处理支付成功后的业务逻辑
 */
const handlePaymentSuccess = async (orderId: string, supabase: SupabaseClient): Promise<boolean> => {
  try {
    // 1. 查询订单信息
    const { data: order, error: orderError } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('订单不存在:', orderId);
      return false;
    }

    // 2. 订单已是 paid：仍可能未写入 profiles（并发先改状态、首次 grant 失败、或回调重入），按需幂等补写
    if (order.status === 'paid') {
      console.log('订单已是已支付状态，检查 profiles 是否需补写:', orderId);
      if (isSubscriptionProductId(order.product_id)) {
        const needs = await profileNeedsSubscriptionGrantForProduct(supabase, order.user_id, order.product_id);
        if (needs) {
          const grant = await applySubscriptionGrant(supabase, order.user_id, order.product_id);
          if (!grant.ok) {
            console.error('补写会员失败(已付订单):', grant.error);
            return false;
          }
        }
      }
      return true;
    }

    // 3. 仅将 pending → paid（并发回调时只一方成功，避免重复开通）
    const paidAt = new Date().toISOString();
    const { data: updatedRows, error: updateError } = await supabase
      .from('payment_orders')
      .update({
        status: 'paid',
        paid_at: paidAt,
      })
      .eq('id', orderId)
      .eq('status', 'pending')
      .select('id');

    if (updateError) {
      console.error('更新订单状态失败:', updateError);
      return false;
    }

    if (!updatedRows || updatedRows.length === 0) {
      const { data: recheck } = await supabase
        .from('payment_orders')
        .select('status')
        .eq('id', orderId)
        .single();
      if (recheck?.status === 'paid') {
        console.log('订单已由并发请求标记为已支付:', orderId);
        if (isSubscriptionProductId(order.product_id)) {
          const needs = await profileNeedsSubscriptionGrantForProduct(supabase, order.user_id, order.product_id);
          if (needs) {
            const grant = await applySubscriptionGrant(supabase, order.user_id, order.product_id);
            if (!grant.ok) {
              console.error('并发路径补写会员失败:', grant.error);
              return false;
            }
          }
        }
        return true;
      }
      console.error('订单非 pending，无法标记已支付:', orderId);
      return false;
    }

    // 4. 订阅类：与 server/subscriptionGrant 共用逻辑（全局畅享 / 简历畅改 / 老 VIP）
    const grant = await applySubscriptionGrant(supabase, order.user_id, order.product_id);
    if (!grant.ok) {
      console.error('更新会员状态失败:', grant.error);
      return false;
    }

    if (order.product_id === 'resume_download' || order.product_id === 'interview_export') {
      // 单次购买：记录购买记录
      const { error: purchaseError } = await supabase
        .from('single_purchases')
        .insert({
          user_id: order.user_id,
          product_id: order.product_id,
          order_id: orderId,
          used: false,
        });

      if (purchaseError) {
        console.error('记录购买失败:', purchaseError);
        return false;
      }
    }

    console.log('支付成功处理完成:', orderId);
    return true;
  } catch (error) {
    console.error('处理支付失败:', error);
    return false;
  }
};

/**
 * XorPay 支付回调处理
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 只接受 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const supabase = getServiceClient();
    if (!supabase) {
      return res.status(500).send('fail');
    }

    // 解析回调参数
    const { aoid, order_id, pay_price, pay_time, sign } = req.body;

    // 验证必要参数
    if (!aoid || !order_id || !pay_price || !pay_time || !sign) {
      console.error('缺少必要参数');
      return res.status(400).send('fail');
    }

    // 验证签名
    if (!verifySign(aoid, order_id, pay_price, pay_time, sign)) {
      console.error('签名验证失败');
      return res.status(400).send('fail');
    }

    const { data: orderRow, error: orderFetchErr } = await supabase
      .from('payment_orders')
      .select('id, amount, status')
      .eq('id', order_id)
      .single();

    if (orderFetchErr || !orderRow) {
      console.error('回调订单不存在:', order_id);
      return res.status(400).send('fail');
    }

    const payYuan = parseFloat(String(pay_price).replace(/[^\d.]/g, ''));
    const payCents = Math.round(payYuan * 100);
    const expectedCents = Number(orderRow.amount);
    if (!Number.isFinite(payCents) || payCents !== expectedCents) {
      console.error('回调金额与订单不一致:', pay_price, 'parsed=', payCents, 'expected=', expectedCents);
      return res.status(400).send('fail');
    }

    // 处理支付成功
    const success = await handlePaymentSuccess(order_id, supabase);

    if (success) {
      // 返回 success 表示处理成功，XorPay 不会再次回调
      return res.status(200).send('success');
    } else {
      // 返回非 success，XorPay 会重试
      return res.status(500).send('fail');
    }
  } catch (error) {
    console.error('处理回调异常:', error);
    return res.status(500).send('fail');
  }
}
