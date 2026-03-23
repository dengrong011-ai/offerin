/**
 * XorPay Webhook 回调处理
 * 
 * 这是 Supabase Edge Function 的模板代码
 * 部署路径: supabase/functions/xorpay-notify/index.ts
 * 
 * 部署命令:
 * supabase functions deploy xorpay-notify
 * 
 * 环境变量配置（在 Supabase Dashboard -> Edge Functions -> Secrets）:
 * - XORPAY_APP_SECRET: XorPay 应用密钥
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

// 环境变量（在 Supabase Dashboard 中配置）
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const XORPAY_APP_SECRET = Deno.env.get('XORPAY_APP_SECRET')!

/**
 * 完整的 MD5 实现（纯 JavaScript，用于 Deno/Edge Function 环境）
 * 因为 Web Crypto API 不支持 MD5，我们需要自己实现
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

  // UTF-8 编码
  function utf8Encode(str: string): string {
    return unescape(encodeURIComponent(str));
  }

  return hex(md51(utf8Encode(string)));
}

// 验证签名
function verifySign(
  aoid: string,
  orderId: string,
  payPrice: string,
  payTime: string,
  sign: string
): boolean {
  // 签名规则：aoid + order_id + pay_price + pay_time + app_secret
  const str = `${aoid}${orderId}${payPrice}${payTime}${XORPAY_APP_SECRET}`
  const expectedSign = md5(str)
  return sign === expectedSign
}

/** 与 server/subscriptionGrant.ts 保持同步（Edge 无法直接 import 仓库模块） */
const SUB_PRODUCT_IDS = ['vip_sprint', 'vip_monthly', 'resume_pass_10d', 'full_monthly'] as const

function isSubProductId(id: string): boolean {
  return (SUB_PRODUCT_IDS as readonly string[]).includes(id)
}

const SUB_CFG: Record<string, { membership: string; days: number }> = {
  vip_sprint: { membership: 'vip', days: 10 },
  vip_monthly: { membership: 'vip', days: 30 },
  resume_pass_10d: { membership: 'resume_pass', days: 10 },
  full_monthly: { membership: 'full_monthly', days: 30 },
}

async function profileNeedsGrantForProduct(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  productId: string,
): Promise<boolean> {
  if (!isSubProductId(productId)) return false
  const expectedMembership = SUB_CFG[productId].membership
  const { data: profile } = await supabase
    .from('profiles')
    .select('membership_type, vip_expires_at')
    .eq('id', userId)
    .single()

  const type = profile?.membership_type || 'free'
  const now = new Date()
  const exp = profile?.vip_expires_at ? new Date(profile.vip_expires_at) : null
  const expValid = !!exp && exp > now

  if (type === 'free') return true

  if (type === expectedMembership) {
    if (expValid) return false
    if (!profile?.vip_expires_at && type === 'vip') return false
    return true
  }

  return true
}

async function applySubscriptionGrantEdge(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  productId: string,
): Promise<{ ok: boolean }> {
  if (!isSubProductId(productId)) return { ok: true }
  const { membership, days } = SUB_CFG[productId]
  const now = new Date()
  const { data: profileData } = await supabase
    .from('profiles')
    .select('vip_expires_at, membership_type')
    .eq('id', userId)
    .single()

  if (profileData?.membership_type === 'free' && profileData?.vip_expires_at) {
    const existingExpiry = new Date(profileData.vip_expires_at)
    if (existingExpiry > now) {
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          membership_type: membership,
          updated_at: now.toISOString(),
        })
        .eq('id', userId)
      return { ok: !profileError }
    }
  }

  let baseDate = now
  if (profileData?.membership_type === membership && profileData?.vip_expires_at) {
    const existingExpiry = new Date(profileData.vip_expires_at)
    if (existingExpiry > now) {
      baseDate = existingExpiry
    }
  }
  const expiresAt = new Date(baseDate.getTime() + days * 24 * 60 * 60 * 1000)

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      membership_type: membership,
      vip_expires_at: expiresAt.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('id', userId)

  return { ok: !profileError }
}

