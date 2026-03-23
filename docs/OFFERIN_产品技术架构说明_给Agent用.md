# Offerin 产品 & 技术架构说明（给 AI Agent 用）

> 用途：供 AI Agent 在分析用户反馈时，快速理解产品定位、核心模块和可能相关的前后端代码/表，从而给出精准的根因假设和排查建议。

---

## 一、产品概览（给 Agent 的长期背景）

### 1. 产品定位

**Offerin 是什么：**

面向职场人的一体化求职助手，核心能力是：简历诊断与重写、模拟面试、职业探索与求职计划。

**目标用户：**

- 有 1–10 年工作经验的互联网 / 大厂 / AI / 电商从业者为主
- 也覆盖应届生

**核心价值：**

帮用户从「一份原始简历 + 目标岗位」出发，一路走到「简历优化 → 模拟面试 → 求职计划 → 持续追踪」。

---

### 2. 核心功能模块

| 模块 | 说明 |
|------|------|
| **简历诊断 & 重写** | 用户上传简历（文本/文件），可选上传 JD。系统给出结构化诊断报告（匹配度评分、亮点、不足、改进建议）。用户可一键生成重写版简历，并对局部内容做「精简 / 量化 / 匹配 JD / 重写」。 |
| **模拟面试** | 用户提供简历 + JD。系统按多轮对话形式进行模拟面试（不同面试官角色），最后给出总结与建议。 |
| **职业探索 & 求职计划** | 基于用户画像（当前职位、年限、技能、偏好），推荐职业方向。生成阶段性求职计划（准备期 / 投递期 / 面试期），强调时间线现实可行（包含 6–8 周投递期）。 |
| **记录库 / 计划库** | 保存用户的简历版本、计划、JD、匹配分析等，后续统一管理求职过程。（进行中） |
| **会员机制** | 免费 / VIP / Pro / Special 等等级，不同功能和调用次数限制（诊断 / 面试等配额）。 |

---

### 3. 典型用户路径

**路径 A：新用户 – 简历为主**

1. 进入官网 → 上传简历（或复制粘贴）
2. 点击简历诊断 → 获取诊断报告
3. 一键重写 → 生成优化版简历
4. 如有 JD：再做「基于 JD 匹配 / 局部重写」

**路径 B：模拟面试为主**

1. 选择「面试」入口 → 上传简历 + JD
2. 选择面试轮次、面试官角色 → 启动模拟面试
3. 完成若干轮 Q&A → 查看总结与改进建议

**路径 C：职业规划为主**

1. 在「探索方向」里填写职业背景与诉求
2. 系统推荐几条职业发展方向 + 职位 title
3. 选择一个方向 → 生成完整求职计划 → 后续跟踪执行

---

## 二、技术架构（为「问题定位建议」服务）

### 1. 前端

**技术栈：** React + TypeScript + Vite

**主要页面/组件（关键）：**

| 文件 | 职责 |
|------|------|
| `App.tsx` | 全局入口与路由状态（step），控制：上传简历、诊断结果、面试入口、探索方向、记录库等页面 |
| `components/ExplorePage.tsx` | 职业探索 & 推荐方向展示页面 |
| `components/CelebrationModal.tsx` | 任务/计划完成时的庆祝弹窗 |
| `components/JobLibrary.tsx` / `components/JobDetailPage.tsx` | JD 库列表与详情页（当前可能尚未在生产上线） |

**前端服务层（调用 AI / API 的封装）：**

| 文件 | 职责 |
|------|------|
| `services/geminiService.ts` | 简历诊断、重写、翻译、音频转文字、从文件中提取文本、局部重写等。通过 `createAIClient(actionType)` 间接调用后端 `/api/gemini/proxy` |
| `services/interviewService.ts` | 模拟面试对话、多轮问答、总结。使用 `createAIClient('interview')` |
| `services/careerService.ts` | 职业画像、探索方向、求职计划的 prompt 构建和 AI 调用 |
| `services/jobService.ts` | 与 `jobs` / `job_matches` 表交互（JD 库相关） |

**前端与后端的统一 AI 调度：**

| 文件 | 职责 |
|------|------|
| `services/geminiProxy.ts` | 封装 `createAIClient(actionType?: string)`：本地开发直接请求 Google Gemini API；生产环境请求自建代理 `/api/gemini/proxy`，并带上 `actionType` |

---

### 2. 后端（Vercel Serverless Functions）

部署在 Vercel，每个 `api/*.ts` 是一个 Endpoint。

**关键接口：**

| 接口 | 职责 |
|------|------|
| `/api/gemini/proxy.ts` | 所有 AI 请求统一经过这里。JWT 鉴权（绑定 Supabase 用户）、按 user_id 速率限制、按 `actionType` + 会员类型做配额控制（diagnosis / interview / resume_edit / auto_rewrite / translation / career_explore 等）、记录 `usage_logs`，转发到 Google Gemini API |
| `/api/jobs/analyze.ts` | 接收来自插件或前端的 JD 文本，写入 `jobs` 表，返回（将来会加匹配分析）。当前插件 / JD 库相关接口，可能部分未对外开放 |

---

### 3. 数据库（Supabase / Postgres）

**关键表（与用户问题相关）：**

| 表 | 说明 |
|------|------|
| `auth.users` | Supabase 内置用户表（id, email 等） |
| `profiles` | 用户画像、会员类型、到期时间等 |
| `usage_logs` | 每次 AI 调用记录：`user_id`、`action_type`（diagnosis / interview / translation / resume_edit / auto_rewrite / career_explore 等）、`created_at` |
| `jobs` | 用户保存的 JD（来源、url、title、company、description 等） |
| `job_matches` | 对 JD 与简历的匹配分析结果 |

---

## 三、常见问题类型与可能相关模块（给 Agent 的「定位提示」）

| 类型 | 示例 | 可能相关 |
|------|------|----------|
| **文案 / 预期不符** | 「以为是模拟面试，结果文案说诊断次数用完」 | 页面文案、按钮命名、错误提示映射 |
| **功能行为与用户心智不一致** | 在面试页上传文件，却被当成「诊断配额」消耗 | `geminiService.ts` / `interviewService.ts` 中 `createAIClient()` 的 `actionType` 设置；`/api/gemini/proxy.ts` 中 `actionType` 白名单、`normalizedAction` 默认值、`checkAndLogUsage()` 逻辑 |
| **真实 bug / 报错** | 系统报错、白屏、按钮无响应、请求失败 | 对应页面组件、服务调用参数；API 返回的错误码 / 500 日志；`usage_logs` 超限导致的 4xx |
| **体验问题 / 学习成本高** | 「看不懂职业方向 title」「卡片信息太少」「不知道下一步该点哪里」 | `ExplorePage.tsx`、产品文案、导航设计等 |
