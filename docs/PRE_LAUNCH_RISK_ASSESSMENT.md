# Offerin 全量发布与商业化前 — 架构与风险评估

> 评估日期：2025-03-07  
> 范围：offer-ing 主应用（Vite + React + Vercel Serverless + Supabase + Gemini + XorPay/虎皮椒）

---

## 一、架构概览

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React 19, Vite 6, TypeScript | SPA，部署于 Vercel |
| API | Vercel Serverless (`api/*.ts`) | Gemini 代理、XorPay/虎皮椒 创建与回调 |
| 数据库 | Supabase (PostgreSQL) | RLS 已启用，业务表 + usage_logs |
| 认证 | Supabase Auth (OTP 邮箱) | JWT，部分 API 未校验 |
| AI | Google Gemini | 经服务端代理，Key 仅服务端 |
| 支付 | XorPay、虎皮椒 | 服务端创建订单、回调验签与落库 |
| 限流 | Upstash Redis / 内存回退 | 仅 Gemini 代理有 IP 限流 |

---

## 二、关键风险与待修改项

### 🔴 严重（必须修复后再全量/商业化）

#### 1. 支付创建接口未鉴权（越权创建订单）

- **位置**: `api/xorpay/create.ts`
- **问题**: 接口仅从 `req.body` 读取 `userId`、`productId`，**未校验 JWT**。任意人可对任意 `userId` 发起创建订单请求，造成：
  - 为他人代下单（骚扰或滥用）
  - 订单与支付归属混乱，客服与对账困难
- **修复**: 在 `create` 中增加与 `api/gemini/proxy.ts` 类似的 JWT 鉴权（如用 Supabase `getUser(token)`），仅允许 `userId === auth.uid()`，否则 401。

#### 2. 虎皮椒回调使用 VITE_ 环境变量（密钥可能暴露）

- **位置**: `api/xunhupay/notify.ts`  
  `XUNHU_APP_SECRET = process.env.VITE_XUNHU_APP_SECRET`
- **问题**: Vite 会将 `VITE_*` 打入前端 bundle，若在生产用 `VITE_XUNHU_APP_SECRET` 配置回调验签密钥，存在泄露风险；且服务端应只用非 VITE_ 的服务端专用变量。
- **修复**:  
  - 服务端仅使用 `XUNHU_APP_SECRET`（不要用 `VITE_XUNHU_APP_SECRET`）。  
  - 在 Vercel 等环境仅配置 `XUNHU_APP_SECRET`，并在 `.env.example` 中说明「回调验签密钥仅服务端，勿用 VITE_ 前缀」。

#### 3. payment_orders 表缺少虎皮椒字段（回调更新会报错）

- **位置**: `api/xunhupay/notify.ts` 中对 `payment_orders` 的 update 使用 `xunhu_order_id`、`transaction_id`；当前迁移 `001_xorpay_payment.sql` 仅包含 `xorpay_order_id`。
- **问题**: 虎皮椒回调会执行  
  `update payment_orders set ..., xunhu_order_id = ..., transaction_id = ...`  
  若表上无这两列，更新会失败，支付成功但会员/单次权益不生效。
- **修复**: 新增迁移，为 `payment_orders` 增加：  
  `xunhu_order_id TEXT`、`transaction_id TEXT`（及必要索引），并在生产执行。

---

### 🟠 高（强烈建议发布前处理）

#### 4. XorPay 回调密钥的 VITE_ 回退

- **位置**: `api/xorpay/notify.ts`  
  `XORPAY_APP_SECRET = process.env.XORPAY_APP_SECRET || process.env.VITE_XORPAY_APP_SECRET`
- **问题**: 服务端使用 `VITE_*` 作为回退，若误在生产配置了 `VITE_XORPAY_APP_SECRET`，同上存在暴露与不良实践。
- **修复**: 服务端仅读取 `XORPAY_APP_SECRET`，移除对 `VITE_XORPAY_APP_SECRET` 的 fallback；在文档与 `.env.example` 中明确「支付回调密钥仅服务端，勿用 VITE_」。

#### 5. Gemini 代理将上游错误详情返回客户端

- **位置**: `api/gemini/proxy.ts` 约 419–424 行  
  `return res.status(googleResponse.status).json({ error: ..., details: errorText })`
- **问题**: `errorText` 可能包含 Google API 内部信息或配额/配置细节，对用户无益且增加信息泄露面。
- **修复**: 仅记录 `errorText` 到服务端日志（已有 `console.error`），对客户端返回通用错误码与简短文案，例如 `{ error: 'AI_SERVICE_ERROR' }`，不返回 `details`。

#### 6. 支付回调日志记录完整 body

- **位置**: `api/xorpay/notify.ts` — `console.log('收到 XorPay 回调:', req.body)`
- **问题**: 回调 body 可能含支付平台订单号、金额等，写入日志后可能进入集中日志/监控，增加合规与泄露风险。
- **修复**: 仅记录订单 ID、结果等最小必要信息，不记录完整 `req.body`；虎皮椒同理，避免记录含敏感字段的完整 params。

