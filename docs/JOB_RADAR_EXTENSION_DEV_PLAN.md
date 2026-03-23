# 岗位雷达 — 浏览器插件 + 网页端集成 功能开发方案

> 目标：通过 Chrome 浏览器插件从 Boss 直聘 / 猎聘等招聘平台获取真实 JD 数据，上传至 Offerin 后端，结合用户简历进行 AI 匹配分析，在 Offerin 网页端展示岗位推荐、匹配度、求职计划与投递追踪。

---

## 一、整体架构

```
┌─ 用户浏览器 ──────────────────────────────────────────────────┐
│                                                                │
│  Boss 直聘 / 猎聘 网页                                        │
│       │                                                        │
│       ▼                                                        │
│  Offerin Chrome 插件（Content Script + Popup）                │
│  · 读取当前页面的岗位列表 / JD 详情                            │
│  · 一键抓取当前搜索结果                                        │
│  · 定时自动刷新搜索页                                          │
│  · Popup 中展示快捷匹配摘要                                    │
│                                                                │
└────────────────── HTTPS 加密传输 ──────────────────────────────┘
                         │
                         ▼
┌─ Offerin 后端（Vercel Serverless）─────────────────────────────┐
│                                                                │
│  新增 API Endpoints:                                           │
│  · POST /api/jobs/sync         ← 接收插件上传的岗位数据        │
│  · GET  /api/jobs/list         ← 获取用户的岗位列表            │
│  · POST /api/jobs/match        ← 触发 AI 匹配分析             │
│  · PATCH /api/jobs/:id/status  ← 更新投递状态                  │
│  · POST /api/career/plan       ← 生成求职计划                  │
│                                                                │
│  复用:                                                          │
│  · Supabase Auth（JWT 鉴权）                                   │
│  · Gemini Proxy（AI 调用 + 用量计次）                          │
│  · Upstash Redis（Rate Limiting）                               │
│                                                                │
│  存储: Supabase                                                 │
│  · jobs 表（岗位数据）                                          │
│  · job_matches 表（匹配结果）                                   │
│  · career_plans 表（求职计划 + 打卡进度）                       │
│  · user_preferences 表（换工作需求偏好）                        │
│                                                                │
└────────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─ Offerin 前端（现有 Vite + React 应用）────────────────────────┐
│                                                                │
│  新增 Step:                                                     │
│  · JOB_RADAR        — 岗位雷达主页面                           │
│  · JOB_DETAIL       — 岗位详情 + 匹配分析                      │
│  · CAREER_PLAN      — 求职计划 + 打卡 + 回顾                   │
│  · USER_PREFERENCES — 换工作需求设置                            │
│                                                                │
│  展示:                                                          │
│  · AI 推荐岗位列表（附原始链接）                               │
│  · 匹配度分数 + 匹配分析（✅❌💡）                              │
│  · 标记 "已投递" / "忽略" / "收藏"                              │
│  · 投递进展跟踪看板                                             │
│  · 每日/每周数据统计                                            │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 二、Chrome 浏览器插件

### 2.1 技术选型

| 项目 | 选择 | 说明 |
|------|------|------|
| Manifest | **V3** | Chrome 正在淘汰 V2，V3 是唯一选项 |
| 框架 | **Vite + React + TypeScript** | 与主项目栈一致，Popup 和 Options 页用 React |
| 打包 | **CRXJS Vite Plugin** 或 **Plasmo** | 支持 HMR 开发体验好 |
| 样式 | **Tailwind CSS** | 与主项目一致 |

### 2.2 插件结构

```
offerin-extension/
├── manifest.json
├── src/
│   ├── background/
│   │   └── index.ts            # Service Worker：消息路由、定时任务、Auth 管理
│   ├── content/
│   │   ├── boss.ts             # Boss 直聘页面注入脚本
│   │   ├── liepin.ts           # 猎聘页面注入脚本
│   │   └── parsers/
│   │       ├── bossParser.ts   # Boss 页面 DOM → 结构化岗位数据
│   │       └── liepinParser.ts # 猎聘页面 DOM → 结构化岗位数据
│   ├── popup/
│   │   └── Popup.tsx           # 弹窗主界面（登录状态、快捷操作、最近匹配）
│   ├── options/
│   │   └── Options.tsx         # 设置页（抓取频率、自动同步开关等）
│   ├── shared/
│   │   ├── api.ts              # 与 Offerin 后端通信（fetch + JWT）
│   │   ├── auth.ts             # Supabase Auth（复用 session）
│   │   ├── storage.ts          # chrome.storage 封装
│   │   └── types.ts            # 共享类型定义
│   └── utils/
│       └── dedup.ts            # 岗位去重（基于公司+岗位名+发布日期 hash）
├── public/
│   └── icons/                  # 插件图标
├── tailwind.config.js
├── vite.config.ts
└── package.json
```

### 2.3 Content Script — 页面数据采集

#### 支持平台与采集范围

| 平台 | 采集页面 | 采集字段 |
|------|----------|----------|
| **Boss 直聘** | 搜索结果页、岗位详情页 | 岗位名、公司名、薪资范围、城市、经验要求、学历要求、JD 正文、公司规模、行业标签、发布时间、原始链接 |
| **猎聘** | 搜索结果页、岗位详情页 | 同上 |
| **后续扩展** | 拉勾、智联、脉脉 | 同上 |

#### 采集模式

| 模式 | 说明 |
|------|------|
| **手动一键抓取** | 用户在搜索结果页点击插件图标或页面内悬浮按钮，一次性抓取当前页全部岗位 |
| **自动监听** | Content Script 监听搜索结果页 DOM 变化（翻页、加载更多），自动采集新增岗位 |
| **详情补全** | 列表页信息不完整时，后台逐个请求详情页，补全 JD 全文（需控制频率，避免触发反爬） |

#### 数据结构（Content Script → Background → API）

```typescript
interface RawJobData {
  source: 'boss' | 'liepin' | 'lagou';
  sourceJobId: string;           // 平台侧唯一 ID（用于去重）
  sourceUrl: string;             // 原始链接
  title: string;                 // 岗位名称
  company: string;               // 公司名称
  companySize?: string;          // 公司规模
  industry?: string;             // 行业
  salaryRange: string;           // 薪资范围（原始文本，如 "25-40K·15薪"）
  salaryMin?: number;            // 解析后的最低月薪（K）
  salaryMax?: number;            // 解析后的最高月薪（K）
  city: string;                  // 城市
  experience?: string;           // 经验要求
  education?: string;            // 学历要求
  description: string;           // JD 正文
  tags?: string[];               // 技能标签
  publishedAt?: string;          // 发布时间
  scrapedAt: string;             // 采集时间
}
```

### 2.4 Popup 弹窗

| 状态 | 展示内容 |
|------|----------|
| **未登录** | 登录引导（跳转 Offerin 网页登录，通过 `chrome.storage` 同步 session） |
| **已登录 + 非招聘页** | 显示最近采集统计、待查看匹配数、跳转岗位雷达页面入口 |
| **已登录 + 招聘搜索页** | "一键抓取本页 N 个岗位" 按钮 + 自动采集开关 + 上次同步时间 |
| **已登录 + 招聘详情页** | 当前岗位的快捷匹配摘要（匹配度分数 + ✅❌ 关键点），支持一键收藏/忽略 |

### 2.5 插件权限（最小化）

```json
{
  "permissions": [
    "storage",
    "activeTab",
    "alarms"
  ],
  "host_permissions": [
    "https://www.zhipin.com/*",
    "https://www.liepin.com/*",
    "https://offerin.co/*"
  ]
}
```

| 权限 | 用途 | 说明 |
|------|------|------|
| `storage` | 存储 session、用户配置、采集缓存 | 必需 |
| `activeTab` | 仅在用户主动点击时读取当前 tab | 比 `tabs` 更安全 |
| `alarms` | 定时提醒（如"今天有 5 个新推荐岗位"） | 可选 |
| `host_permissions` | 限定只在 zhipin/liepin/offerin 域名生效 | 不申请 `<all_urls>` |

---

## 三、插件 ↔ 网页端 登录互通

### 3.1 方案：共享 Supabase Session

插件和网页端使用同一个 Supabase 项目，通过以下方式实现登录互通：

| 步骤 | 说明 |
|------|------|
| 1. 网页端登录 | 用户在 offerin.co 通过 OTP 登录，Supabase 将 session 存入 localStorage |
| 2. 插件获取 session | Content Script 在 `offerin.co` 域下读取 localStorage 中的 Supabase session，通过 `chrome.runtime.sendMessage` 传给 Background |
| 3. Background 缓存 | Background Service Worker 将 session 存入 `chrome.storage.local`，后续 API 请求直接使用 |
| 4. Token 刷新 | Background 定期检查 token 过期，调用 Supabase `refreshSession()` 更新；过期后引导重新登录 |

### 3.2 安全措施

- 插件只在 `offerin.co` 域下读取 session，不在第三方域操作登录凭证
- `chrome.storage.local` 数据仅插件自身可访问
- 所有 API 请求走 HTTPS + JWT Authorization header
- 后端 CORS 白名单新增 Chrome 插件 origin（`chrome-extension://<id>`）

