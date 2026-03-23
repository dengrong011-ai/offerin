# 求职助手 — 开发 Todolist

> 基于 `CAREER_ASSISTANT_DEV_PLAN.md`，结合现有代码架构整理。

---

## Week 1：探索阶段 + 基础设施

### 1. 数据库（Supabase）

| # | 任务 | 状态 |
|---|------|------|
| 1.1 | 建 `user_preferences` 表 + RLS | ☐ |
| 1.2 | 建 `career_directions` 表 + RLS | ☐ |
| 1.3 | 建 `career_plans` 表 + RLS | ☐ |
| 1.4 | 建 `plan_tasks` 表 + RLS | ☐ |
| 1.5 | 建 `jobs` 表 + RLS + 索引（Week 2 用，先建表） | ☐ |
| 1.6 | 建 `job_matches` 表 + RLS（Week 2 用，先建表） | ☐ |

### 2. 后端 API

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 2.1 | `proxy.ts` 新增 `career_explore` action type + 配额 | `api/gemini/proxy.ts` | ☐ |
| 2.2 | 新建 `/api/explore/directions` — AI 方向推荐 | 新建 `api/explore/directions.ts` | ☐ |
| 2.3 | 新建 `/api/career/plan` — 生成求职计划 | 新建 `api/career/plan.ts` | ☐ |
| 2.4 | 新建 `/api/preferences` — 用户偏好 CRUD | 新建 `api/preferences.ts` | ☐ |
| 2.5 | `vercel.json` 加路由 | `vercel.json` | ☐ |

### 3. 类型定义

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 3.1 | 新增求职助手类型（DirectionRecommendation, CareerPlan, Phase, PlanTask, Resource, UserPreferences） | `types.ts` | ☐ |
| 3.2 | Step 类型扩展：新增 `EXPLORE \| PREPARE \| APPLY` | `App.tsx` (line 23) | ☐ |

### 4. 前端 — 导航改造

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 4.1 | 主导航新增 [探索] [准备] [投递] Tab，保留现有入口 | `App.tsx` (lines 1372-1397) | ☐ |
| 4.2 | Step 路由逻辑：新增 EXPLORE / PREPARE / APPLY 条件渲染 | `App.tsx` | ☐ |

### 5. 前端 — 探索页面

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 5.1 | 偏好收集组件（核心诉求多选+排序、薪资区间、行业/城市意愿、可选上传简历） | 新建 `components/ExplorePreferences.tsx` | ☐ |
| 5.2 | 方向推荐卡片组件（匹配度、✅❌💡、市场信息、操作按钮） | 新建 `components/DirectionCard.tsx` | ☐ |
| 5.3 | 探索主页面（组合偏好→推荐→选方向→时间规划→生成计划） | 新建 `components/ExplorePage.tsx` | ☐ |
| 5.4 | 时间规划选择 UI（AI 建议 vs 用户设定期限+日期选择器） | 集成在 `ExplorePage.tsx` | ☐ |

### 6. 前端 — 求职计划

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 6.1 | 计划展示组件（按周分组、进度条、阶段标签） | 新建 `components/CareerPlan.tsx` | ☐ |
| 6.2 | 打卡功能（checkbox → PATCH plan_tasks） | 集成在 `CareerPlan.tsx` | ☐ |
| 6.3 | 完成标准 + 学习资源展示 | 集成在 `CareerPlan.tsx` | ☐ |

### 7. Gemini Prompt

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 7.1 | 方向推荐 Prompt（偏好+简历 → 3-5 个方向结构化 JSON） | 新建 `services/careerService.ts` | ☐ |
| 7.2 | 求职计划 Prompt（方向+gap+时间 → 按周任务 JSON） | `services/careerService.ts` | ☐ |

---

## Week 2：准备阶段 + 插件

### 8. 后端 API（岗位相关）

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 8.1 | 新建 `/api/jobs/sync` — 岗位同步 + 去重 | 新建 `api/jobs/sync.ts` | ☐ |
| 8.2 | 新建 `/api/jobs/list` — 岗位列表 + 筛选排序 | 新建 `api/jobs/list.ts` | ☐ |
| 8.3 | 新建 `/api/jobs/match` — AI 批量匹配 | 新建 `api/jobs/match.ts` | ☐ |
| 8.4 | 新建 `/api/jobs/status` — 状态更新 | 新建 `api/jobs/status.ts` | ☐ |
| 8.5 | `vercel.json` 加路由 | `vercel.json` | ☐ |
| 8.6 | CORS 白名单加插件 origin | `api/gemini/proxy.ts` | ☐ |

