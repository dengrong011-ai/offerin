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

export type CareerExploreStep = 'profile' | 'directions' | 'plan' | 'jd_demo';

/** 本地开发时在控制台打印本次实际使用的模型（代理从响应头读，含服务端 fallback） */
function logDevGeminiModel(requestedModel: string, actualModel: string | null) {
  if (!import.meta.env.DEV) return;
  const actual = actualModel || requestedModel;
  const fallback = actual !== requestedModel;
  console.log(
    `%c[Offerin Gemini]%c 实际模型: %c${actual}%c${fallback ? ` （请求: ${requestedModel}，已 fallback）` : ''}`,
    'color:#10b981;font-weight:bold',
    'color:inherit',
    fallback ? 'color:#f97316' : 'color:#22c55e',
    'font-weight:600',
    'color:#64748b;font-weight:normal'
  );
}

// 判断是否应该使用代理
const shouldUseProxy = (): boolean => {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const remoteProxyUrl = import.meta.env.VITE_REMOTE_PROXY_URL || '';
  // 本地开发时，若配置了 VITE_REMOTE_PROXY_URL，则走线上代理（解决本地直连 ENTITY_NOT_FOUND / OCR 不可用）
  if (isLocal && remoteProxyUrl) return true;
  return !isLocal;
};

const getProxyUrl = (): string => {
  if (typeof window === 'undefined') return '/api/gemini/proxy';
  const remoteProxyUrl = import.meta.env.VITE_REMOTE_PROXY_URL || '';
  if (remoteProxyUrl && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return `${remoteProxyUrl.replace(/\/$/, '')}/api/gemini/proxy`;
  }
  return '/api/gemini/proxy';
};

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
 * 职业探索：createAIClient 的第二个参数即 step。若仅因 actionType 未带上或与 'career_explore' 严格相等失败，
 * 旧逻辑会不把 careerExploreStep 放进 JSON，服务端看不到 step 会落回 diagnosis，usage_logs 永无 career_explore_*。
 */
function resolveProxyBillingFields(
  actionType: string | undefined,
  careerExploreStep: CareerExploreStep | undefined,
): { actionType: string; careerExploreStep?: CareerExploreStep } {
  if (careerExploreStep) {
    return { actionType: 'career_explore', careerExploreStep };
  }
  return { actionType: actionType || 'diagnosis' };
}

/**
 * 通过代理发起流式请求，返回 AsyncIterable 兼容格式
 */
export type ProxyGeminiOptions = {
  model: string;
  contents: any[];
  config: any;
  /** 传给代理：主模型 429/404 时按此顺序再试（须为白名单模型） */
  fallbackModels?: string[];
  /** 整场模拟面试共用；免费试用按场次计（见 proxy checkUsageEligibility） */
  interviewSessionId?: string;
};

async function proxyStreamRequest(options: ProxyGeminiOptions & {
  actionType?: string;
  careerExploreStep?: CareerExploreStep;
}): Promise<AsyncIterable<{ text: string }>> {
  const { model, contents, config, actionType, careerExploreStep, fallbackModels, interviewSessionId } = options;
  const billing = resolveProxyBillingFields(actionType, careerExploreStep);
  const headers = await buildAuthHeaders();

  const response = await fetch(getProxyUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      contents,
      config,
      mode: 'stream',
      actionType: billing.actionType,
      ...(billing.careerExploreStep ? { careerExploreStep: billing.careerExploreStep } : {}),
      ...(fallbackModels !== undefined ? { fallbackModels } : {}),
      ...(interviewSessionId ? { interviewSessionId } : {}),
    }),
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
      if (errorJson.error === 'AI_RATE_LIMIT_EXCEEDED') {
        throw new Error('AI_RATE_LIMIT_EXCEEDED');
      }
      if (errorJson.error?.includes('LIMIT_EXCEEDED')) {
        throw new Error(errorJson.error);
      }
      if (typeof errorJson.error === 'string' && errorJson.error.startsWith('CAREER_')) {
        throw new Error(errorJson.error);
      }
    } catch (e: any) {
      if (
        e.message === 'UNAUTHORIZED' ||
        e.message === 'RATE_LIMIT_EXCEEDED' ||
        e.message === 'AI_RATE_LIMIT_EXCEEDED' ||
        e.message === 'PAYLOAD_TOO_LARGE' ||
        e.message?.includes('LIMIT_EXCEEDED') ||
        e.message?.startsWith('CAREER_')
      ) {
        throw e;
      }
    }
    throw new Error(`Proxy API error ${response.status}: ${errorData}`);
  }

  logDevGeminiModel(model, response.headers.get('X-Gemini-Model'));

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
        const parts = parsed?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            const t = part?.text;
            if (typeof t === 'string' && t.length > 0) {
              textQueue.push(t);
            }
          }
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
/** 浏览器侧等待代理整段响应的上限（略低于 Vercel 300s，避免永远挂起） */
const PROXY_GENERATE_CLIENT_TIMEOUT_MS = 240_000;

