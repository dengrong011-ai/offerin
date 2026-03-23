# Offer-ing 待修改清单（复核版）

> 状态：**仅排期与说明，尚未改代码**  
> 整理日期：2026-03-21  
> 说明：已合并本地代码审查与外部 CodeBuddy 报告，并剔除已证伪项（如 `xorpayService` 中「MD5 误用 SHA-256」实为未使用的死代码，真实签名为 `md5Simple`）。

---

## 优先级说明

| 级别 | 含义 |
|------|------|
| **P0** | 安全或计费明显受损，建议尽快处理 |
| **P1** | 滥用/成本/数据一致性/合规，建议排入近期迭代 |
| **P2** | 体验、可维护性、工程规范，可分期做 |

---

## P0 — 建议优先

### 1. 虎皮椒支付密钥在前端打包（`VITE_XUNHU_APP_SECRET`）

- **文件**：`services/xunhupayService.ts`（及回调 `api/xunhupay/notify.ts` 环境变量命名）
- **问题**：签名在浏览器内完成，密钥可被从构建产物中提取。
- **方向**：创建订单与签名迁至服务端 API（对齐 `api/xorpay/create.ts` 模式）；前端只调自有接口；密钥改为非 `VITE_` 的服务端变量。

### 2. Markdown / 简历渲染 XSS（`dangerouslySetInnerHTML`）

- **文件**：`components/MarkdownRenderer.tsx`
- **问题**：用户/AI 内容经正则拼进 HTML，未统一转义，存在存储型 XSS 面。
- **方向**：对插入片段做 HTML 转义，或 DOMPurify + 严格 allowlist；优先覆盖标题、列表、链接、`processCommonMarkdown` 输出。

### 3. XorPay 创建订单时 `notifyUrl` 可由客户端传入

- **文件**：`api/xorpay/create.ts`（约 `finalNotifyUrl = notifyUrl || …`）
- **问题**：若支付渠道按该 URL 异步通知，可能被指向非己方域名，导致支付成功但业务侧未履约。
- **方向**：忽略 body 中的 `notifyUrl`，使用服务端硬编码或配置项（如 `https://offerin.co/api/xorpay/notify`），与渠道后台登记地址一致。

### 4. 客户端与服务端对 `usage_logs` 重复记账（诊断 / 翻译等）

- **文件**：`App.tsx`（`logUsage`）、`services/authService.ts`、`api/gemini/proxy.ts`（`checkAndLogUsage`）
- **问题**：Gemini 代理已对多数 action 写入 `usage_logs`，前端部分路径再 `logUsage`，易导致**同一次操作计两次**，免费额度被「减半」。
- **方向**：以**服务端代理记账为准**；梳理每条业务线（诊断、翻译、面试等）只保留一处写入；`InterviewChat` 已注释不重复 log，应对齐其它入口。

### 5. `api/xorpay/query.ts` 仅凭 `orderId` 查询，无用户身份校验

- **文件**：`api/xorpay/query.ts`
- **问题**：若 `orderId` 可枚举或泄露，可能暴露订单支付状态。
- **方向**：要求 `Authorization: Bearer`，校验 JWT，且 `order.user_id === 当前用户`。

---

## P1 — 近期建议

### 6. 配额检查非原子（并发下可能超用）

- **文件**：`api/gemini/proxy.ts`（`checkAndLogUsage`）
- **问题**：先 `count` 再 `insert`，高并发下可能多次通过。
- **方向**：Supabase RPC / 事务实现「检查并插入」原子操作，或接受低风险并加强限流与监控。

### 7. 配额在 Google API 成功前即记账（失败仍扣次）

- **文件**：`api/gemini/proxy.ts`（非 `career_explore` 路径）
- **问题**：429/502 等失败时用户已损失体验次数（与职业探索「成功后再记」不一致）。
- **方向**：改为响应成功后再写入 `usage_logs`（需处理流式响应的「成功」界定）。

### 8. `file_extract` / `transcribe` / `auto_rewrite` 不占试用配额

- **文件**：`api/gemini/proxy.ts`
- **问题**：认证用户可用其绕过「诊断次数」意图，仍受全局限流，但成本可被滥用。
- **方向**：单独子配额、或内容特征校验、或合并计入某类 usage。

