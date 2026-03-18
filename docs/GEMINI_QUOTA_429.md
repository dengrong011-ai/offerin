# 解决 Gemini API 429 限流（根本方案）

## 限流来源

1. **我们的 Upstash 限流**：90 次/分钟/用户（已按 user_id 计，不与他人共享）
2. **Google Gemini API 限流**：由 Google 项目配额决定，**按模型分开计**（Pro、Flash 等各自独立）

## 如何判断是哪个模型/配额用尽

### 方法 1：看 Vercel 日志

部署后，当发生 429 时，proxy 会打出类似日志：

```
[429] model=gemini-3.1-pro-preview quota_metric=generate_content_requests quota_limit=15
```

- `model`：触发的模型（若为 Pro 且 Flash fallback 成功，则不会到这一步）
- `quota_metric`：通常是 `generate_content_requests`（RPM）、`generate_content_tokens`（TPM）或 `generate_content_daily_requests`（RPD）
- `quota_limit`：该维度的限值

在 Vercel 项目 → Logs 中搜索 `[429]` 即可。

### 方法 2：Google AI Studio 配额页

1. 打开 [Google AI Studio](https://aistudio.google.com/) 并登录
2. 进入 **API 密钥** 或 **速率限制**（Rate limits）页面
3. 查看各模型对应的 RPM / TPM / RPD 使用量与限制

### 方法 3：Google Cloud Console

1. 打开 [Cloud Console](https://console.cloud.google.com/) → 选择项目
2. **API 和服务** → **已启用的 API** → 找到 **Generative Language API**
3. **配额** 标签页：可按 `generate_content_requests`、`generate_content_tokens` 等维度查看

## 根本解决方案：提升 Google 配额

Google AI 免费 tier 通常只有 **5–15 RPM**，一场 8 轮面试约需 **17 次** 请求，易触发 429。

### 步骤（推荐）

1. 在 [Google AI Studio](https://aistudio.google.com/) 或 [Cloud Console](https://console.cloud.google.com/) 中
2. **启用结算（Billing）** 升级到 Tier 1：约 **150–300 RPM**
3. 如仍不足，在 Cloud Console 中申请提高配额

### 已做的缓解措施（代码层面）

- 主模型 429 时自动 fallback 到 `gemini-2.0-flash`（单独配额池）
- Upstash 限流提高到 90/分钟
- 登录用户按 user_id 限流，避免同 IP 互相抢额度