async function proxyGenerateRequest(options: ProxyGeminiOptions & {
  actionType?: string;
  careerExploreStep?: CareerExploreStep;
}): Promise<{ text: string }> {
  const { model, contents, config, actionType, careerExploreStep, fallbackModels, interviewSessionId } = options;
  const billing = resolveProxyBillingFields(actionType, careerExploreStep);
  const headers = await buildAuthHeaders();

  const body = JSON.stringify({
    model,
    contents,
    config,
    mode: 'generate',
    actionType: billing.actionType,
    ...(billing.careerExploreStep ? { careerExploreStep: billing.careerExploreStep } : {}),
    ...(fallbackModels !== undefined ? { fallbackModels } : {}),
    ...(interviewSessionId ? { interviewSessionId } : {}),
  });

  let response: Response;
  try {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), PROXY_GENERATE_CLIENT_TIMEOUT_MS);
    response = await fetch(getProxyUrl(), {
      method: 'POST',
      headers,
      body,
      signal: ac.signal,
    }).finally(() => clearTimeout(tid));
  } catch (err: unknown) {
    const name = err && typeof err === 'object' && 'name' in err ? String((err as { name?: string }).name) : '';
    if (name === 'AbortError') {
      throw new Error('请求超时，请稍后重试（若简历很长可先精简再试）');
    }
    throw err;
  }

  if (!response.ok) {
    const errorData = await response.text();
    try {
      const errorJson = JSON.parse(errorData);
      if (errorJson.error === 'UNAUTHORIZED') {
        throw new Error('UNAUTHORIZED');
      }
      if (errorJson.error === 'AI_RATE_LIMIT_EXCEEDED') {
        throw new Error('AI_RATE_LIMIT_EXCEEDED');
      }
      if (errorJson.error?.includes('LIMIT_EXCEEDED')) {
        throw new Error(errorJson.error);
      }
      if (typeof errorJson.error === 'string' && errorJson.error.startsWith('CAREER_')) {
        throw new Error(errorJson.error);
      }
      if (errorJson.error === 'AI_UPSTREAM_TIMEOUT') {
        throw new Error(errorJson.message || '上游模型响应超时，请稍后重试或缩短简历正文');
      }
      if (errorJson.error === 'AI_EMPTY_OR_UNPARSABLE') {
        throw new Error(errorJson.message || '模型返回异常，请稍后重试');
      }
    } catch (e: any) {
      if (
        e.message === 'UNAUTHORIZED' ||
        e.message === 'AI_RATE_LIMIT_EXCEEDED' ||
        e.message?.includes('LIMIT_EXCEEDED') ||
        e.message?.startsWith('CAREER_') ||
        e.message?.includes('上游模型响应超时') ||
        e.message?.includes('模型返回为空或无法解析')
      ) {
        throw e;
      }
    }
    throw new Error(`Proxy API error ${response.status}: ${errorData}`);
  }

  logDevGeminiModel(model, response.headers.get('X-Gemini-Model'));

  const raw = await response.text();
  if (!raw.trim()) {
    throw new Error('Gemini 代理返回空内容，请稍后重试');
  }
  let data: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch (e: any) {
    const hint = e?.message || 'parse error';
    throw new Error(
      raw.length > 200
        ? `Proxy JSON 解析失败 (${hint}): ${raw.slice(0, 200)}…`
        : `Proxy JSON 解析失败 (${hint}): ${raw}`
    );
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return { text };
}

/**
 * 统一的 AI 客户端 — 自动选择代理或直连
 *
 * actionType 参数用于服务端使用量计数；
 * 走代理时：凡传入 careerExploreStep，请求体会固定带 actionType career_explore + step，由服务端计次。
 */
export function createAIClient(actionType?: string, careerExploreStep?: CareerExploreStep) {
  const useProxy = shouldUseProxy();

  if (!useProxy) {
    // 本地开发：直连 Google API（需要在 .env.local 中设置 VITE_GEMINI_API_KEY）
    const apiKey = getLocalApiKey();
    if (!apiKey) {
      // 本地开发未配置 API Key 时，回退到代理模式（避免 "API key must be set" 错误）
      console.warn('[GeminiProxy] 本地开发未设置 VITE_GEMINI_API_KEY，回退到代理模式');
    } else {
      const ai = new GoogleGenAI({ apiKey });
      return {
        generateContentStream: async (options: ProxyGeminiOptions) => {
          const { fallbackModels: _fb, interviewSessionId: _sid, ...geminiOpts } = options;
          if (import.meta.env.DEV && _fb?.length) {
            console.warn(
              '[GeminiProxy] 本地直连忽略 fallbackModels；请配置 VITE_REMOTE_PROXY_URL 或 vercel dev 以走代理回退链'
            );
          }
          void _sid;
          const stream = await ai.models.generateContentStream(geminiOpts);
          logDevGeminiModel(options.model, options.model);
          return stream;
        },
        generateContent: async (options: ProxyGeminiOptions) => {
          const { fallbackModels: _fb, interviewSessionId: _sid, ...geminiOpts } = options;
          if (import.meta.env.DEV && _fb?.length) {
            console.warn(
              '[GeminiProxy] 本地直连忽略 fallbackModels；请配置 VITE_REMOTE_PROXY_URL 或 vercel dev 以走代理回退链'
            );
          }
          void _sid;
          const out = await ai.models.generateContent(geminiOpts);
          logDevGeminiModel(options.model, options.model);
          return out;
        },
      };
    }
  }

  // 生产环境：通过代理（携带 JWT + actionType）
  return {
    generateContentStream: async (options: ProxyGeminiOptions) => {
      return proxyStreamRequest({ ...options, actionType, careerExploreStep });
    },
    generateContent: async (options: ProxyGeminiOptions) => {
      return proxyGenerateRequest({ ...options, actionType, careerExploreStep });
    },
  };
}

// 导出类型
export type AIClient = ReturnType<typeof createAIClient>;