---

## 四、后端 API 扩展

### 4.1 新增 Endpoints

在现有 Vercel Serverless 架构上新增以下 API：

#### `POST /api/jobs/sync` — 岗位数据同步

```typescript
// 接收插件上传的岗位数据，存入 Supabase
// 鉴权：JWT（复用现有 authenticateUser）
// 去重：基于 user_id + source + sourceJobId 做 upsert
// 限流：单次最多 50 条

interface SyncRequest {
  jobs: RawJobData[];
}
interface SyncResponse {
  synced: number;     // 成功入库数
  duplicated: number; // 跳过的重复数
  total: number;      // 用户岗位总数
}
```

#### `GET /api/jobs/list` — 获取岗位列表

```typescript
// 分页获取用户的岗位列表（支持筛选、排序）
// Query: ?status=new|saved|applied|ignored&sort=match|date&page=1&limit=20

interface JobListItem {
  id: string;
  title: string;
  company: string;
  salaryRange: string;
  city: string;
  source: string;
  sourceUrl: string;
  status: 'new' | 'saved' | 'applied' | 'ignored';
  matchScore?: number;        // 综合匹配度
  skillScore?: number;
  experienceScore?: number;
  projectScore?: number;
  scrapedAt: string;
  matchedAt?: string;
}
```

