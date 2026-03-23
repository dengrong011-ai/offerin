# 求职助手 — 完整功能开发方案

> 将 Offerin 从「工具集」升级为「求职流程管理产品」。
> 三个阶段：**探索 → 准备 → 投递**，串联现有简历诊断/重写/模拟面试功能，新增方向推荐、插件采集、计划管理和投递追踪。

---

## 一、产品主线：探索 → 准备 → 投递

### 用户旅程

```
[探索]                    [准备]                      [投递]
  │                         │                           │
  填写偏好                   插件搜索真实 JD              边投边练
  上传简历（可选）            针对 JD 改简历 ← 现有重写    一键跳转投递
  AI 推荐方向               针对 JD 练面试 ← 现有面试    追踪投递状态
  匹配分析 ✅❌💡            按周打卡学习                 按天回顾进展
  生成求职计划               定期回顾调整计划             AI 总结 + 策略调整
       │                         │                      │
       └─────────────────────────┘                      │
            准备期（可并行）                    投递期（持续 2-3 个月）
```

### 主导航结构

```
现有：[简历诊断]  [模拟面试]  [简历库]  [面试库]
                        ↓ 升级为
新版：[探索]  [准备]  [投递]  [简历库]  [面试库]
                                ↑ 保留独立入口
```

- 现有功能保留独立入口（老用户不受影响）
- 新增「探索 / 准备 / 投递」三个 Tab 作为主线
- 简历重写、模拟面试在「准备」阶段内作为快捷入口串联

---

## 二、阶段一：探索 — 寻找新方向 + 给出计划

> 解决"想换工作但不知道往哪走"，基于简历和偏好，AI 主动推荐方向。

### 2.1 用户偏好收集

作为探索入口的第一步（可跳过，提示"填写后推荐更精准"）：

| 填写项 | 形式 | 说明 |
|--------|------|------|
| 核心诉求 | 多选 + 拖拽排序 | 薪资 / 成长 / WLB / 稳定性 / 成就感 |
| 可接受薪资范围 | 区间滑块 | 如 20–35K |
| 是否愿意换行业 | 单选 | 是 / 否 / 视情况 |
| 是否愿意换城市 | 单选 | 是 / 否 / 视情况 |
| 目标城市（选填） | 多选 | 北京 / 上海 / 深圳 / 杭州 / 远程 等 |

### 2.2 AI 方向推荐

用户填写偏好（+ 可选上传简历）后，Gemini 输出 3-5 个方向推荐。上传简历可提高推荐精准度，但不是必须的——用户也可以仅通过偏好获得方向建议：

```typescript
interface DirectionRecommendation {
  directionName: string;           // "DevOps / SRE 工程师"
  matchScore: number;              // 综合匹配度 0-100
  skillScore: number;
  experienceScore: number;
  projectScore: number;
  strengths: string[];             // ✅ 已具备
  gaps: string[];                  // ❌ 缺少
  focusPoints: string[];           // 💡 准备重点
  marketSalary: string;            // "30-55K（一线）"
  salaryTrend: string;             // "+15% 同比"
  demandTrend: string;             // "需求增速 +25%"
  talentGap: string;               // "供需比 1:3"
  careerPath: string;              // "运维 → SRE → 架构负责人 → CTO"
  suggestedSearchKeywords: string[];  // 给准备阶段用
  suggestedFilters: {
    cities?: string[];
    salaryMin?: number;
    experience?: string;
  };
}
```

### 2.3 方向卡片 UI

```
┌────────────────────────────────────────────────┐
│  方向 #1：DevOps / SRE 工程师          78 分   │
│                                                │
│  市场均薪：30-55K  涨幅：+15%  缺口：供不应求   │
│  路径：运维 → SRE → 架构负责人 → CTO            │
│                                                │
│  ✅ Linux + CI/CD 经验扎实                      │
│  ❌ 缺少 K8s、Terraform                         │
│  💡 建议先补 Docker + K8s 基础                   │
│                                                │
│  ──────────────────────────────────────────    │
│  [我感兴趣 → 生成计划]    [不考虑]              │
└────────────────────────────────────────────────┘
```

