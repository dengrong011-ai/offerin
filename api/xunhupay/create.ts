/**
 * 虎皮椒创建订单（服务端签名，密钥不出前端）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import {
  generateXunhuSign,
  XUNHU_PRODUCTS,
  type XunhuProductType,
} from '../../services/xunhupayService';

const CORS_ORIGINS = [
  'https://offerin.co',
  'https://www.offerin.co',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
];

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function getSupabaseAuth(jwt: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}

async function getAuthenticatedUserId(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const jwt = authHeader.slice(7).trim();
  if (!jwt) return null;
  try {
    const {
      data: { user },
      error,
    } = await getSupabaseAuth(jwt).auth.getUser();
    return error || !user ? null : user.id;
  } catch {
    return null;
  }
}

const XUNHU_APP_ID = (process.env.XUNHU_APP_ID || process.env.VITE_XUNHU_APP_ID || '').trim();
const XUNHU_APP_SECRET = (process.env.XUNHU_APP_SECRET || '').trim();
const XUNHU_API_URL = 'https://api.xunhupay.com/payment/do.html';
const XUNHU_API_URL_BACKUP = 'https://api.dpweixin.com/payment/do.html';

function generateNonceStr(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || '';
  if (CORS_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

  const userId = await getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ success: false, error: '请先登录' });
  }

  try {
    const { productId } = req.body as { productId?: string };
    if (!productId) {
      return res.status(400).json({ success: false, error: '缺少 productId' });
    }

    const product = XUNHU_PRODUCTS[productId as XunhuProductType];
    if (!product) {
      return res.status(400).json({ success: false, error: '无效的产品' });
    }

    if (!XUNHU_APP_ID || !XUNHU_APP_SECRET) {
      console.warn('虎皮椒服务端未配置 XUNHU_APP_ID / XUNHU_APP_SECRET');
      return res.status(500).json({ success: false, error: '虎皮椒未配置' });
    }

    const productType =
      productId === 'vip_monthly' || productId === 'vip_sprint' ? 'vip' : 'single';

    const { data: orderData, error: orderError } = await supabase
      .from('payment_orders')
      .insert({
        user_id: userId,
        product_id: productId,
        product_type: productType,
        amount: product.priceInCents,
        status: 'pending',
        payment_method: 'xunhupay',
      })
      .select('id')
      .single();

    if (orderError || !orderData?.id) {
      console.error('创建虎皮椒本地订单失败:', orderError);
      return res.status(500).json({ success: false, error: '创建订单失败' });
    }

    const orderId = orderData.id;
    const notifyUrl =
      (process.env.XUNHU_NOTIFY_URL || '').trim() || 'https://offerin.co/api/xunhupay/notify';

    const timestamp = Math.floor(Date.now() / 1000);
    const params: Record<string, string | number> = {
      version: '1.1',
      appid: XUNHU_APP_ID,
      trade_order_id: orderId,
      total_fee: product.price,
      title: product.name,
      time: timestamp,
      notify_url: notifyUrl,
      nonce_str: generateNonceStr(),
    };
    params.hash = generateXunhuSign(params, XUNHU_APP_SECRET);

    const postXunhu = async (url: string) => {
      const formData = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        formData.append(key, String(value));
      }
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });
    };

    let response = await postXunhu(XUNHU_API_URL);
    let result = await response.json();

    if (result.errcode !== 0) {
      response = await postXunhu(XUNHU_API_URL_BACKUP);
      result = await response.json();
    }

    if (result.errcode === 0) {
      return res.status(200).json({
        success: true,
        orderId,
        payUrl: result.url,
        qrCodeUrl: result.url_qrcode,
      });
    }

    console.error('虎皮椒创建订单失败:', result);
    return res.status(502).json({
      success: false,
      error: result.errmsg || '创建支付单失败',
    });
  } catch (e: any) {
    console.error('api/xunhupay/create:', e);
    return res.status(500).json({ success: false, error: '服务异常' });
  }
}