#### `POST /api/jobs/match` — 触发 AI 匹配分析

```typescript
// 对指定岗位（或批量 new 岗位）进行 AI 匹配
// 复用 Gemini Proxy 逻辑，actionType = 'career_explore'
// 输入：用户最新简历 + 用户偏好 + JD
// 输出：三维匹配度 + ✅❌💡 + 市场平均薪资 + 典型职业路径

interface MatchRequest {
  jobIds: string[];            // 要匹配的岗位 ID 列表（最多 10 个）
}
interface MatchResult {
  jobId: string;
  overallScore: number;        // 综合匹配度 0-100
  skillScore: number;
  experienceScore: number;
  projectScore: number;
  strengths: string[];         // ✅ 已具备
  gaps: string[];              // ❌ 缺少
  focusPoints: string[];       // 💡 准备重点
  marketSalary: string;        // 市场平均薪资
  careerPath: string;          // 典型职业路径
}
```

#### `PATCH /api/jobs/:id/status` — 更新岗位状态

```typescript
// 标记岗位为 已投递 / 收藏 / 忽略
// Body: { status: 'saved' | 'applied' | 'ignored', note?: string }
```

#### `POST /api/career/plan` — 生成求职计划

```typescript
// 基于匹配分析结果 + 用户偏好，生成按周拆解的求职计划
// 复用 Gemini Proxy，actionType = 'career_explore'
// 流式返回

interface PlanRequest {
  jobId: string;               // 目标岗位
  existingPlanId?: string;     // 若有，表示「回顾调整」
}
```

