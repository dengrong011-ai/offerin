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

## 二、月度（月）次数统计（老 VIP `vip`）

| 配置项 | 数值 | 说明 |
|--------|------|------|
| `monthly_diagnosis` | **200** | 简历侧月硬上限：统计 `usage_logs` 中 `diagnosis` / `resume_edit`（`auto_rewrite` 请求在 proxy 中早退且不写入日志，不计入） |
| `monthly_interview` | **300** | 模拟面试请求条数月硬上限（按 `usage_logs.action_type = interview` 计数） |
| `diagnosis_warning_threshold` | **100** | 仅 **控制台预警**，不拦截 |
| `interview_warning_threshold` | **240** | 仅 **控制台预警**，不拦截 |

| 位置 | 说明 |
|------|------|
| **api/gemini/proxy.ts** | 上述数字以服务端 `MEMBERSHIP_LIMITS.vip` 为准；`monthStart` / `monthEnd` 使用 **`Date.UTC` 的 UTC 自然月**（当月 1 日 00:00:00.000Z 至当月最后一日 23:59:59.999Z）。 |
| **前端 services/supabaseClient.ts** | `MEMBERSHIP_LIMITS.vip` 与 proxy 保持一致（200 / 300 / 预警 100 & 240）。 |

结论：**月区间按 UTC 自然月** 统计；若需与中国（东八区）自然月一致，需单独改区间计算。

---

## 三、免费版次数（与弹窗文案一致）

- 诊断：3 次（proxy + 前端 MEMBERSHIP_LIMITS + VIP 弹窗「诊断3次」）
- 面试：1 次（同上，「面试1次」）
- 翻译：3 次

**结论：10 天/30 天与月的计算和展示均已正确实现，无需修改。**