### 2.4 选定方向后的即时产出

用户点击「我感兴趣 → 生成计划」：

| 产出 | 说明 |
|------|------|
| **求职计划** | 按周拆解，含准备期 + 投递期（见下方时间规划逻辑） |
| **推荐搜索词** | 传给准备阶段，插件/手动搜索时直接使用 |

注意：探索阶段**不生成简历**——此时用户还没有具体 JD，简历优化留到准备阶段针对真实 JD 时做更有价值。

此时用户已经可以开始行动（学习打卡），不需要等真实 JD。

### 2.5 求职计划的时间规划逻辑

#### 两种模式

| 模式 | 适用场景 | 说明 |
|------|----------|------|
| **AI 建议周期** | 用户不确定要多久 | AI 根据技能/经验 gap 大小自动估算总周期（上限 12 周 / 3 个月），gap 小则短、gap 大则长 |
| **用户设定期限** | 用户有明确离职时间点 | 用户输入"期望 N 月 N 日前拿到 offer"，系统倒推各阶段截止日 |

#### AI 建议周期的规则

- 总周期不超过 **12 周（3 个月）**，避免计划过长导致执行力下降
- AI 根据 ❌ 差距清单的数量和难度估算：
  - gap 小（1-2 项小技能）→ 4-6 周
  - gap 中（3-5 项或含中等学习曲线）→ 6-9 周
  - gap 大（跨领域、需系统学习）→ 9-12 周

#### 用户设定期限的倒推逻辑

用户输入目标日期后，系统倒推，预留 buffer：

```
目标日期（拿到 offer）
  ← 预留 2 周 buffer（谈薪 + 意外延迟）
  ← 投递期（约占总时间 60-70%）：边投递边练习，持续改进简历和面试
  ← 准备期（约占总时间 30-40%）：技能学习 + 项目整理 + 简历打磨 + 模拟面试
```

示例：用户设定"7 月 1 日前拿到 offer"，今天是 3 月 10 日，可用约 16 周：

| 阶段 | 时间 | 周数 | 内容 |
|------|------|------|------|
| 准备期 | 3/10 – 4/21 | 6 周 | 补技能 + 整理项目 + 打磨简历 + 练面试 |
| 投递期 | 4/21 – 6/16 | 8 周 | 边投边练，持续优化简历和面试表现 |
| Buffer | 6/16 – 7/1 | 2 周 | 谈薪 + 意外延迟 |

若可用时间不足 4 周，提示用户"时间较紧，建议优先投递 gap 最小的方向"。

#### 前端交互

```
生成计划前，询问：

  你希望多长时间内完成求职？

  ○ AI 帮我规划（建议 X 周，基于你的差距分析）
  ○ 我有明确期限 → [日期选择器]
     "我希望在 ____ 之前拿到 offer"
```

---

## 三、阶段二：准备 — 真实 JD + 改简历 + 练面试 + 学习

> 用户有了方向后，搜索真实岗位，针对性准备。与阶段一**并行进行**。

### 3.1 真实 JD 获取

| 方式 | 说明 |
|------|------|
| **Chrome 插件（主推）** | 在 Boss 直聘/猎聘搜索时自动采集 JD |
| **手动粘贴 JD** | 无插件降级方案，在前端粘贴 JD 文本 |
| **AI 推荐搜索词** | 探索阶段生成的关键词，引导用户去搜索 |

### 3.2 岗位雷达页