### 4.2 Gemini Proxy 扩展

在现有 `proxy.ts` 中增加：

| 变更 | 说明 |
|------|------|
| `ALLOWED_ACTION_TYPES` 新增 `'career_explore'` | 职业探索相关的 AI 调用 |
| `MEMBERSHIP_LIMITS` 新增 `career_explore` 配额 | 免费 3 次，VIP 不限 |
| CORS 白名单新增插件 origin | `chrome-extension://<extension-id>` |
| `checkAndLogUsage` 新增 `career_explore` 分支 | 免费用户合计 3 次后触发 VIP 引导 |

### 4.3 用量计次规则

| 操作 | 是否消耗次数 | 说明 |
|------|-------------|------|
| 岗位同步（sync） | 否 | 纯数据存储，不调 AI |
| 岗位列表/筛选/排序 | 否 | 纯数据库查询 |
| AI 匹配分析（match） | **是（1 次/批）** | 每批最多 10 个岗位算 1 次 |
| 点击展开 ✅❌💡 | 否 | 匹配时已生成，前端直接展示 |
| 求职计划生成 | **是（1 次）** | 首次生成 |
| 求职计划回顾调整 | **是（1 次）** | AI 重新规划 |
| 针对性简历生成 | **是（1 次）** | 复用 rewrite 逻辑 |
| 更新投递状态/打卡 | 否 | 纯数据库操作 |

---

## 五、Supabase 数据库设计

### 5.1 新增表

#### `user_preferences` — 用户换工作需求

```sql
CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  core_needs TEXT[],                -- ['salary', 'growth', 'wlb', 'stability']
  core_needs_priority TEXT[],       -- 按优先级排序
  salary_min INTEGER,               -- 可接受最低月薪（K）
  salary_max INTEGER,               -- 可接受最高月薪（K）
  open_to_industry_change TEXT DEFAULT 'maybe', -- 'yes' | 'no' | 'maybe'
  open_to_city_change TEXT DEFAULT 'maybe',
  target_cities TEXT[],             -- 目标城市列表
  target_industries TEXT[],         -- 目标行业列表
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);
```

#### `jobs` — 岗位数据

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source TEXT NOT NULL,             -- 'boss' | 'liepin'
  source_job_id TEXT NOT NULL,      -- 平台侧唯一 ID
  source_url TEXT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  company_size TEXT,
  industry TEXT,
  salary_range TEXT,
  salary_min INTEGER,
  salary_max INTEGER,
  city TEXT,
  experience TEXT,
  education TEXT,
  description TEXT,                 -- JD 正文
  tags TEXT[],
  published_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'new',        -- 'new' | 'saved' | 'applied' | 'ignored'
  user_note TEXT,                   -- 用户备注
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, source, source_job_id)
);

CREATE INDEX idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX idx_jobs_user_created ON jobs(user_id, created_at DESC);
```

#### `job_matches` — AI 匹配结果

```sql
CREATE TABLE job_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  overall_score INTEGER,            -- 0-100
  skill_score INTEGER,
  experience_score INTEGER,
  project_score INTEGER,
  strengths JSONB,                  -- ["具备 React 开发经验", ...]
  gaps JSONB,                       -- ["缺少 K8s 运维经验", ...]
  focus_points JSONB,               -- ["建议先学习...", ...]
  market_salary TEXT,               -- "25-40K"
  career_path TEXT,                 -- "初级 → 中级 → 高级 → 架构师"
  raw_analysis TEXT,                -- AI 原始输出（留档）
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, job_id)
);

