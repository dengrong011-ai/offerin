/**
 * 统一 CORS 白名单（与前端正式域名一致）
 * 修改后需同步到所有对外 API：gemini/proxy、xorpay/create、xorpay/query
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