### 9. Chrome 插件

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 9.1 | 插件项目初始化（Manifest V3 + Vite + React） | 新建 `offerin-extension/` | ☐ |
| 9.2 | Background Service Worker | `offerin-extension/src/background/` | ☐ |
| 9.3 | 登录互通（offerin.co → chrome.storage） | `offerin-extension/src/shared/auth.ts` | ☐ |
| 9.4 | Boss 直聘 Parser（DOM → RawJobData） | `offerin-extension/src/content/parsers/bossParser.ts` | ☐ |
| 9.5 | 一键抓取 + 上传 | `offerin-extension/src/content/boss.ts` | ☐ |
| 9.6 | Popup 弹窗 | `offerin-extension/src/popup/Popup.tsx` | ☐ |

### 10. 前端 — 准备页面

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 10.1 | 岗位雷达页面（方向标签+列表+筛选+统计） | 新建 `components/PreparePage.tsx` | ☐ |
| 10.2 | 岗位卡片组件 | 新建 `components/JobCard.tsx` | ☐ |
| 10.3 | 岗位详情展开（✅❌💡+操作按钮） | 新建 `components/JobDetail.tsx` | ☐ |
| 10.4 | 手动粘贴 JD 入口 | 集成在 `PreparePage.tsx` | ☐ |
| 10.5 | AI 匹配分析触发 + 结果展示 | 集成在 `JobDetail.tsx` | ☐ |

### 11. 串联现有功能

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 11.1 | "改简历"自动带入 JD（JobDetail → UPLOAD） | `App.tsx` | ☐ |
| 11.2 | "练面试"自动带入 JD（JobDetail → INTERVIEW） | `App.tsx` + `InterviewChat.tsx` | ☐ |
| 11.3 | 计划回顾与调整 | `CareerPlan.tsx` + `api/career/plan.ts` | ☐ |

### 12. Gemini Prompt

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 12.1 | 岗位匹配 Prompt（三维匹配度+✅❌💡+市场信息） | `services/careerService.ts` | ☐ |
| 12.2 | 计划回顾调整 Prompt | `services/careerService.ts` | ☐ |

---

## Week 3：投递阶段 + 权限 + 上线

### 13. 前端 — 投递页面

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 13.1 | 投递看板页面（分状态列+统计栏） | 新建 `components/ApplyPage.tsx` | ☐ |
| 13.2 | 状态流转 UI | 集成在 `ApplyPage.tsx` | ☐ |
| 13.3 | 按天视图（日历/时间线） | 集成在 `ApplyPage.tsx` | ☐ |
| 13.4 | AI 进展总结 | 新建 `components/ProgressSummary.tsx` | ☐ |

### 14. 权限与用量

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 14.1 | `checkAndLogUsage` 新增 career_explore 分支 | `api/gemini/proxy.ts` | ☐ |
| 14.2 | 前端超限处理（弹 VIPUpgradeModal） | 各调用处 | ☐ |
| 14.3 | 前端用量显示（剩余次数） | 各页面组件 | ☐ |

### 15. 联调与打磨

| # | 任务 | 涉及文件 | 状态 |
|---|------|----------|------|
| 15.1 | 三阶段全流程联调 | 全局 | ☐ |
| 15.2 | 空状态设计 | 各页面组件 | ☐ |
| 15.3 | 加载态/错误态 | 各页面组件 | ☐ |
| 15.4 | 响应式/移动端适配 | 各页面组件 | ☐ |
| 15.5 | Bug 修复 | 全局 | ☐ |
| 15.6 | 部署上线 + 插件提审 | 全局 | ☐ |

---

## 新建文件清单

| 文件 | 类型 |
|------|------|
| `api/explore/directions.ts` | Vercel API |
| `api/career/plan.ts` | Vercel API |
| `api/preferences.ts` | Vercel API |
| `api/jobs/sync.ts` | Vercel API |
| `api/jobs/list.ts` | Vercel API |
| `api/jobs/match.ts` | Vercel API |
| `api/jobs/status.ts` | Vercel API |
| `services/careerService.ts` | 前端 Service |
| `components/ExplorePage.tsx` | 前端组件 |
| `components/ExplorePreferences.tsx` | 前端组件 |
| `components/DirectionCard.tsx` | 前端组件 |
| `components/CareerPlan.tsx` | 前端组件 |
| `components/PreparePage.tsx` | 前端组件 |
| `components/JobCard.tsx` | 前端组件 |
| `components/JobDetail.tsx` | 前端组件 |
| `components/ApplyPage.tsx` | 前端组件 |
| `components/ProgressSummary.tsx` | 前端组件 |
| `offerin-extension/` | Chrome 插件项目 |

## 需修改的现有文件

| 文件 | 改动 |
|------|------|
| `types.ts` | 新增求职助手相关类型 |
| `App.tsx` | Step 类型扩展 + 导航新增 Tab + 路由 + 状态传递 |
| `api/gemini/proxy.ts` | ALLOWED_ACTION_TYPES + MEMBERSHIP_LIMITS + CORS + checkAndLogUsage |
| `vercel.json` | 新增 API 路由 |
