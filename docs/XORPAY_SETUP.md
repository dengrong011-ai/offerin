# XorPay 支付集成配置说明

## 📋 环境变量配置

在项目根目录的 `.env` 文件中添加以下配置：

```env
# XorPay 支付配置
VITE_XORPAY_APP_ID=你的AppID          # 在 XorPay 后台获取
VITE_XORPAY_APP_SECRET=你的AppSecret  # 在 XorPay 后台获取
VITE_XORPAY_NOTIFY_URL=https://你的域名/api/xorpay/notify  # Webhook 回调地址
```

## 🔧 获取 XorPay 配置

1. 登录 [XorPay 后台](https://xorpay.com/main)
2. 进入「配置」页面
3. 复制 `App ID` 和 `App Secret`

## 📦 Supabase 数据库配置

### 方式一：SQL Editor（推荐）

1. 登录 [Supabase Dashboard](https://supabase.com/dashboard)
2. 进入你的项目 → SQL Editor
3. 复制 `supabase/migrations/001_xorpay_payment.sql` 内容并执行

### 方式二：Supabase CLI

```bash
supabase db push
```

## 🚀 部署 Webhook Edge Function

### 1. 安装 Supabase CLI

```bash
npm install -g supabase
```

### 2. 登录 Supabase

```bash
supabase login
```

### 3. 链接项目

```bash
supabase link --project-ref 你的项目ID
```

### 4. 配置 Edge Function 环境变量

在 Supabase Dashboard → Settings → Edge Functions → Secrets 中添加：

- `XORPAY_APP_SECRET`: 你的 XorPay App Secret

### 5. 部署 Edge Function

```bash
supabase functions deploy xorpay-notify
```

### 6. 获取 Webhook URL

部署成功后，Webhook URL 为：
```
https://你的项目ID.supabase.co/functions/v1/xorpay-notify
```

将此 URL 配置到 `.env` 文件的 `VITE_XORPAY_NOTIFY_URL`

## ✅ 测试支付流程

### 开发模式（未配置 XorPay）

如果 `VITE_XORPAY_APP_ID` 未配置，系统会进入开发模式：
- 生成模拟二维码
- 显示「[开发模式] 模拟支付成功」按钮
- 点击即可模拟支付完成

### 生产模式

1. 配置所有环境变量
2. 部署 Webhook Edge Function
3. 使用真实微信扫码支付测试

## 📊 支付流程图

```
用户点击支付
     │
     ▼
创建本地订单 (Supabase)
     │
     ▼
调用 XorPay API 创建支付
     │
     ▼
获取微信支付二维码
     │
     ▼
用户扫码支付
     │
     ├──────────────────┐
     ▼                  ▼
前端轮询状态        XorPay Webhook 回调
     │                  │
     │                  ▼
     │           Edge Function 处理
     │                  │
     │                  ▼
     │           更新订单状态
     │           处理业务逻辑
     │                  │
     ▼                  │
检测到支付成功 ◀────────┘
     │
     ▼
刷新用户状态/执行下载
```

## 💰 费用说明

| 项目 | 费用 |
|------|------|
| XorPay 体验版 | 0元/月 + 1.2% 手续费 |
| 微信官方费率 | 0.38% |
| **总费率** | **约 1.58%** |

## 🔐 安全注意事项

1. **App Secret 不要提交到代码仓库**
2. **Webhook 必须验证签名**
3. **订单状态更新要做幂等处理**
4. **生产环境使用 HTTPS**

## ❓ 常见问题

### Q: 二维码扫描后显示"商户信息不存在"
A: 检查 `VITE_XORPAY_APP_ID` 是否正确配置

### Q: 支付成功但订单状态未更新
A: 检查 Webhook Edge Function 是否正确部署，查看 Supabase Logs

### Q: 签名错误
A: 检查 `VITE_XORPAY_APP_SECRET` 是否正确，注意不要有多余空格