CREATE INDEX idx_matches_user ON job_matches(user_id);
CREATE INDEX idx_matches_score ON job_matches(user_id, overall_score DESC);
```

#### `career_plans` — 求职计划

```sql
CREATE TABLE career_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  title TEXT NOT NULL,              -- "前端工程师求职计划"
  total_weeks INTEGER,              -- 计划总周数
  plan_data JSONB NOT NULL,         -- 结构化计划（见下方 JSON 结构）
  status TEXT DEFAULT 'active',     -- 'active' | 'completed' | 'archived'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_plans_user ON career_plans(user_id, status);
```

#### `plan_tasks` — 计划任务（可打卡）

```sql
CREATE TABLE plan_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES career_plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,     -- 第几周
  phase TEXT,                       -- '准备期' | '冲刺期' | '投递期'
  title TEXT NOT NULL,              -- 任务标题
  description TEXT,                 -- 任务详情
  completion_criteria TEXT,         -- 完成标准
  priority TEXT DEFAULT 'medium',   -- 'high' | 'medium' | 'low'
  resources JSONB,                  -- [{ name, url, type }] 学习资源
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tasks_plan ON plan_tasks(plan_id, week_number);
CREATE INDEX idx_tasks_user ON plan_tasks(user_id, is_completed);
```

### 5.2 RLS（行级安全）

所有新表启用 RLS，策略一致：用户只能访问自己的数据。

```sql
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_own_jobs" ON jobs
  FOR ALL USING (auth.uid() = user_id);

-- user_preferences, job_matches, career_plans, plan_tasks 同理
```

---

## 六、前端集成（Offerin 网页端）

### 6.1 新增 Step

在现有 `App.tsx` 的 step 系统中新增：

| Step | 说明 | 入口 |
|------|------|------|
| `USER_PREFERENCES` | 换工作需求设置（核心诉求、薪资、行业/城市） | 首次进入岗位雷达时引导，或设置入口 |
| `JOB_RADAR` | 岗位雷达主页面 | 主导航新增 Tab |
| `JOB_DETAIL` | 岗位详情 + 匹配分析（✅❌💡） | 从雷达列表点击岗位进入 |
| `CAREER_PLAN` | 求职计划（按周任务 + 打卡 + 回顾） | 从 JOB_DETAIL 的"生成求职计划"进入 |

### 6.2 岗位雷达页面（JOB_RADAR）

#### 页面结构

```
┌──────────────────────────────────────────────────────┐
│  📡 岗位雷达                        [换工作需求设置]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  统计栏：                                            │
│  [今日新增 12] [待查看 28] [已收藏 5] [已投递 3]     │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  筛选 & 排序：                                       │
│  [全部 | 新增 | 收藏 | 已投递 | 忽略]               │
│  排序：[匹配度 ▼] [时间 ▼] [薪资 ▼]                 │
│                                                      │
├──────────────────────────────────────────────────────┤
│                                                      │
│  岗位卡片列表：                                      │
│  ┌────────────────────────────────────────────┐      │
│  │ 前端工程师        字节跳动    30-50K·15薪   │      │
│  │ 北京 · 3-5年 · 本科                         │      │
│  │                                              │      │
│  │ 匹配度：85分                                 │      │
│  │ [技能 90] [经验 82] [项目 83]                │      │
│  │ 市场均薪：25-45K  路径：初级→高级→架构师     │      │
│  │                                              │      │
│  │ [收藏] [忽略] [查看详情→]                    │      │
│  └────────────────────────────────────────────┘      │
│  ┌────────────────────────────────────────────┐      │
│  │ ...更多岗位卡片                              │      │
│  └────────────────────────────────────────────┘      │
│                                                      │
├──────────────────────────────────────────────────────┤
│  未安装插件？→ [下载 Chrome 插件]                     │
│  暂无岗位？  → [手动粘贴 JD] 也可使用                 │
└──────────────────────────────────────────────────────┘
```

#### 无插件降级方案

未安装插件的用户仍可使用：
- 手动粘贴 JD 文本 → 与现有"职业探索"流程一致
- 引导下载插件获得更好体验

### 6.3 岗位详情页（JOB_DETAIL）

点击岗位卡片后展开（或跳转）：

```
┌──────────────────────────────────────────────────────┐
│  ← 返回                                              │
│                                                      │
│  前端工程师 — 字节跳动                               │
│  30-50K·15薪 | 北京 | 3-5年 | 本科                   │
│  [查看原始 JD ↗]                                     │
│                                                      │
├── 匹配分析 ──────────────────────────────────────────┤
│                                                      │
│  综合匹配度：85/100                                   │
│  [技能 90/100] [经验 82/100] [项目 83/100]           │
│                                                      │
│  ✅ 你已具备的能力                                    │
│  · React / TypeScript 3 年+                           │
│  · 性能优化、组件化架构经验                            │
│                                                      │
│  ❌ 你缺少的关键技能/经验                             │
│  · 大规模 Node.js 服务端经验                           │
│  · 跨端开发（React Native / Flutter）                 │
│                                                      │
│  💡 接下来的准备重点                                  │
│  · 建议补充 Node.js 项目实践                           │
│  · 准备系统设计类面试题                                │
│                                                      │
├── 岗位市场信息 ──────────────────────────────────────┤
│                                                      │
│  市场平均薪资：25-45K（一线城市）                      │
│  典型职业路径：初级前端 → 高级前端 → 前端架构师 →      │
│               技术总监 / 转产品技术负责人               │
│                                                      │
├── 操作 ──────────────────────────────────────────────┤
│                                                      │
│  [生成求职计划]  [生成针对性简历]  [标记已投递]        │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 6.4 求职计划页（CAREER_PLAN）

