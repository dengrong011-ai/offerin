import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vercel Serverless 代理 — 将前端请求转发到 Google Generative AI API
 * 
 * 解决两个问题：
 * 1. 国内用户无需 VPN 即可访问（Vercel 服务器在海外）
 * 2. API Key 不暴露在前端代码中
 * 
 * 支持两种模式：
 * - 普通请求：POST body 中 mode=generate
 * - 流式请求：POST body 中 mode=stream
 */

// Vercel Hobby 计划最长 60 秒，Pro 计划最长 300 秒
export const maxDuration = 60;

const GOOGLE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  // 只允许 POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });
  }

  try {
    const { model, contents, config, mode } = req.body;

    if (!model || !contents) {
      return res.status(400).json({ error: 'Missing required fields: model, contents' });
    }

    // 确保 contents 中每个条目都有 role 字段（REST API 要求）
    const normalizedContents = contents.map((item: any) => ({
      role: item.role || 'user',
      parts: item.parts,
    }));

    // 构建 Google API 请求体
    const requestBody: any = {
      contents: normalizedContents,
    };

    // 处理 config 中的各项配置
    if (config) {
      if (config.systemInstruction) {
        requestBody.systemInstruction = {
          parts: [{ text: config.systemInstruction }]
        };
      }
      // 构建 generationConfig
      const genConfig: any = {};
      if (config.temperature !== undefined) genConfig.temperature = config.temperature;
      if (config.maxOutputTokens !== undefined) genConfig.maxOutputTokens = config.maxOutputTokens;
      if (config.topP !== undefined) genConfig.topP = config.topP;
      if (config.topK !== undefined) genConfig.topK = config.topK;
      if (config.responseMimeType) genConfig.responseMimeType = config.responseMimeType;
      if (Object.keys(genConfig).length > 0) {
        requestBody.generationConfig = genConfig;
      }
      if (config.safetySettings) {
        requestBody.safetySettings = config.safetySettings;
      }
    }

    const isStream = mode === 'stream';
    const action = isStream ? 'streamGenerateContent' : 'generateContent';
    const streamParam = isStream ? '&alt=sse' : '';
    const url = `${GOOGLE_API_BASE}/models/${model}:${action}?key=${apiKey}${streamParam}`;

    const googleResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!googleResponse.ok) {
      const errorText = await googleResponse.text();
      console.error('Google API error:', googleResponse.status, errorText);
      return res.status(googleResponse.status).json({
        error: `Google API error: ${googleResponse.status}`,
        details: errorText,
      });
    }

    if (isStream) {
      // 流式响应：转发 SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Access-Control-Allow-Origin', '*');

      // 使用 Node.js 兼容的方式读取流
      const body = googleResponse.body;
      if (!body) {
        return res.status(500).json({ error: 'Failed to get response stream' });
      }

      try {
        // Node.js 18+ fetch 返回的 body 是 Web ReadableStream
        // 使用 for-await 迭代（Node.js 兼容）
        for await (const chunk of body as any) {
          // chunk 可能是 Buffer 或 Uint8Array
          const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
          res.write(text);
        }
      } catch (e) {
        console.error('Stream error:', e);
      } finally {
        res.end();
      }
    } else {
      // 普通响应
      const data = await googleResponse.json();
      return res.status(200).json(data);
    }
  } catch (error: any) {
    console.error('Proxy error:', error);
    return res.status(500).json({ error: error.message || 'Internal proxy error' });
  }
}
