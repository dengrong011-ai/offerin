/**
 * Gemini API 代理客户端
 * 
 * 通过 Vercel Serverless Function 代理访问 Google Gemini API，
 * 解决国内用户无法直接访问 Google API 的问题，同时避免 API Key 暴露在前端。
 * 
 * 安全特性：
 * - 生产环境所有请求携带 Supabase Auth JWT Token
 * - 服务端验证用户身份和使用配额
 * - 传递 actionType 用于服务端使用量计数
 */

import { GoogleGenAI } from "@google/genai";
import { supabase } from "./supabaseClient";

// 判断是否应该使用代理
const shouldUseProxy = (): boolean => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return hostname !== 'localhost' && hostname !== '127.0.0.1';
};

const getProxyUrl = (): string => '/api/gemini/proxy';

const getLocalApiKey = (): string => {
  // 本地开发时从环境变量获取（需要在 .env.local 中设置 VITE_GEMINI_API_KEY）
  // 生产环境不使用此函数，所有请求都走服务端代理
  return import.meta.env.VITE_GEMINI_API_KEY || '';
};

// 获取当前用户的 auth token（用于服务端鉴权）
async function getAuthToken(): Promise<string> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || '';
  } catch {
    return '';
  }
}

// 构建包含鉴权信息的请求头
async function buildAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * 通过代理发起流式请求，返回 AsyncIterable 兼容格式
 */
async function proxyStreamRequest(options: {
  model: string;
  contents: any[];
  config: any;
  actionType?: string;
}): Promise<AsyncIterable<{ text: string }>> {
  const { model, contents, config, actionType } = options;
  const headers = await buildAuthHeaders();

  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, contents, config, mode: 'stream', actionType: actionType || 'diagnosis' }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    // 413 Payload Too Large - 文件太大
    if (response.status === 413) {
      throw new Error('PAYLOAD_TOO_LARGE');
    }
    // 解析特定错误码给前端处理
    try {
      const errorJson = JSON.parse(errorData);
      if (errorJson.error === 'UNAUTHORIZED') {
        throw new Error('UNAUTHORIZED');
      }
      if (errorJson.error === 'RATE_LIMIT_EXCEEDED') {
        throw new Error('RATE_LIMIT_EXCEEDED');
      }
      if (errorJson.error?.includes('LIMIT_EXCEEDED')) {
        throw new Error(errorJson.error);
      }
    } catch (e: any) {
      if (e.message === 'UNAUTHORIZED' || e.message === 'RATE_LIMIT_EXCEEDED' || e.message === 'PAYLOAD_TOO_LARGE' || e.message?.includes('LIMIT_EXCEEDED')) {
        throw e;
      }
    }
    throw new Error(`Proxy API error ${response.status}: ${errorData}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Failed to get response stream');
  }

  const decoder = new TextDecoder();
  const textQueue: string[] = [];
  let streamDone = false;
  let buffer = '';

  const parseSSEEvents = () => {
    buffer = buffer.replace(/\r\n/g, '\n');
    let eventEnd: number;
    while ((eventEnd = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, eventEnd);
      buffer = buffer.slice(eventEnd + 2);
      const dataLines = event.split('\n')
        .filter(line => line.startsWith('data: '))
        .map(line => line.slice(6));
      if (dataLines.length === 0) continue;
      const jsonStr = dataLines.join('');
      if (jsonStr.trim() === '[DONE]') continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          textQueue.push(text);
        }
      } catch {
        // 跳过无法解析的事件
      }
    }
  };

  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<{ text: string }>> {
          while (textQueue.length === 0 && !streamDone) {
            const { done, value } = await reader.read();
            if (done) {
              streamDone = true;
              if (buffer.trim()) {
                buffer += '\n\n';
                parseSSEEvents();
              }
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            parseSSEEvents();
          }
          if (textQueue.length > 0) {
            return { done: false, value: { text: textQueue.shift()! } };
          }
          return { done: true, value: undefined as any };
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
  actionType?: string;
}): Promise<{ text: string }> {
  const { model, contents, config, actionType } = options;
  const headers = await buildAuthHeaders();

  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, contents, config, mode: 'generate', actionType: actionType || 'diagnosis' }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    try {
      const errorJson = JSON.parse(errorData);
      if (errorJson.error === 'UNAUTHORIZED') {
        throw new Error('UNAUTHORIZED');
      }
      if (errorJson.error?.includes('LIMIT_EXCEEDED')) {
        throw new Error(errorJson.error);
      }
    } catch (e: any) {
      if (e.message === 'UNAUTHORIZED' || e.message?.includes('LIMIT_EXCEEDED')) {
        throw e;
      }
    }
    throw new Error(`Proxy API error ${response.status}: ${errorData}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { text };
}

/**
 * 统一的 AI 客户端 — 自动选择代理或直连
 * 
 * actionType 参数用于服务端使用量计数：
 * - 'diagnosis': 简历诊断
 * - 'interview': 面试模拟
 * - 'translation': 翻译
 * - 'resume_edit': 局部重写/精简
 */
export function createAIClient(actionType?: string) {
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

  // 生产环境：通过代理（携带 JWT + actionType）
  return {
    generateContentStream: async (options: { model: string; contents: any[]; config: any }) => {
      return proxyStreamRequest({ ...options, actionType });
    },
    generateContent: async (options: { model: string; contents: any[]; config: any }) => {
      return proxyGenerateRequest({ ...options, actionType });
    },
  };
}

// 导出类型
export type AIClient = ReturnType<typeof createAIClient>;