serve(async (req) => {
  // 只接受 POST 请求
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  try {
    // 解析表单数据
    const formData = await req.formData()
    
    const aoid = formData.get('aoid') as string
    const orderId = formData.get('order_id') as string
    const payPrice = formData.get('pay_price') as string
    const payTime = formData.get('pay_time') as string
    const more = formData.get('more') as string
    const detail = formData.get('detail') as string
    const sign = formData.get('sign') as string

    console.log('收到 XorPay 回调:', { aoid, orderId, payPrice, payTime })

    // 1. 验证签名
    if (!verifySign(aoid, orderId, payPrice, payTime, sign)) {
      console.error('签名验证失败')
      return new Response('Sign Error', { status: 400 })
    }

    // 2. 创建 Supabase 客户端
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // 3. 查询订单
    const { data: order, error: orderError } = await supabase
      .from('payment_orders')
      .select('*')
      .eq('id', orderId)
      .single()

    if (orderError || !order) {
      console.error('订单不存在:', orderId)
      return new Response('Order Not Found', { status: 404 })
    }

    // 4. 订单已是 paid：仍可能未写入 profiles，按需幂等补写（与 api/xorpay/notify 一致）
    if (order.status === 'paid') {
      console.log('订单已是已支付状态，检查 profiles:', orderId)
      if (isSubProductId(order.product_id)) {
        const needs = await profileNeedsGrantForProduct(supabase, order.user_id, order.product_id)
        if (needs) {
          const r = await applySubscriptionGrantEdge(supabase, order.user_id, order.product_id)
          if (!r.ok) {
            console.error('补写会员失败(已付订单)')
            return new Response('Profile Error', { status: 500 })
          }
        }
      }
      return new Response('ok', { status: 200 })
    }

    // 5. 仅将 pending → paid（幂等：并发回调只一方执行业务）
    const { data: updatedRows, error: updateError } = await supabase
      .from('payment_orders')
      .update({
        status: 'paid',
        paid_at: payTime,
        xorpay_order_id: aoid,
        payment_detail: detail,
      })
      .eq('id', orderId)
      .eq('status', 'pending')
      .select('id')

    if (updateError) {
      console.error('更新订单失败:', updateError)
      return new Response('Update Error', { status: 500 })
    }

    if (!updatedRows || updatedRows.length === 0) {
      const { data: recheck } = await supabase
        .from('payment_orders')
        .select('status')
        .eq('id', orderId)
        .single()
      if (recheck?.status === 'paid') {
        if (isSubProductId(order.product_id)) {
          const needs = await profileNeedsGrantForProduct(supabase, order.user_id, order.product_id)
          if (needs) {
            const r = await applySubscriptionGrantEdge(supabase, order.user_id, order.product_id)
            if (!r.ok) {
              console.error('并发路径补写会员失败')
              return new Response('Profile Error', { status: 500 })
            }
          }
        }
        return new Response('ok', { status: 200 })
      }
      return new Response('Conflict', { status: 409 })
    }

    // 6. 根据产品类型处理业务逻辑
    const userId = order.user_id
    const productId = order.product_id
    const productType = order.product_type

    if (isSubProductId(productId)) {
      const r = await applySubscriptionGrantEdge(supabase, userId, productId)
      if (!r.ok) {
        console.error('更新会员状态失败')
        return new Response('Profile Error', { status: 500 })
      }
    } else if (productType === 'single') {
      // 单次购买：记录购买记录
      const { error: purchaseError } = await supabase
        .from('single_purchases')
        .insert({
          user_id: userId,
          product_id: productId,
          order_id: orderId,
          used: false,
        })

      if (purchaseError) {
        console.error('记录单次购买失败:', purchaseError)
      }
    }

    console.log('支付处理成功:', orderId)
    
    // 返回成功（必须返回 200 状态码，否则 XorPay 会重试）
    return new Response('ok', { status: 200 })

  } catch (error) {
    console.error('处理回调异常:', error)
    return new Response('Internal Error', { status: 500 })
  }
})