---

### 🟡 中（建议在商业化前或早期迭代中完成）

#### 7. 无自动化测试与 CI

- **现状**: 无单元测试、e2e 测试；`package.json` 无 test 脚本；无 GitHub Actions 等 CI。
- **风险**: 改代码易引入回归（支付、鉴权、配额、AI 代理）；发布前依赖人工回归，易漏。
- **建议**: 至少为关键路径增加：  
  - 支付创建鉴权逻辑的单元测试；  
  - Gemini 代理鉴权 + 配额逻辑的单元测试；  
  - 关键 API 的集成/冒烟测试；  
  - 在 CI 中跑 test + build，再部署。

#### 8. 无结构化日志与监控

- **现状**: 使用 `console.log/error/warn`，无统一格式、无 request id、无 APM/错误追踪。
- **风险**: 线上问题难以排查、难以做告警与 SLA 监控。
- **建议**: 引入简单结构化日志（JSON + requestId），并接入 Sentry/DataDog 等错误与性能监控（至少 API 与支付回调）。

#### 9. 支付回调幂等与重试

- **现状**: 已对「订单已 paid」做判断并直接返回成功，避免重复加权益，这是好的。但未显式记录「已处理回调」或防重 token，在极端重试下仍建议有唯一约束或幂等键。
- **建议**: 保持当前逻辑，可在后续为 `payment_orders` 增加 `callback_processed_at` 或类似字段便于对账与排查；若支付平台支持 idempotency key，可一并落库。

#### 10. MEMBERSHIP_LIMITS 类型与注释

- **位置**: `api/gemini/proxy.ts` 中 `MEMBERSHIP_LIMITS` 的 `vip` 含有 `monthly_diagnosis`、`interview_warning_threshold` 等，但 TypeScript 类型未声明，使用 `(limits as any)`；注释中「special 每日 10 次」与实际配置 20 次不一致。
- **建议**: 为 limits 定义准确类型，去掉 `as any`；注释改为「每日 20 次」或与配置统一。

#### 11. 文档与实现不一致

- **位置**: `docs/API_SECURITY_GUIDE.md` 仍描述「API Key 在客户端」及迁移到 Edge Function 的方案，而当前已使用 Vercel 代理且 Key 在服务端。
- **建议**: 更新文档为「当前采用 Vercel Serverless 代理，GEMINI_API_KEY 仅服务端」，并删除或调整过时方案，避免误导后续维护。

---

### 🟢 低 / 已知良好实践

- **SQL 注入**: 全部通过 Supabase 客户端访问，无手写 SQL，风险低。  
- **CORS**: Gemini、XorPay 等 API 使用域名白名单，配置合理。  
- **RLS**: `payment_orders`、`usage_logs`、`saved_resumes` 等已启用 RLS，策略与「仅本人/仅 service_role」一致。  
- **配额与限流**: Gemini 代理侧有 JWT 鉴权、服务端配额校验、模型/actionType 白名单、IP 限流（Upstash/内存），逻辑完整。  
- **支付回调验签**: XorPay、虎皮椒回调均验签后再更新订单与权益，且先查订单再更新，逻辑正确。

---

## 三、环境与配置检查清单

| 项目 | 建议 |
|------|------|
| 生产环境 | 仅设置服务端变量：`GEMINI_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`XORPAY_APP_SECRET`、`XUNHU_APP_SECRET`（勿用 VITE_ 前缀） |
| 前端暴露 | 仅 `VITE_SUPABASE_URL`、`VITE_SUPABASE_ANON_KEY`、`VITE_XORPAY_APP_ID` 等非敏感配置使用 VITE_ |
| Upstash | 生产建议配置，避免多实例下内存限流不共享导致限流失效 |
| `.env.example` | 补充 Xunhupay 服务端变量说明（如 `XUNHU_APP_SECRET`），并注明「仅服务端、勿用 VITE_」 |

---

## 四、发布前最小必做项（摘要）

1. **必须**: 为 `api/xorpay/create` 增加 JWT 鉴权，且仅允许为当前登录用户（`userId === auth.uid()`）创建订单。  
2. **必须**: 虎皮椒回调仅使用 `XUNHU_APP_SECRET`，移除对 `VITE_XUNHU_APP_SECRET` 的依赖；并新增迁移为 `payment_orders` 添加 `xunhu_order_id`、`transaction_id`。  
3. **强烈建议**: XorPay 回调仅使用 `XORPAY_APP_SECRET`；Gemini 代理不向客户端返回 Google API 的 `details`；支付回调日志不记录完整 body。  
4. **建议**: 增加关键 API/支付路径的测试与 CI、更新安全文档与类型/注释、规划简单日志与监控。

完成上述「必须」与「强烈建议」项后，再进行全量发布与商业化，可显著降低安全与合规风险。
