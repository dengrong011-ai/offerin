# 上线前四项操作指南

按下面步骤逐项完成即可。

---

## 一、在 Vercel 配置 Upstash Redis（必须）

**目的**：生产环境限流依赖 Redis，未配置时 Gemini 代理会返回 503。

### 步骤

1. **注册 / 登录 Upstash**
   - 打开 [Upstash Console](https://console.upstash.com/)
   - 用 GitHub 或邮箱注册并登录

2. **创建 Redis 数据库**
   - 点击 **Create Database**
   - **Name** 随意（如 `offerin-ratelimit`）
   - **Region** 选离你用户较近的（如 `ap-northeast-1` 东京）
   - **Type** 选 **Regional** 即可（免费额度够用）
   - 点击 **Create**

3. **复制连接信息**
   - 进入该数据库详情页
   - 找到 **REST API** 区域
   - 复制 **UPSTASH_REDIS_REST_URL**（形如 `https://xxx.upstash.io`）
   - 复制 **UPSTASH_REDIS_REST_TOKEN**（一长串字符串）

4. **在 Vercel 里添加环境变量**
   - 打开 [Vercel Dashboard](https://vercel.com/dashboard) → 选中 **offer-ing** 项目
   - 进入 **Settings** → **Environment Variables**
   - 新增两条：
     - **Name**: `UPSTASH_REDIS_REST_URL`，**Value**: 粘贴刚才的 URL，**Environment** 勾选 **Production**（建议也勾选 Preview 方便测试）
     - **Name**: `UPSTASH_REDIS_REST_TOKEN`，**Value**: 粘贴 Token，**Environment** 同上
   - 保存后，**重新部署一次 Production**，新的请求才会用上 Redis 限流

---

## 二、执行 usage_logs 复合索引迁移（强烈建议）

**目的**：优化「本月诊断/面试次数」查询，数据量变大后避免全表扫描。

### 方式 A：Supabase 网页 SQL Editor（推荐，无需装 CLI）

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard) → 选中你的项目
2. 左侧点 **SQL Editor** → **New query**
3. 打开本地文件 `supabase/migrations/011_usage_logs_monthly_index.sql`，复制全部内容，粘贴到 SQL Editor
4. 点击 **Run** 执行
5. 看到成功提示即可（若索引已存在会提示已存在，也算成功）

### 方式 B：Supabase CLI

1. 若已安装并登录 Supabase CLI（`supabase login`），在项目根目录执行：
   ```bash
   supabase db push
   ```
2. 会应用所有未执行过的 migration（包含 011）

---

## 三、配置前端错误监控 Sentry（强烈建议）

**目的**：前端报错自动上报到 Sentry，便于发现和排查问题。

### 步骤

1. **注册 / 登录 Sentry**
   - 打开 [Sentry](https://sentry.io/) 并注册或登录

2. **创建项目**
   - 进入 **Projects** → **Create Project**
   - 选择 **React** 平台
   - 项目名随意（如 `offerin-frontend`）
   - 创建完成后会看到 **DSN**（形如 `https://xxx@xxx.ingest.sentry.io/xxx`），复制保存

3. **在项目里配置 DSN**
   - **本地 / 自建部署**：在项目根目录的 `.env.production`（或部署用的 env 文件）里增加一行：
     ```bash
     VITE_SENTRY_DSN=https://你的DSN@xxx.ingest.sentry.io/xxx
     ```
   - **Vercel 部署**：
     - Vercel 项目 → **Settings** → **Environment Variables**
     - 新增 **Name**: `VITE_SENTRY_DSN`，**Value**: 粘贴 DSN
     - **Environment** 勾选 **Production**（可选 Preview）
     - 保存后**重新部署**一次，前端才会开始上报

4. **验证**
   - 部署后在浏览器里故意触发一个错误（如访问不存在的路由或点一个会抛错的按钮），几分钟内在 Sentry 的 **Issues** 里应能看到该错误

---

## 四、设置 Gemini 与 Vercel 预算/用量告警（强烈建议）

**目的**：用量或费用异常时能收到通知，避免账单失控。

### 4.1 Google Gemini

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)（使用你存放 `GEMINI_API_KEY` 的项目）
2. 左侧 **Billing** → **Budgets & alerts**（预算和提醒）
3. **Create budget**：
   - 选择关联的结算账号
   - 设置预算金额（例如按月、按项目）
   - 添加告警规则：例如达到 50%、90%、100% 时发邮件
4. 保存后，超出阈值会收到邮件

若你主要用 **Google AI Studio** 的 key：部分计费/预算在 Cloud Console 的同一结算账号下配置，步骤类似（Billing → 预算与告警）。

### 4.2 Vercel

1. 登录 [Vercel](https://vercel.com/dashboard)
2. 右上角头像 → **Account Settings**（或团队设置）→ **Billing**
3. 查看当前套餐的 **Function 执行次数、带宽** 等限额

**若你用的是 Hobby（免费）套餐：**

- **没有「支出上限」可设置**：Hobby 不绑卡、不扣费，**Spend Limit / 支出告警 仅 Pro 团队有**，所以你在 Hobby 下找不到是正常的。
- 你能做的是：在 **Billing** 或项目 **Settings → Usage** 里定期看 **Function Invocations**、**Bandwidth** 等用量，避免超限导致服务暂停。
- 若以后需要「用量/支出告警」或「超额自动暂停」，需升级 **Pro**，再在 Billing 里使用 **Spend Management**。

---

## 清单自检

| 项 | 做完后打勾 |
|----|------------|
| Upstash Redis 已在 Vercel 配置并重新部署 | [ ] |
| 011 迁移已在 Supabase 执行 | [ ] |
| Sentry 项目已创建，`VITE_SENTRY_DSN` 已配置并重新部署 | [ ] |
| Gemini 预算/告警已设置 | [ ] |
| Vercel 用量或支出提醒已查看/设置 | [ ] |

做完以上四项，上线前的「必须」与「强烈建议」配置就齐了。若某一项暂时不做（如 Sentry），也不影响基本运行，可后续再补。
