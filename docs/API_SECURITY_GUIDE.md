# API 安全配置指南

## ✅ 当前实现（已采用）

本项目 **已使用 Vercel Serverless 代理** 调用 Gemini API，API Key 仅存储在服务端，不会暴露给前端。

- **代理入口**: `api/gemini/proxy.ts`
- **鉴权**: 校验 `Authorization: Bearer <Supabase JWT>`，未登录返回 401
- **配额**: 服务端根据 `profiles.membership_type` 与 `usage_logs` 校验免费/VIP/白名单额度
- **限流**: IP 维度（Upstash Redis 或内存回退），防止单 IP 滥用
- **模型与操作类型**: 白名单校验，防止前端传入非法 model/actionType

前端通过 `services/geminiProxy.ts` 请求 `/api/gemini/proxy` 并携带当前用户 JWT，不再直接持有 `GEMINI_API_KEY`。本地开发可选 `VITE_GEMINI_API_KEY` 直连，生产应仅使用代理。

## 环境变量

| 变量 | 使用位置 | 说明 |
|------|----------|------|
| `GEMINI_API_KEY` | 仅服务端 (proxy) | 必填，勿以 VITE_ 开头 |
| `VITE_GEMINI_API_KEY` | 仅本地开发（可选） | 直连 Google API 时使用，会暴露到客户端，生产勿配置 |
| `UPSTASH_REDIS_REST_URL` / `TOKEN` | 仅服务端 | 可选，用于分布式限流；未配置时使用内存限流 |

## 支付相关（XorPay）

- 创建订单: `api/xorpay/create.ts` 需 JWT，且 `body.userId` 必须为当前用户
- 回调验签: 使用 **服务端变量** `XORPAY_APP_SECRET`，勿在回调中使用 `VITE_XORPAY_APP_SECRET`

## 可选扩展

若后续希望将 AI 代理迁至 Supabase Edge Functions，可参考 Supabase 官方文档创建 Edge Function，并将 `GEMINI_API_KEY` 配置在 Edge Function Secrets 中。当前 Vercel 方案已满足安全要求。

## 注意事项

- 流式响应通过 Server-Sent Events 在代理中转发
- 代理错误时仅向客户端返回通用错误码，不返回上游 API 详情，避免信息泄露
- 生产环境建议配置 Upstash Redis，使多实例限流状态一致