```
┌──────────────────────────────────────────────────────┐
│  准备                                                 │
│                                                      │
│  ┌ 我的方向 ─────────────────────────────────────┐   │
│  │ [DevOps/SRE · 78分]  [技术PM · 72分]  [+探索] │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  搜索词提示：SRE / DevOps工程师 / 运维开发            │
│                                                      │
│  ┌ 真实岗位 ──── 来自 Boss 直聘 ─────────────────┐   │
│  │ [SRE - 阿里云 - 40K]  匹配 85  [改简历] [收藏]│   │
│  │ [DevOps - 字节 - 35K]  匹配 79  [练面试] [收藏]│   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  还没有岗位？[安装插件] [手动粘贴 JD]                 │
│                                                      │
│  ┌ 求职计划 ── 第 3 周 / 共 12 周 ── 进度 25% ──┐   │
│  │ 本周：☑ 2/4 完成  [查看计划] [回顾与调整]     │   │
│  └───────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

### 3.3 针对真实 JD 的操作（串联现有功能）

点击岗位卡片展开详情后：

| 操作 | 说明 | 复用 |
|------|------|------|
| **改简历** | 针对该 JD 优化简历，JD 自动带入 | 现有 `rewriteResumeStream` |
| **练面试** | 针对该 JD 模拟面试，JD 自动带入 | 现有 INTERVIEW 模块 |
| **诊断简历** | 改完后再诊断一次看是否到位 | 现有诊断流程 |
| **查看匹配** | ✅❌💡 详细匹配分析 | 新功能 |
| **收藏/忽略** | 标记状态 | 新功能 |

关键：JD 从雷达自动带入，用户不需要重复粘贴。

### 3.4 求职计划 — 按周打卡

#### 计划结构

```typescript
interface CareerPlan {
  id: string;
  title: string;
  totalWeeks: number;
  planMode: 'ai_suggested' | 'user_deadline';  // 规划模式
  targetDate?: string;          // 用户设定的目标日期（拿到 offer）
  startDate: string;            // 计划开始日期
  phases: Phase[];
}

interface Phase {
  name: string;                 // '准备期' | '投递期' | 'Buffer'
  weekStart: number;
  weekEnd: number;
  startDate: string;
  endDate: string;
}

interface PlanTask {
  id: string;
  weekNumber: number;
  phase: string;
  title: string;
  description: string;
  completionCriteria: string;   // 明确的完成标准
  priority: 'high' | 'medium' | 'low';
  resources: Resource[];        // 学习资源
  isCompleted: boolean;
  completedAt?: string;
}
```

#### 计划演化

| 时机 | 变化 |
|------|------|
| 探索完成后首次生成 | AI 根据 gap 建议周期（或用户设定期限倒推），生成准备期 + 投递期 + buffer |
| 准备期内积累真实 JD | 准备任务中追加：针对具体 JD 的简历优化、面试重点 |
| 进入投递期 | 投递任务按天拆解：投哪几家、面试安排、复盘；同时继续保留练习任务 |
| 回顾与调整 | AI 根据已完成/未完成 + 投递反馈 + 剩余时间重新规划 |

#### 准备期和投递期的关系

两个阶段不是硬切割，而是重心渐变：

```
准备期                          投递期
├── 技能学习（多）               ├── 投递+面试（多）
├── 项目整理（多）               ├── 技能学习（少，查漏补缺）
├── 简历打磨（多）               ├── 简历微调（针对具体 JD）
├── 模拟面试（多）               ├── 真实面试 + 复盘（多）
└── 开始搜索岗位（少）           └── 持续搜索新岗位（多）
```

投递期不是纯投递，仍然可以学习和练习——2-3 个月边练边投是正常节奏，不要给用户制造紧迫压力。

#### 完成标准示例

| 任务 | 完成标准 |
|------|----------|
| 学习 Docker 基础 | 完成官方 Get Started 教程 + 本地跑通 3 个容器 |
| 整理 STAR 讲述稿 | 3 个核心项目各 300 字以内，覆盖难点和量化成果 |
| 系统设计练习 | 完成 2 道经典题（URL 短链、消息队列），画出架构图 |
| 针对 A 公司优化简历 | 基于 JD 调整关键词 + 突出匹配经历，诊断分 ≥ 80 |

---

## 四、阶段三：投递 — 追踪 + 按天回顾 + 策略调整

> 投递期节奏从「按周」逐步细化到「按天」，边投边练，持续改进。

### 4.1 投递看板

```
┌──────────────────────────────────────────────────────┐
│  投递                                                 │
│                                                      │
│  本周统计：投递 8 · 回复 3 · 约面 2 · 待跟进 1       │
│                                                      │
│  ┌ 投递中 ───────────────────────────────────────┐   │
│  │                                                │   │
│  │  阿里云 SRE    40K    3/5 投递  →  3/8 约面    │   │
│  │  [面试准备 checklist]  [查看匹配]               │   │
│  │                                                │   │
│  │  字节 DevOps   35K    3/6 投递  →  待回复      │   │
│  │                                                │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  ┌ 已完结 ───────────────────────────────────────┐   │
│  │  美团 SRE   拒绝（技术面）  [复盘记录]         │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  ┌ 新推荐岗位（插件采集）────────────────────────┐   │
│  │  [腾讯云 SRE - 45K]  匹配 88  [加入投递]      │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  [AI 进展总结]                                        │
└──────────────────────────────────────────────────────┘
```

### 4.2 投递状态流转

```
new → saved → applied → replied → interviewing → offer / rejected
                                       ↓
                                   [面试准备]  → 复用现有模拟面试
                                   [面后复盘]  → 记录真实问题
