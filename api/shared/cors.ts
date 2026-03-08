import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * 统一 CORS 白名单（与前端正式域名一致）
 * 被 api/gemini/proxy、api/xorpay/create、api/xorpay/query 引用
 */
export const ALLOWED_ORIGINS = [
  'https://offerin.co',
  'https://www.offerin.co',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
];

export function setCorsHeaders(
  res: { setHeader: (name: string, value: string) => void },
  origin: string
): void {
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/** 避免被当作独立路由时报错，直接 404 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(404).end();
}