#### 数据结构

AI 生成的计划按以下 JSON 结构存储：

```typescript
interface CareerPlan {
  id: string;
  title: string;
  totalWeeks: number;
  phases: Phase[];
}

interface Phase {
  name: string;           // "准备期" | "冲刺期" | "投递期"
  weekStart: number;      // 起始周
  weekEnd: number;        // 结束周
}

interface PlanTask {
  id: string;
  weekNumber: number;
  phase: string;
  title: string;
  description: string;
  completionCriteria: string;   // 明确的完成标准
  priority: 'high' | 'medium' | 'low';
  resources: Resource[];
  isCompleted: boolean;
  completedAt?: string;
}

interface Resource {
  name: string;          // "React 官方文档"
  url: string;           // "https://react.dev"
  type: 'course' | 'book' | 'article' | 'video' | 'repo' | 'doc';
}
```

#### 页面交互

```
┌──────────────────────────────────────────────────────┐
│  📋 求职计划：前端工程师 — 字节跳动                    │
│  进度：12/28 任务完成（43%）     [回顾与调整]          │
│                                                      │
│  ████████████░░░░░░░░░░░░░░ 43%                      │
│                                                      │
├── 准备期（第 1-4 周）────────────────────────────────┤
│                                                      │
│  第 1 周                                              │
│  ☑ 完成 Node.js 官方教程 Getting Started               │
│    完成标准：跑通官方 3 个 demo + 写 1 篇笔记          │
│    📚 Node.js 官方文档 ↗                              │
│    ✓ 已完成 (3/7)                                     │
│                                                      │
│  ☐ 整理过往项目的 STAR 讲述稿（至少 3 个项目）         │
│    完成标准：每个项目 300 字以内，覆盖技术难点和量化成果 │
│                                                      │
│  第 2 周                                              │
│  ☐ 完成系统设计入门课程前 5 章                         │
│    完成标准：完成课后练习 + 输出 1 张架构图             │
│    📚 极客时间《系统设计面试》 ↗                      │
│    📺 B 站系统设计合集 ↗                              │
│  ...                                                  │
│                                                      │
├── 冲刺期（第 5-8 周）────────────────────────────────┤
│  ...                                                  │
├── 投递期（第 9-12 周）───────────────────────────────┤
│  ...                                                  │
└──────────────────────────────────────────────────────┘
```