```

### 4.3 AI 进展总结

用户可随时触发「AI 进展总结」，AI 基于投递数据给出：

- 本周投递/回复/面试数据汇总
- 回复率分析（低于平均？建议调整简历重点）
- 面试反馈总结（多次挂在同一环节？建议补充对应技能）
- 是否需要扩大方向 / 调整策略

---

## 五、技术架构

### 5.1 整体架构

```
┌─ Chrome 插件 ─────────────────┐
│  Content Script（Boss/猎聘）   │
│  Background Service Worker    │
│  Popup（快捷操作）             │
└───────── HTTPS + JWT ─────────┘
                │
                ▼
┌─ Vercel Serverless ───────────┐
│  /api/explore/directions      │  ← AI 方向推荐
│  /api/jobs/sync               │  ← 岗位同步
│  /api/jobs/list               │  ← 岗位列表
│  /api/jobs/match              │  ← AI 匹配分析
│  /api/jobs/:id/status         │  ← 状态更新
│  /api/career/plan             │  ← 求职计划
│  /api/gemini/proxy            │  ← 现有 AI 代理
│                               │
│  复用：Supabase Auth + Redis  │
└───────────────────────────────┘
                │
                ▼
┌─ Supabase ────────────────────┐
│  user_preferences             │
│  career_directions            │
│  jobs                         │
│  job_matches                  │
│  career_plans + plan_tasks    │
│  （+ 现有 profiles/usage_logs）│
└───────────────────────────────┘
                │
                ▼
┌─ Offerin 前端（Vite + React）─┐
│  新增 Step：                   │
│  EXPLORE / PREPARE / APPLY    │
│  复用：EDITOR / INTERVIEW     │
└───────────────────────────────┘
```

### 5.2 数据库新增表

#### `user_preferences`

```sql
CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  core_needs TEXT[],
  core_needs_priority TEXT[],
  salary_min INTEGER,
  salary_max INTEGER,
  open_to_industry_change TEXT DEFAULT 'maybe',
  open_to_city_change TEXT DEFAULT 'maybe',
  target_cities TEXT[],
  target_industries TEXT[],
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);
```

#### `career_directions`

```sql
CREATE TABLE career_directions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction_name TEXT NOT NULL,
  match_score INTEGER,
  analysis JSONB,                   -- AI 完整分析结果
  search_keywords TEXT[],           -- 推荐搜索词
  suggested_filters JSONB,
  status TEXT DEFAULT 'recommended', -- 'recommended' | 'interested' | 'dismissed'
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_directions_user ON career_directions(user_id, status);
```

#### `jobs`

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction_id UUID REFERENCES career_directions(id),
  source TEXT NOT NULL,              -- 'boss' | 'liepin' | 'manual'
  source_job_id TEXT,
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
  description TEXT,
  tags TEXT[],
  published_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ,
  status TEXT DEFAULT 'new',         -- 'new'|'saved'|'applied'|'replied'|'interviewing'|'offer'|'rejected'|'ignored'
  applied_at TIMESTAMPTZ,
  user_note TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, source, source_job_id)
);
CREATE INDEX idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX idx_jobs_user_direction ON jobs(user_id, direction_id);
```

