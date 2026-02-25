/**
 * Gemini API 代理客户端
 * 
 * 通过 Vercel Serverless Function 代理访问 Google Gemini API，
 * 解决国内用户无法直接访问 Google API 的问题，同时避免 API Key 暴露在前端。
 * 
 * 使用方式：
 * - 部署到 Vercel 后，自动走 /api/gemini/proxy 代理（服务端持有 API Key）
 * - 本地开发时（localhost），仍走 @google/genai SDK 直连（需要 VPN）
 */

import { GoogleGenAI } from "@google/genai";

// 判断是否应该使用代理
// 本地开发时直连（开发者通常有 VPN），生产环境走代理
const shouldUseProxy = (): boolean => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  // localhost / 127.0.0.1 视为本地开发环境，直连
  return hostname !== 'localhost' && hostname !== '127.0.0.1';
};

// 获取代理 API 的 base URL
const getProxyUrl = (): string => {
  return '/api/gemini/proxy';
};

// 获取本地开发用的 API Key
const getLocalApiKey = (): string => {
  return process.env.API_KEY || process.env.GEMINI_API_KEY || '';
};

/**
 * 通过代理发起流式请求，返回 AsyncIterable 兼容格式
 */
async function proxyStreamRequest(options: {
  model: string;
  contents: any[];
  config: any;
}): Promise<AsyncIterable<{ text: string }>> {
  const { model, contents, config } = options;

  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, contents, config, mode: 'stream' }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Proxy API error ${response.status}: ${errorData}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response stream');
  }

  // 将 SSE stream 转换为 AsyncIterable<{ text: string }>
  const decoder = new TextDecoder();
  
  return {
    [Symbol.asyncIterator]() {
      let buffer = '';
      return {
        async next(): Promise<IteratorResult<{ text: string }>> {
          while (true) {
            // 检查 buffer 中是否有完整的 SSE 事件
            const eventEnd = buffer.indexOf('\n\n');
            if (eventEnd !== -1) {
              const event = buffer.slice(0, eventEnd);
              buffer = buffer.slice(eventEnd + 2);
              
              // 解析 SSE data 行
              const dataLine = event.split('\n').find(line => line.startsWith('data: '));
              if (dataLine) {
                const jsonStr = dataLine.slice(6); // 去掉 "data: "
                if (jsonStr.trim() === '[DONE]') {
                  return { done: true, value: undefined as any };
                }
                try {
                  const parsed = JSON.parse(jsonStr);
                  const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                  if (text) {
                    return { done: false, value: { text } };
                  }
                } catch {
                  // 跳过无法解析的行
                }
              }
              continue;
            }

            // 需要更多数据
            const { done, value } = await reader.read();
            if (done) {
              // 处理 buffer 中剩余的数据
              if (buffer.trim()) {
                const dataLine = buffer.split('\n').find(line => line.startsWith('data: '));
                if (dataLine) {
                  const jsonStr = dataLine.slice(6);
                  try {
                    const parsed = JSON.parse(jsonStr);
                    const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    buffer = '';
                    if (text) {
                      return { done: false, value: { text } };
                    }
                  } catch {
                    // ignore
                  }
                }
              }
              return { done: true, value: undefined as any };
            }
            buffer += decoder.decode(value, { stream: true });
          }
        }
      };
    }
  };
}

/**
 * 通过代理发起普通（非流式）请求
 */
async function proxyGenerateRequest(options: {
  model: string;
  contents: any[];
  config: any;
}): Promise<{ text: string }> {
  const { model, contents, config } = options;

  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, contents, config, mode: 'generate' }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`Proxy API error ${response.status}: ${errorData}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { text };
}

/**
 * 统一的 AI 客户端 — 自动选择代理或直连
 * 
 * 提供与 GoogleGenAI SDK 兼容的接口：
 * - generateContentStream: 流式生成
 * - generateContent: 普通生成
 */
export function createAIClient() {
  const useProxy = shouldUseProxy();

  if (!useProxy) {
    // 本地开发：直连 Google API
    const apiKey = getLocalApiKey();
    const ai = new GoogleGenAI({ apiKey });
    return {
      generateContentStream: async (options: { model: string; contents: any[]; config: any }) => {
        return ai.models.generateContentStream(options);
      },
      generateContent: async (options: { model: string; contents: any[]; config: any }) => {
        return ai.models.generateContent(options);
      },
    };
  }

  // 生产环境：通过代理
  return {
    generateContentStream: async (options: { model: string; contents: any[]; config: any }) => {
      return proxyStreamRequest(options);
    },
    generateContent: async (options: { model: string; contents: any[]; config: any }) => {
      return proxyGenerateRequest(options);
    },
  };
}

// 导出类型
export type AIClient = ReturnType<typeof createAIClient>;
