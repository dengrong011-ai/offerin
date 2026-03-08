# 商业化上线前检查与建议（10万+ 免费 / 1万+ 付费）

> 目标规模：长期免费用户 10 万+，付费用户 1 万+。以下为上线前建议调整与长期优化项。

---

## 一、必须在上线前完成的项

### 1. 生产环境必须配置 Upstash Redis

- **现状**：未配置时使用**内存限流**，Vercel 多实例下每实例独立计数，**限流失效**。
- **影响**：10 万+ 用户时，单 IP 可绕过「30 次/分钟」限制，放大 Gemini 成本与滥用风险。
- **动作**：在 Vercel 环境变量中配置 `UPSTASH_REDIS_REST_URL`、`UPSTASH_REDIS_REST_TOKEN`，确保生产**仅使用 Redis 限流**。
- **代码**：生产环境（`VERCEL_ENV=production`）下若未配置上述变量，Gemini 代理会返回 503，避免误部署。

### 2. 确认 Supabase 套餐与连接数

- **现状**：Serverless 每次请求新建 Supabase 客户端，连接由 Supabase 池化。
- **建议**：若仍为免费版，评估 **连接数/数据库大小/出口流量** 是否满足 10 万+ 用户；必要时升级 Pro。同时确认 **Auth 月活** 是否在套餐范围内。

### 3. 支付回调与密钥

- **已做**：XorPay 回调仅用 `XORPAY_APP_SECRET`（非 VITE_）；创建订单需 JWT。
- **确认**：生产 Vercel 中已设置 `XORPAY_APP_SECRET`、`XORPAY_APP_ID`，且回调 URL 为正式域名（如 `https://offerin.co/api/xorpay/notify`）。上线前用**真实小额支付**走通一遍创建→支付→回调→VIP 生效。

### 4. 域名与 CORS

- **现状**：CORS 白名单内联在 `api/gemini/proxy.ts`、`api/xorpay/create.ts`、`api/xorpay/query.ts` 的 `CORS_ORIGINS` 常量中；含 `https://offerin.co`、`https://www.offerin.co` 及本地开发 origin。
- **确认**：若正式域不同，需在上述三个文件中同步修改 `CORS_ORIGINS` 并部署。

---

## 二、强烈建议上线前完成的项

### 5. usage_logs 月度查询索引

- **现状**：月度统计使用 `user_id` + `action_type` + `created_at` 范围；当前索引为 `(user_id, action_type)` 与 `(user_id, created_at)`。
- **建议**：新增**复合索引**，使「本月次数」查询走索引、避免全表扫描。数据量到数十万级后收益明显。
- **执行**：迁移文件已存在 `supabase/migrations/011_usage_logs_monthly_index.sql`。二选一执行：
  - **Supabase Dashboard** → SQL Editor → 粘贴该文件内容执行；
  - 或使用 Supabase CLI：`supabase db push`（会执行未应用的 migration）。

### 6. 错误监控与告警

- **现状**：前端已接入 **Sentry**（仅当配置 DSN 时启用）；仅有 `console.log/error/warn` 时无统一告警。
- **动作**：在 [Sentry](https://sentry.io) 创建项目，获取 DSN；在 Vite 构建/运行时的环境变量中配置 **`VITE_SENTRY_DSN`**（如 `.env.production` 或 Vercel 构建环境变量）。可选：为 Vercel Functions（支付回调、Gemini 代理）接入 Sentry Node SDK 并设 5xx/4xx 告警。

### 7. 成本与用量可见

- **Gemini**：在 Google AI Studio 为 `GEMINI_API_KEY` 设置**用量/预算告警**，防止流量暴增或误用导致账单失控。
- **Vercel**：确认 Pro 等套餐的 **Function 调用量/流量** 与 10 万+ 用户匹配；必要时设用量提醒。
- **操作步骤**：详见 **`docs/COST_ALERTS.md`**（Gemini 与 Vercel 告警设置简要步骤）。

---

## 三、上线后可逐步完善的项

### 8. 白名单缓存与 email_whitelist 规模

- **现状**：`email_whitelist` 全表每 5 分钟加载一次到内存；表不大时没问题。
- **建议**：若白名单行数超过数千级，可考虑缩短 TTL 或按需按 email 查询，避免单次加载过大。当前规模可先观察。

### 9. 月度统计时区

- **现状**：「本月」按服务器本地时区（Vercel 多为 UTC）计算。
- **建议**：若需与中国自然月严格一致，可将 `monthStart`/`monthEnd` 改为按 `Asia/Shanghai` 计算；当前逻辑在 UTC 下自洽，可后续再优化。

### 10. usage_logs 归档与清理

- **规模**：10 万免费 × 约 4 次 + 1 万 VIP × 约 300 次/月 → **usage_logs** 月增约数百万行级。
- **建议**：定期归档或删除**超过 N 个月**的 `usage_logs`（仅保留审计所需），减轻表体积与查询成本；可写定时任务或 Supabase Edge Function。

### 11. 支付回调幂等与对账

- **现状**：已对「订单已 paid」做判断，避免重复加权益。
- **建议**：若有对账需求，可在 `payment_orders` 增加 `callback_processed_at` 或类似字段，便于排查与对账；非必须，可按运营需要再加。

### 12. 前端性能与包体积

- **现状**：构建提示存在 >500KB chunk。
- **建议**：后续对 **react-markdown、jspdf、html2canvas** 等大依赖做**按需/异步加载**，降低首屏体积与 LCP，提升 10 万+ 用户下的体验。

---

## 四、清单汇总（今日上线前可逐项打勾）

| 项 | 说明 |
|----|------|
| [ ] Upstash Redis 已在 Vercel 配置 | 生产限流生效 |
| [ ] Supabase 套餐与连接/MAU 确认 | 支撑 10 万+ 用户 |
| [ ] XorPay 生产密钥与回调 URL 正确 | 支付与 VIP 正常 |
| [ ] 真实小额支付全流程跑通 | 创建→支付→回调→VIP |
| [ ] CORS 含正式域名 | 与三处 API 中 `CORS_ORIGINS` 一致 |
| [ ] （可选）usage_logs 复合索引 | 执行 `011_usage_logs_monthly_index.sql` |
| [ ] （可选）Sentry 错误监控 | 配置 `VITE_SENTRY_DSN` 即启用前端上报 |
| [ ] Gemini / Vercel 用量或预算告警 | 见 `docs/COST_ALERTS.md` |

---

## 五、架构与容量简要结论

- **限流**：依赖 Upstash；未配置时多实例下限流失效，**必须配置**。
- **鉴权与配额**：JWT + 服务端按 `usage_logs` 校验，逻辑正确；数据库索引补齐后即可支撑大流量。
- **支付**：回调验签、幂等、JWT 创建订单已就绪；需确认生产密钥与域名。
- **存储与 DB**：Supabase 需按规模选套餐；`usage_logs` 建议加复合索引并规划归档。
- **可观测性**：建议至少接入错误监控与用量/预算告警，便于商业化后快速排障与控本。

完成上述「必须」与「强烈建议」项后，即可按当前架构支撑 10 万+ 免费与 1 万+ 付费用户的商业化上线；其余项可在运营中按需迭代。