#### `job_matches`

```sql
CREATE TABLE job_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  overall_score INTEGER,
  skill_score INTEGER,
  experience_score INTEGER,
  project_score INTEGER,
  strengths JSONB,
  gaps JSONB,
  focus_points JSONB,
  market_salary TEXT,
  career_path TEXT,
  raw_analysis TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, job_id)
);
```

#### `career_plans` + `plan_tasks`

```sql
CREATE TABLE career_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  direction_id UUID REFERENCES career_directions(id),
  title TEXT NOT NULL,
  total_weeks INTEGER,
  plan_mode TEXT DEFAULT 'ai_suggested',  -- 'ai_suggested' | 'user_deadline'
  start_date DATE,                        -- 计划开始日期
  target_date DATE,                       -- 目标 offer 日期（用户设定模式）
  phases JSONB,                           -- [{ name, weekStart, weekEnd, startDate, endDate }]
  status TEXT DEFAULT 'active',           -- 'active' | 'completed' | 'archived'
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE plan_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES career_plans(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  phase TEXT,                        -- '准备期' | '投递期'
  title TEXT NOT NULL,
  description TEXT,
  completion_criteria TEXT,
  priority TEXT DEFAULT 'medium',
  resources JSONB,                   -- [{ name, url, type }]
  is_completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_tasks_plan ON plan_tasks(plan_id, week_number);
```

所有表启用 RLS：`FOR ALL USING (auth.uid() = user_id)`。

### 5.3 Gemini Proxy 扩展

| 变更 | 说明 |
|------|------|
| `ALLOWED_ACTION_TYPES` 新增 `'career_explore'` | 求职助手相关 AI 调用 |
| `MEMBERSHIP_LIMITS` 新增配额 | 免费 3 次，VIP 不限 |
| CORS 新增插件 origin | `chrome-extension://<id>` |

### 5.4 用量规则

| 操作 | 消耗次数 |
|------|----------|
| 偏好保存、岗位同步、状态更新、打卡 | 否 |
| AI 方向推荐（探索） | **1 次** |
| 生成求职计划 | **1 次** |
| 真实 JD 批量匹配（≤10 个/批） | **1 次** |
| 求职计划回顾调整 | **1 次** |
| 针对性简历 | **1 次** |
| AI 进展总结 | **1 次** |

免费用户合计 3 次（含以上所有）；VIP 不限。与现有诊断/面试配额独立。

---

## 六、Chrome 插件

### 6.1 技术选型

- **Manifest V3** + **Vite + React + TypeScript**
- 打包：CRXJS Vite Plugin 或 Plasmo
- 首版仅支持 Boss 直聘，后续加猎聘

### 6.2 核心功能

| 功能 | 说明 |
|------|------|
| 一键抓取 | 搜索结果页点击按钮，抓取当前页全部岗位 |
| JD 解析 | DOM → 结构化数据（岗位名/公司/薪资/JD/城市等） |
| 去重上传 | 基于 source + sourceJobId 去重后上传 |
| 登录互通 | 在 offerin.co 域读取 Supabase session |
| Popup 快览 | 展示采集统计、最近匹配、跳转雷达入口 |

### 6.3 权限（最小化）

```json
{
  "permissions": ["storage", "activeTab"],
  "host_permissions": [
    "https://www.zhipin.com/*",
    "https://offerin.co/*"
  ]
}
```

### 6.4 数据结构

```typescript
interface RawJobData {
  source: 'boss' | 'liepin';
  sourceJobId: string;
  sourceUrl: string;
  title: string;
  company: string;
  companySize?: string;
  industry?: string;
  salaryRange: string;
  salaryMin?: number;
  salaryMax?: number;
  city: string;
  experience?: string;
  education?: string;
  description: string;
  tags?: string[];
  publishedAt?: string;
  scrapedAt: string;
}
```

---

## 七、开发节奏（3 周上线）

### 总览

```
Week 1：探索阶段 + 基础设施
Week 2：准备阶段 + 插件 + 计划模块
Week 3：投递阶段 + 权限 + 联调打磨
```

