# VIP 10天/30天 与 月度次数 计算核对

## 一、10天 / 30天 有效期

| 位置 | 冲刺计划(10天) | 月度(30天) | 计算方式 |
|------|----------------|------------|----------|
| **paymentService.VIP_PLANS** | duration: 10 | duration: 30 | 配置一致 |
| **api/xorpay/notify.ts** | duration = 10 | duration = 30 | `baseDate + duration * 24*60*60*1000` → 正确按天叠加 |
| **api/xunhupay/notify.ts** | duration = 10 | duration = 30 | 同上 |
| **xorpayService.handlePaymentSuccess** | 10 | 30 | 同上（前端模拟/轮询成功时） |
| **paymentService.simulatePaymentComplete** | plan.duration = 10 | 30 | 来自 VIP_PLANS，一致 |
| **api/xorpay/create.ts PRODUCTS** | price 19.90, priceInCents 1990 | 29.90, 2990 | 与前端展示一致 |
| **VIPUpgradeModal** | 「10 天有效」「/10天」 | 「30 天有效」「/月」 | 文案与后端 10/30 一致 |

结论：**10 次/10 天** 此处为「10 天有效」与「30 天有效」的**天数**，所有支付回调与前端展示均按 **10 天 / 30 天** 计算，且到期时间 = 当前（或已有到期日） + 天数 × 24×60×60×1000 ms，**计算正确**。

---

## 二、月度（月）次数统计

| 位置 | 说明 |
|------|------|
| **api/gemini/proxy.ts** | VIP 诊断：`monthly_diagnosis: 200`；面试：`monthly_interview: 100`。`monthStart` = 当月 1 日 00:00（服务器本地时区），`monthEnd` = 当月最后一日 23:59:59.999。查询 `usage_logs` 的 `created_at` 在该区间内计数。 |
| **时区** | `new Date(now.getFullYear(), now.getMonth(), 1)` 使用**服务器本地时区**（Vercel 上一般为 UTC）。即「本月」= 服务器所在时区的自然月；`usage_logs.created_at` 为 timestamptz，比较一致。 |
| **前端 supabaseClient.MEMBERSHIP_LIMITS** | vip.monthly_diagnosis: 200，monthly_interview: 100，与 proxy 一致。 |

结论：**月的计算** 按当月 1 日 0 点到当月最后一日 23:59:59.999（服务器本地时区）统计，**逻辑正确**。若需与中国自然月严格一致，可后续改为按 `Asia/Shanghai` 计算当月区间。

---

## 三、免费版次数（与弹窗文案一致）

- 诊断：3 次（proxy + 前端 MEMBERSHIP_LIMITS + VIP 弹窗「诊断3次」）
- 面试：1 次（同上，「面试1次」）
- 翻译：3 次

**结论：10 天/30 天与月的计算和展示均已正确实现，无需修改。**
