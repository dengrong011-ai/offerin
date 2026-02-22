# API 安全配置指南

## 🔴 当前问题

目前 AI 服务（Gemini API）的 API Key 通过环境变量在客户端代码中使用，这存在安全风险：
- API Key 会暴露在浏览器的 JavaScript 中
- 恶意用户可以窃取并滥用 API Key

## ✅ 推荐解决方案

### 方案一：使用 Supabase Edge Functions（推荐）

将 AI 调用迁移到 Supabase Edge Functions，API Key 只存储在服务器端。

#### 1. 创建 Edge Function

```bash
# 在项目根目录执行
supabase functions new gemini-proxy
```

#### 2. 编写代理函数

在 `supabase/functions/gemini-proxy/index.ts` 中：

```typescript
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { GoogleGenAI } from 'npm:@google/genai'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!

serve(async (req) => {
  // CORS 处理
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  try {
    const { action, params } = await req.json()
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })

    // 根据 action 调用不同的 AI 功能
    switch (action) {
      case 'analyzeResume':
        // 简历分析逻辑
        break
      case 'interview':
        // 面试模拟逻辑
        break
      case 'translate':
        // 翻译逻辑
        break
      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
    }

    // 返回结果...
  } catch (error) {
    console.error('Proxy error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
```

#### 3. 配置环境变量

在 Supabase Dashboard -> Edge Functions -> Secrets 中添加：
- `GEMINI_API_KEY`: 你的 Gemini API Key

#### 4. 部署函数

```bash
supabase functions deploy gemini-proxy
```

#### 5. 修改前端代码

将直接调用 Gemini API 改为调用 Edge Function：

```typescript
// 原来的调用方式
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const response = await ai.models.generateContent(options);

// 改为调用 Edge Function
const response = await fetch(
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-proxy`,
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
    },
    body: JSON.stringify({
      action: 'analyzeResume',
      params: { jd, resume, aspiration },
    }),
  }
);
```

### 方案二：使用 Vercel/Netlify Serverless Functions

如果你使用 Vercel 或 Netlify 部署，可以创建 API Routes：

#### Vercel (Next.js)

```typescript
// pages/api/ai/analyze.ts
import { GoogleGenAI } from '@google/genai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  // ... 处理请求
}
```

#### Netlify Functions

```typescript
// netlify/functions/ai-proxy.ts
import { GoogleGenAI } from '@google/genai';

export const handler = async (event) => {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  // ... 处理请求
};
```

### 方案三：添加请求限制和验证

如果暂时无法迁移到后端，至少应该：

1. **使用 API Key 限制**：在 Google AI Studio 设置 API Key 的使用限制
2. **添加域名白名单**：限制 API Key 只能从特定域名调用
3. **添加速率限制**：在前端添加请求频率限制

## 🔧 快速实施步骤

1. 在 Supabase 创建 Edge Function
2. 将 GEMINI_API_KEY 添加到 Edge Function 的环境变量
3. 修改 `geminiService.ts` 和 `interviewService.ts` 调用 Edge Function
4. 移除客户端代码中的 API Key 引用
5. 部署并测试

## 📝 注意事项

- 流式响应需要使用 Server-Sent Events (SSE) 或 WebSocket
- Edge Function 有执行时间限制（通常 10-30 秒），长时间任务需要特殊处理
- 添加适当的身份验证，防止未授权访问