### 9. XorPay 回调验签通过后未比对金额

- **文件**：`api/xorpay/notify.ts`
- **问题**：应与 `payment_orders.amount` 或渠道返回金额一致后再履约。
- **方向**：比对 `pay_price` 与订单金额（注意单位与渠道文档）。

### 10. 支付回调「订单已 paid 但权益未发放」的幂等与补偿

- **文件**：`api/xorpay/notify.ts`、`api/xunhupay/notify.ts`
- **问题**：多步更新非单事务时，中间失败可能导致状态卡住。
- **方向**：幂等键以「权益是否已发放」为准，或补偿任务重试发权益。

### 11. 前端 `checkTranslationLimit` 未使用与白名单一致的会员来源

- **文件**：`services/authService.ts`
- **问题**：`checkUsageLimit` 使用 `getEffectiveMembership`，翻译限额仍可能只看 `profiles.membership_type`，与白名单不一致。
- **方向**：翻译限额与 `getEffectiveMembership` 对齐。

### 12. Gemini 代理请求体无显式大小上限

- **文件**：`api/gemini/proxy.ts`
- **问题**：超大 `contents` 可能拖垮 serverless。
- **方向**：限制 body 大小与 `contents` 条数/总字符。

### 13. 生产环境 API 错误信息过于详细（可选）

- **文件**：`api/gemini/proxy.ts` 等
- **方向**：对用户返回通用文案，详细错误仅日志。

---

## P2 — 体验与工程债

### 14. `App.tsx` / `InterviewChat.tsx` 体量过大

- **方向**：按功能拆页面与 hooks，降低维护成本。

### 15. 无路由（URL 不可分享、前进后退）

- **方向**：引入 `react-router` 或等价方案（产品决定）。

### 16. Tailwind 使用 CDN（`index.html`）

- **方向**：构建期 Tailwind + PostCSS（性能与稳定性）。

### 17. 输入与长流程状态丢失

- **方向**：`sessionStorage` debounce 保存简历/JD；面试/长流程 `beforeunload` 提示；按需会话恢复。

### 18. 移动端导航与编辑器布局

- **方向**：汉堡菜单或底部导航；窄屏编辑器 Tab 切换编辑/预览。

### 19. `InterviewChat` AudioContext 未关闭（若仍存在）

- **方向**：卸载时 `close()`，避免实例耗尽。

### 20. CORS / MD5 / 鉴权重复代码

- **方向**：抽公共模块，减少分叉实现。

### 21. `MEMBERSHIP_LIMITS` 等多处配置重复

- **方向**：单一来源或生成脚本，避免前后端漂移。

### 22. 多邮箱注册薅免费额度

- **方向**：产品/风控策略（设备指纹、邮箱域名策略等），非纯前端可解。

### 23. 关键 API 响应无运行时校验

- **方向**：Zod 等校验 Supabase/AI 边界数据。

### 24. 测试与 Lint

- **方向**：ESLint/Prettier、Vitest 覆盖核心计费与鉴权路径。

---

## 已降级或暂不当作「必须修复」的项

| 项 | 说明 |
|----|------|
| CodeBuddy **S5**（`md5Simple` = SHA-256） | **误报**。SHA-256 在未使用的 `md5` async 函数中；实际签名为 `md5Simple`（MD5）。可删死代码以免误导。 |
| **`VITE_GEMINI_API_KEY`** | 生产走代理、不配置进 Vercel 则不会进 bundle；属配置纪律问题，可作 **P2 文档/构建防护**。 |

---

## 建议实施顺序（_ready 后一起做时可参考）

1. **P0：4（重复记账）** — 改动局部、直接影响免费用户体验。  
2. **P0：3（notifyUrl）+ 5（query 鉴权）+ 9（金额校验）** — 支付链路闭环。  
3. **P0：1（虎皮椒服务端签名）** — 与支付同等重要。  
4. **P0：2（XSS）** — 与内容展示相关。  
5. **P1：6–12** — 按成本与客诉压力排序。  
6. **P2** — 随版本迭代拆分。

---

*Ready 后可在本文件勾选或改状态，再逐项提交 PR。*
