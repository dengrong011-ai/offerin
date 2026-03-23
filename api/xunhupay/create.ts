/**
 * 虎皮椒创建订单（服务端签名，密钥不出前端）
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
/**
 * ⚠️ 以下代码从 ../../services/xunhupayService 内联
 * Vercel @vercel/node 打包 api/ 时无法解析 api/ 外部的相对路径
 */
type XunhuProductType = 'vip_sprint' | 'vip_monthly' | 'resume_download';
interface XunhuProduct {
  id: XunhuProductType;
  name: string;
  price: string;
  priceInCents: number;
  description: string;
}
const XUNHU_PRODUCTS: Record<XunhuProductType, XunhuProduct> = {
  vip_sprint: { id: 'vip_sprint', name: 'Offerin 冲刺计划', price: '19.90', priceInCents: 1990, description: '10天无限简历诊断、模拟面试、PDF导出' },
  vip_monthly: { id: 'vip_monthly', name: 'Offerin VIP月度会员', price: '29.90', priceInCents: 2990, description: '无限简历诊断、模拟面试无限次、PDF导出' },
  resume_download: { id: 'resume_download', name: 'Offerin 简历下载', price: '4.90', priceInCents: 490, description: '下载当前优化后的简历PDF' },
};

const _md5 = (string: string): string => {
  function md5cycle(x: number[], k: number[]) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a=ff(a,b,c,d,k[0],7,-680876936);d=ff(d,a,b,c,k[1],12,-389564586);c=ff(c,d,a,b,k[2],17,606105819);b=ff(b,c,d,a,k[3],22,-1044525330);
    a=ff(a,b,c,d,k[4],7,-176418897);d=ff(d,a,b,c,k[5],12,1200080426);c=ff(c,d,a,b,k[6],17,-1473231341);b=ff(b,c,d,a,k[7],22,-45705983);
    a=ff(a,b,c,d,k[8],7,1770035416);d=ff(d,a,b,c,k[9],12,-1958414417);c=ff(c,d,a,b,k[10],17,-42063);b=ff(b,c,d,a,k[11],22,-1990404162);
    a=ff(a,b,c,d,k[12],7,1804603682);d=ff(d,a,b,c,k[13],12,-40341101);c=ff(c,d,a,b,k[14],17,-1502002290);b=ff(b,c,d,a,k[15],22,1236535329);
    a=gg(a,b,c,d,k[1],5,-165796510);d=gg(d,a,b,c,k[6],9,-1069501632);c=gg(c,d,a,b,k[11],14,643717713);b=gg(b,c,d,a,k[0],20,-373897302);
    a=gg(a,b,c,d,k[5],5,-701558691);d=gg(d,a,b,c,k[10],9,38016083);c=gg(c,d,a,b,k[15],14,-660478335);b=gg(b,c,d,a,k[4],20,-405537848);
    a=gg(a,b,c,d,k[9],5,568446438);d=gg(d,a,b,c,k[14],9,-1019803690);c=gg(c,d,a,b,k[3],14,-187363961);b=gg(b,c,d,a,k[8],20,1163531501);
    a=gg(a,b,c,d,k[13],5,-1444681467);d=gg(d,a,b,c,k[2],9,-51403784);c=gg(c,d,a,b,k[7],14,1735328473);b=gg(b,c,d,a,k[12],20,-1926607734);
    a=hh(a,b,c,d,k[5],4,-378558);d=hh(d,a,b,c,k[8],11,-2022574463);c=hh(c,d,a,b,k[11],16,1839030562);b=hh(b,c,d,a,k[14],23,-35309556);
    a=hh(a,b,c,d,k[1],4,-1530992060);d=hh(d,a,b,c,k[4],11,1272893353);c=hh(c,d,a,b,k[7],16,-155497632);b=hh(b,c,d,a,k[10],23,-1094730640);
    a=hh(a,b,c,d,k[13],4,681279174);d=hh(d,a,b,c,k[0],11,-358537222);c=hh(c,d,a,b,k[3],16,-722521979);b=hh(b,c,d,a,k[6],23,76029189);
    a=hh(a,b,c,d,k[9],4,-640364487);d=hh(d,a,b,c,k[12],11,-421815835);c=hh(c,d,a,b,k[15],16,530742520);b=hh(b,c,d,a,k[2],23,-995338651);
    a=ii(a,b,c,d,k[0],6,-198630844);d=ii(d,a,b,c,k[7],10,1126891415);c=ii(c,d,a,b,k[14],15,-1416354905);b=ii(b,c,d,a,k[5],21,-57434055);
    a=ii(a,b,c,d,k[12],6,1700485571);d=ii(d,a,b,c,k[3],10,-1894986606);c=ii(c,d,a,b,k[10],15,-1051523);b=ii(b,c,d,a,k[1],21,-2054922799);
    a=ii(a,b,c,d,k[8],6,1873313359);d=ii(d,a,b,c,k[15],10,-30611744);c=ii(c,d,a,b,k[6],15,-1560198380);b=ii(b,c,d,a,k[13],21,1309151649);
    a=ii(a,b,c,d,k[4],6,-145523070);d=ii(d,a,b,c,k[11],10,-1120210379);c=ii(c,d,a,b,k[2],15,718787259);b=ii(b,c,d,a,k[9],21,-343485551);
    x[0]=add32(a,x[0]);x[1]=add32(b,x[1]);x[2]=add32(c,x[2]);x[3]=add32(d,x[3]);
  }
  function cmn(q:number,a:number,b:number,x:number,s:number,t:number){a=add32(add32(a,q),add32(x,t));return add32((a<<s)|(a>>>(32-s)),b);}
  function ff(a:number,b:number,c:number,d:number,x:number,s:number,t:number){return cmn((b&c)|((~b)&d),a,b,x,s,t);}
  function gg(a:number,b:number,c:number,d:number,x:number,s:number,t:number){return cmn((b&d)|(c&(~d)),a,b,x,s,t);}
  function hh(a:number,b:number,c:number,d:number,x:number,s:number,t:number){return cmn(b^c^d,a,b,x,s,t);}
  function ii(a:number,b:number,c:number,d:number,x:number,s:number,t:number){return cmn(c^(b|(~d)),a,b,x,s,t);}
  function md5blk(s:string){const m:number[]=[];for(let i=0;i<64;i+=4){m[i>>2]=s.charCodeAt(i)+(s.charCodeAt(i+1)<<8)+(s.charCodeAt(i+2)<<16)+(s.charCodeAt(i+3)<<24);}return m;}
  function md51(s:string){const n=s.length;let state=[1732584193,-271733879,-1732584194,271733878];let i:number;for(i=64;i<=n;i+=64){md5cycle(state,md5blk(s.substring(i-64,i)));}s=s.substring(i-64);const tail=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];for(i=0;i<s.length;i++){tail[i>>2]|=s.charCodeAt(i)<<((i%4)<<3);}tail[i>>2]|=0x80<<((i%4)<<3);if(i>55){md5cycle(state,tail);for(i=0;i<16;i++)tail[i]=0;}tail[14]=n*8;md5cycle(state,tail);return state;}
  function rhex(n:number){const h='0123456789abcdef';let s='';for(let j=0;j<4;j++){s+=h.charAt((n>>(j*8+4))&0x0F)+h.charAt((n>>(j*8))&0x0F);}return s;}
  function hex(x:number[]){return x.map(rhex).join('');}
  function add32(a:number,b:number){return(a+b)&0xFFFFFFFF;}
  function utf8Encode(str:string):string{return unescape(encodeURIComponent(str));}
  return hex(md51(utf8Encode(string)));
};

const generateXunhuSign = (params: Record<string, string | number>, appSecret: string): string => {
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
  return _md5(stringSignTemp);
};

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