#### "回顾与调整"功能

| 操作 | 说明 |
|------|------|
| 点击"回顾与调整" | 展示当前进度摘要：已完成 N 项 / 未完成 N 项 / 逾期 N 项 |
| AI 重新规划 | 将已完成任务 + 未完成任务 + 原始目标传给 Gemini，重新生成剩余计划 |
| 保留已完成 | 已打卡完成的任务不会被删除或修改 |
| 消耗 1 次用量 | 每次"调整"算 1 次 career_explore 调用 |

---

## 七、插件与网页端通信机制

### 7.1 数据流

```
插件 Content Script
    ↓ chrome.runtime.sendMessage
插件 Background (Service Worker)
    ↓ fetch + JWT
Offerin 后端 /api/jobs/sync
    ↓ INSERT to Supabase
Offerin 前端（轮询或 Supabase Realtime）
    ↓ 展示新岗位提示
用户在前端查看、触发 AI 匹配
```

### 7.2 实时同步

| 方案 | 说明 | 推荐 |
|------|------|------|
| **Supabase Realtime** | 前端订阅 `jobs` 表的 INSERT 事件，插件同步后前端即时收到 | 推荐（已有 Supabase） |
| **轮询** | 前端每 30s 请求 /api/jobs/list?since=lastSync | 备选 |

---

## 八、用量与权限

### 复用现有体系

| 用户类型 | 岗位同步 | AI 匹配 | 求职计划 | 针对性简历 |
|----------|----------|---------|----------|-----------|
| **免费** | 不限 | 合计 3 次 | 合计 3 次内 | 合计 3 次内 |
| **VIP** | 不限 | 不限 | 不限 | 不限 |

说明：
- 岗位数据同步（插件→后端）不消耗 AI 用量
- AI 匹配、求职计划、针对性简历共享 `career_explore` 配额
- 免费用户合计 3 次后弹 VIP 引导
- 与现有诊断/面试配额独立

---

## 九、安全与合规

| 维度 | 措施 |
|------|------|
| **数据传输** | 全程 HTTPS，JWT 鉴权 |
| **数据存储** | Supabase RLS 行级隔离，用户只能访问自己的数据 |
| **插件权限** | 最小权限原则，仅 `activeTab` + 限定 host_permissions |
| **招聘平台 ToS** | 插件在用户浏览器本地运行，采集用户自己浏览的页面内容；需在隐私政策中明确说明数据用途；控制采集频率避免触发反爬 |
| **用户隐私** | 明确告知用户：采集了哪些数据、存储在哪里、用于什么目的；用户可随时删除自己的岗位数据 |
| **Chrome Web Store** | V3 Manifest 满足上架要求；需提供隐私政策 URL；审核周期约 1-3 周 |

---

## 十、功能模块清单（开发顺序）