---

### Week 1：探索阶段 + 基础设施（Day 1-7）

> 目标：用户能完成「填偏好 → (可选上传简历) → 看到 AI 推荐方向 → 生成计划」。

| Day | 任务 | 产出 | 完成标准 |
|-----|------|------|----------|
| **D1** | Supabase 建表 + RLS | 6 张表全部建好 + RLS 策略生效 | 通过 Supabase Dashboard 验证 CRUD + RLS |
| **D2** | 后端 API 骨架 | `/api/explore/directions` + `/api/career/plan` | Postman 调通，返回 mock 数据 |
| **D2** | Gemini Proxy 扩展 | 新增 `career_explore` action type + 配额 | 本地跑通 AI 调用 |
| **D3** | 前端导航改造 | 主导航新增 [探索] [准备] [投递] Tab + 路由 | 点击 Tab 切换页面，不影响现有功能 |
| **D3** | 偏好收集页 | `EXPLORE` 第一步 UI（表单 + 可选上传简历） | 能填写并保存到 user_preferences |
| **D4** | AI 方向推荐 Prompt + 后端 | Gemini prompt 调优，输出结构化 JSON | 传入偏好（+简历），返回 3-5 个方向 |
| **D5** | 方向推荐前端 | 方向卡片列表 + 匹配度 + ✅❌💡 + 市场信息 | 完整展示 AI 推荐结果 |
| **D6** | 求职计划生成 | Prompt + API + 时间规划选择（AI 建议 / 用户设定期限） | 选定方向后能生成计划 |
| **D7** | 计划前端 + 打卡 | 按周展示 + 打卡 checkbox + 完成标准 | 生成计划 → 按周打卡 |

**Week 1 里程碑**：探索阶段完整可用——填偏好 → AI 推荐方向 → 生成求职计划 → 开始打卡。

---

### Week 2：准备阶段 + 插件 + 计划打卡（Day 8-14）

> 目标：插件能抓取真实 JD，前端展示岗位雷达 + 匹配分析，现有功能串联。

| Day | 任务 | 产出 | 完成标准 |
|-----|------|------|----------|
| **D8** | 插件项目初始化 | Manifest V3 + Vite + React 骨架 + Popup shell | 插件能装到 Chrome，Popup 能打开 |
| **D8** | 登录互通 | 插件从 offerin.co 读取 session | Popup 显示登录状态 |
| **D9** | Boss 直聘 Parser | Content Script 解析搜索结果页 + 详情页 | 控制台输出结构化岗位数据 |
| **D9** | 岗位同步 API | `POST /api/jobs/sync` + 去重 upsert | 插件抓取 → API → Supabase 入库 |
| **D10** | 岗位雷达前端 | `PREPARE` 页面 + 岗位列表 + 筛选/排序 + 方向标签 | 展示已同步的岗位 |
| **D10** | 手动粘贴 JD | 无插件降级入口 | 粘贴 JD → 存入 jobs 表 |
| **D11** | AI 匹配分析 | `/api/jobs/match` + Prompt + 批量匹配 | 点击"分析"后展示匹配度 + ✅❌💡 |
| **D12** | 串联现有功能 | 从岗位详情 → "改简历"自动带入 JD → 进入编辑器 | 不需要重新粘贴 JD |
| **D12** | 串联现有功能 | 从岗位详情 → "练面试"自动带入 JD → 进入面试 | 不需要重新粘贴 JD |
| **D13** | 计划回顾与调整 | "回顾"入口 + 进度摘要 + AI 重新规划 | 已完成任务保留，剩余任务更新 |
| **D14** | 插件体验优化 | Popup 快捷操作 + 一键抓取按钮 + 采集统计 | 非开发者能顺利使用 |

**Week 2 里程碑**：准备阶段完整可用——插件抓取 JD → 雷达展示 → AI 匹配 → 改简历/练面试 → 计划打卡。

---

### Week 3：投递阶段 + 权限 + 联调打磨（Day 15-21）

