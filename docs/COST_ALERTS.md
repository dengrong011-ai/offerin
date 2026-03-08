# 成本与用量告警设置

商业化上线后建议配置用量/预算告警，避免流量或误用导致账单失控。

---

## 1. Google Gemini（GEMINI_API_KEY）

- 打开 [Google AI Studio](https://aistudio.google.com/) 或 [Google Cloud Console](https://console.cloud.google.com/) 中对应项目。
- 在 **Billing / 结算** 或 **API 与服务** 中：
  - 为 Generative Language API 设置**预算**（例如月预算上限）。
  - 启用**预算告警**（例如达到 50%、90%、100% 时邮件通知）。
- 在 **API 用量** 中定期查看请求量、token 消耗，便于与业务量对照。

---

## 2. Vercel（Function 与流量）

- 登录 [Vercel Dashboard](https://vercel.com/dashboard) → 选择项目 → **Settings** → **Billing**（或右上角头像 → **Account Settings** → **Billing**）。
- 确认当前套餐的 **Function 执行次数**、**带宽**、**构建分钟数** 等限额是否满足预估。

### Hobby 套餐说明（免费、不绑卡）

- **没有「支出上限」设置**：Hobby 为免费套餐，不绑定信用卡，因此 **Spend Limit / 支出上限 仅 Pro 团队可用**，Hobby 下找不到是正常的。
- **用量限制**：Hobby 有月度用量上限（如 Function 调用约 100 万次/月、带宽等），超限后该功能会暂停至下个周期，不会扣费。
- **你可做的**：在 **Billing** 或 **Usage** 页面定期查看 **Function Invocations**、**Bandwidth** 等用量，做到心里有数；若需要「支出告警 / 用量告警 / 超额自动暂停」，需升级到 **Pro** 后在 Billing 里设置 Spend Management。

---

## 3. 建议

- 上线前至少为 **Gemini** 设一道预算告警，便于第一时间发现异常用量。
- Vercel 若使用 Pro，留意 Function 冷启动与执行时长（Gemini 代理 `maxDuration` 已设为 300s），避免单次请求过长拉高并发占用。