| 模块 | 功能点 | 依赖 | 预计 |
|------|--------|------|------|
| **1. DB & API 基础** | 建表 + RLS + 4 个 API endpoint（sync/list/status/match） | 无 | 2 天 |
| **2. 插件骨架** | Manifest V3 + Content Script（Boss 解析）+ Background + Popup | 无 | 3 天 |
| **3. 登录互通** | 插件 ↔ 网页端 Supabase Session 共享 | 模块 2 | 1 天 |
| **4. 岗位同步** | 插件一键抓取 + 自动采集 + 去重 + 上传 | 模块 1, 2, 3 | 2 天 |
| **5. 前端岗位雷达** | JOB_RADAR 页面 + 列表/筛选/排序 + 状态管理 | 模块 1 | 3 天 |
| **6. 用户需求引导** | USER_PREFERENCES 页面 + user_preferences 表 | 模块 1 | 1 天 |
| **7. AI 匹配分析** | match API + Gemini prompt + JOB_DETAIL 展示 + ✅❌💡 | 模块 4, 5, 6 | 3 天 |
| **8. 求职计划** | plan API + CAREER_PLAN 页面 + 按周任务 + 打卡 + 回顾调整 | 模块 7 | 4 天 |
| **9. 针对性简历** | 复用 rewriteResumeStream，从 JOB_DETAIL 入口触发 | 模块 7 | 1 天 |
| **10. 权限与用量** | career_explore 配额 + VIP 弹窗 + 免费引导 | 全局 | 1 天 |
| **11. 猎聘适配** | 新增 liepinParser + 测试 | 模块 4 | 2 天 |
| **12. 体验打磨** | 投递看板、统计图表、Realtime 实时通知、插件提醒 | 全部 | 3 天 |

---

## 十一、时间线

| 阶段 | 工作内容 | 预计耗时 |
|------|----------|----------|
| **Phase 1：基础设施** | DB 建表 + API 骨架 + 插件骨架 + 登录互通 + Boss 解析 | 约 1 周 |
| **Phase 2：核心功能** | 岗位同步 + 雷达页面 + 用户需求引导 + AI 匹配分析 | 约 1.5 周 |
| **Phase 3：计划与简历** | 求职计划（打卡/回顾）+ 针对性简历 + 权限用量 | 约 1 周 |
| **Phase 4：扩展与打磨** | 猎聘适配 + 投递看板 + 统计 + 实时通知 + 体验优化 | 约 1 周 |
| **Phase 5：上架与测试** | Chrome Web Store 提审 + E2E 测试 + Bug 修复 | 约 0.5 周 |
| **合计** | | **约 5 周** |

---

## 十二、风险与缓解

| 风险 | 缓解 |
|------|------|
| 招聘平台 DOM 频繁变动导致解析失败 | Parser 与业务逻辑解耦；监控解析成功率；失败时 fallback 到手动粘贴 |
| 反爬机制触发（频率限制、验证码） | 控制采集频率（单页仅采集一次，详情页间隔 ≥2s）；不做后台批量爬取 |
| Chrome Web Store 审核被拒 | 提前准备隐私政策；权限说明文档；确保 V3 合规 |
| 插件与网页端 Session 同步失败 | 提供手动登录入口（插件 Popup 内嵌 OTP 登录）作为 fallback |
| Supabase Realtime 延迟或断连 | 前端轮询作为降级方案（每 30s） |
| 免费 3 次是否合理 | 数据同步不计次；仅 AI 调用计次；可根据实际情况调整 |

---

## 十三、与现有"职业探索"计划的关系

| 原计划 | 本方案 | 关系 |
|--------|--------|------|
| 内置岗位库（10-20 个） | 插件抓取真实 JD | 互补：插件提供真实数据，内置岗位库作为无插件的降级方案 |
| 用户粘贴 JD | 插件自动采集 | 升级：插件是更便捷的数据获取方式 |
| 三维匹配度 | 三维匹配度 | 一致：复用同一套 Gemini prompt 和分析逻辑 |
| ✅❌💡 展开 | ✅❌💡 展开 | 一致 |
| 市场平均薪资 + 典型路径 | 市场平均薪资 + 典型路径 | 一致：AI 基于 JD + 公开数据生成 |
| 用户需求引导 | 用户需求引导 | 一致：前端 USER_PREFERENCES 页 |
| 求职计划（按周+打卡+回顾） | 求职计划（按周+打卡+回顾） | 一致：CAREER_PLAN 页 + plan_tasks 表 |
| 针对性简历 | 针对性简历 | 一致：复用 rewriteResumeStream |

**核心差异**：本方案新增了「浏览器插件」作为数据采集层和「投递追踪看板」作为求职管理层。原计划中的所有功能点均在本方案中得到保留和集成。