> 目标：投递追踪可用，权限体系接入，整体体验打磨，可上线。

| Day | 任务 | 产出 | 完成标准 |
|-----|------|------|----------|
| **D15** | 投递状态管理 | `PATCH /api/jobs/:id/status` + 前端状态流转 | 能标记 已投递/已回复/面试中/offer/拒绝 |
| **D15** | 投递看板 | `APPLY` 页面 + 分状态展示 + 统计栏 | 看板展示各状态岗位 |
| **D16** | 按天视图 | 投递期计划切换为天维度 + 日历/时间线视图 | 展示每天的投递和面试安排 |
| **D16** | AI 进展总结 | Prompt + API + 前端展示 | 一键生成投递数据汇总和建议 |
| **D17** | 权限与用量 | career_explore 配额 + VIP 弹窗 + 免费引导 | 免费 3 次后弹 VIP，VIP 不限 |
| **D18** | 三阶段联调 | 探索 → 准备 → 投递全流程走通 | 一个用户从头到尾跑完无断点 |
| **D19** | UI/UX 打磨 | 空状态、加载态、错误态、动画过渡 | 所有异常状态有友好提示 |
| **D19** | 移动端适配 | 响应式布局（三个主页面） | 手机浏览器可用 |
| **D20** | Bug 修复 + 边界 | 测试 + 修复 | 主流程无阻塞性 bug |
| **D21** | 上线准备 | 部署 + 插件打包 + Chrome Web Store 提审 | 线上可访问 |

**Week 3 里程碑**：全流程上线——探索 + 准备 + 投递 + 权限 + 插件可用。

---

### 里程碑总览

| 里程碑 | 时间 | 验收标准 |
|--------|------|----------|
| **M1：探索可用** | Week 1 末 | 填偏好 → AI 推荐方向 → 生成计划 → 打卡 |
| **M2：准备可用** | Week 2 末 | 插件抓取 JD → 雷达展示 → AI 匹配 → 改简历/练面试 → 打卡 |
| **M3：全流程上线** | Week 3 末 | 投递追踪 + 权限 + 体验打磨 + 部署上线 |

---

## 八、风险与缓解

| 风险 | 缓解 |
|------|------|
| AI Prompt 调优耗时 | 方向推荐和匹配分析共用一套分析逻辑，减少 prompt 数量 |
| 插件开发超时 | 插件是锦上添花，先保证手动粘贴 JD 可用；插件可延后 1 周 |
| Boss DOM 变动 | Parser 解耦，快速修复；失败时 fallback 到手动粘贴 |
| Chrome Web Store 审核 | 提审可能需 1-3 周，先用开发者模式分发给内测用户 |
| 三周时间紧张 | 优先级：探索 > 准备（含手动 JD）> 投递看板 > 插件；插件可作为 Week 4 优化项 |

---

## 九、优先级排序（如果时间不够）

| 优先级 | 功能 | 说明 |
|--------|------|------|
| **P0 必须** | 探索全流程（偏好 + 方向推荐 + 计划 + 打卡） | 核心价值，独立可用 |
| **P0 必须** | 手动粘贴 JD + 匹配分析 + 串联改简历/练面试 | 准备阶段核心，不依赖插件 |
| **P0 必须** | 计划打卡 + 回顾 | 用户留存关键 |
| **P1 重要** | 投递看板 + 状态追踪 | 完整闭环 |
| **P1 重要** | 权限与用量 | 商业化 |
| **P2 增强** | Chrome 插件 | 体验增强，可延后 |
| **P2 增强** | AI 进展总结 | 增值功能 |
| **P3 后续** | 猎聘适配、Realtime 通知、统计图表 | 迭代优化 |

---

## 十、与旧文档关系

本文档整合并替代以下两份文档：
- `CAREER_EXPLORATION_DEV_PLAN.md` — 职业探索部分 → 融入「阶段一：探索」
- `JOB_RADAR_EXTENSION_DEV_PLAN.md` — 插件与雷达部分 → 融入「阶段二：准备」+「阶段三：投递」+ 插件章节

上述两份文档保留作为历史参考，后续以本文档为准。
