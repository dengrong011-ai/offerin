# Gemini 模型 Fallback 说明（诊断用）

## 主模型

业务代码里写死的请求模型为 **`gemini-3.1-pro-preview`**（面试、诊断等调用处一致）。

## 第一层：前端 `generateContentStreamWithRetry`（`interviewService.ts` / `geminiService.ts`）

1. 用 **`options.model`**（即上面的主模型）调用 `createAIClient().generateContentStream`。
2. **同一主模型**最多重试 `RETRY_CONFIG.maxRetries` 次，**仅当**错误属于「可重试」（503、网络等）。  
   - **429 / 404**：不重试主模型，直接进入第 3 步。
3. 主模型仍失败时，**按顺序**只试下面三个（**不包含** 3.1，避免和主模型重复）：
   - `gemini-2.5-pro`（官方 **Model code**，稳定版）
   - `gemini-2.5-flash`
   - `gemini-2.0-flash`

> **为何曾出现 2.5「也失败」？** 若代码里写的是旧预览 ID（如 `gemini-2.5-pro-preview-05-06`），Google 侧可能已下线或改名，会 **404**。请以 [官方文档](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro) 的 **Model code** 为准（当前为 `gemini-2.5-pro` / `gemini-2.5-flash`）。

因此：**正常设计就是「先 3.1 → 再 2.5 Pro → 再 2.5 Flash → 再 2.0 Flash」**。若控制台出现 **1.5** 系列，说明当时运行的**不是当前仓库这份代码**（或本地改过 `FALLBACK_MODELS` / 主模型名）。

## 第二层：服务端 `api/gemini/proxy.ts`（走代理时）

对**单次**转发到 Google 的请求：

- 若主模型（请求体里的 `model`，一般为 3.1）返回 **429** 或 **404**，在同一请求内再按顺序试：  
  **2.5 Pro → 2.5 Flash → 2.0 Flash**（与前端降级链对齐）。
- 响应头 **`X-Gemini-Model`** 为实际命中的模型。

## 为何最后只剩 2.0 Flash？

当 **3.1、2.5 Pro、2.5 Flash** 都因 **429（配额）** 或 **404（模型名不可用/无权限）** 失败时，只有 **`gemini-2.0-flash`** 还能成功，日志就会显示「实际模型: gemini-2.0-flash」。这是**降级链末端**，不是「故意只用 Flash」。

## 排查

- 浏览器控制台：`[Offerin Gemini] 实际模型` / `面试客户端重试成功`。
- 429：换 API Key 项目、等配额重置，或换模型配额池（见 Google AI Studio 配额页）。
- 404：核对 [官方模型 ID](https://ai.google.dev/gemini-api/docs/models) 是否仍有效、当前 Key 是否开通该模型。
