
import { createAIClient, type AIClient } from "./geminiProxy";
import { FALLBACK_AFTER_3_1_PRO, MODEL_PRIMARY_INTERVIEW } from "./geminiModelRouting";
import type { InterviewMessage, InterviewSettings, InterviewMode, InterviewSupplementInfo } from '../types';
import {
  saveInterviewHistory as saveInterviewHistoryToService,
  hashString,
  extractInterviewContent,
  type InterviewHistoryRecord
} from './interviewHistoryService';
import {
  ROLE_CONFIG,
  getInterviewPhase,
  getPhaseLabel,
  PHASE_TEMPERATURE,
  SAFETY_SETTINGS,
} from './interviewConfig';
import {
  buildInterviewerPrompt,
  buildIntervieweePrompt,
  buildSummaryPrompt,
} from './promptBuilder';

// ==================== 面试历史管理（问题多样性控制）====================
// 注意：面试历史现在通过 interviewHistoryService.ts 管理，支持云端同步

// 重新导出供外部使用
export { extractInterviewContent } from './interviewHistoryService';

// 获取面试历史（兼容旧接口，内部使用本地存储版本）
export const getInterviewHistory = (resumeHash: string): InterviewHistoryRecord[] => {
  try {
    const stored = localStorage.getItem('offer_ing_interview_history');
    if (!stored) return [];
    
    const allHistory: InterviewHistoryRecord[] = JSON.parse(stored);
    return allHistory
      .filter(h => h.resumeHash === resumeHash)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
  } catch {
    return [];
  }
};

// 保存面试历史（本地存储版本，用于兼容）
export const saveInterviewHistory = (
  resume: string,
  questionsAsked: string[],
  experiencesCovered: string[]
): void => {
  try {
    const resumeHash = hashString(resume);
    const stored = localStorage.getItem('offer_ing_interview_history');
    const allHistory: InterviewHistoryRecord[] = stored ? JSON.parse(stored) : [];
    
    const newRecord: InterviewHistoryRecord = {
      resumeHash,
      questionsAsked,
      experiencesCovered,
      timestamp: Date.now()
    };
    
    allHistory.unshift(newRecord);
    const trimmedHistory = allHistory.slice(0, 50);
    localStorage.setItem('offer_ing_interview_history', JSON.stringify(trimmedHistory));
  } catch (error) {
    devWarn('保存面试历史失败:', error);
  }
};

// 异步保存面试历史（支持云端同步）
export const saveInterviewHistoryAsync = async (
  userId: string | null,
  resume: string,
  questionsAsked: string[],
  experiencesCovered: string[],
  settings?: InterviewSettings
): Promise<void> => {
  const resumeHash = hashString(resume);
  const record: InterviewHistoryRecord = {
    resumeHash,
    questionsAsked,
    experiencesCovered,
    interviewMode: settings?.mode,
    interviewerRole: settings?.interviewerRole,
    totalRounds: settings?.totalRounds,
    timestamp: Date.now()
  };
  
  await saveInterviewHistoryToService(userId, record);
};

// ==================== API 调用基础设施 ====================

// 重试配置 - 快速降级，主模型 2 次失败即切备用模型
const RETRY_CONFIG = {
  maxRetries: 2,
  baseDelay: 1500,
  maxDelay: 5000,
  networkRetries: 3,
  networkBaseDelay: 2000,
  networkMaxDelay: 8000,
};

/**
 * 仅主模型（MODEL_PRIMARY_INTERVIEW）失败后的降级顺序，不要包含主模型本身。
 * 实际流程：① 先请求主模型，最多重试 RETRY_CONFIG.maxRetries 次（429/404 不重试同模型，直接进②）
 * ② 按顺序尝试下列模型，直到成功或全部失败。
 * 另：走 /api/gemini/proxy 时，服务端对单次请求还有一层 429/404 → 2.5pro→2.5flash→2.0 的 fallback（见 proxy.ts）。
 */
/** 面试保持 3.1 主路径，失败后与诊断一致 */
const INTERVIEW_FALLBACK_TAIL = [...FALLBACK_AFTER_3_1_PRO];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** 生产环境不输出日志（隐藏模型名等敏感信息） */
const isDev = import.meta.env.DEV;
const devLog = (...args: any[]) => { if (isDev) console.log(...args); };
const devWarn = (...args: any[]) => { if (isDev) console.warn(...args); };

const is429Error = (error: any): boolean => {
  const message = error?.message || '';
  const code = error?.code;
  return code === 429 || message.includes('429') || message.includes('AI_RATE_LIMIT_EXCEEDED') || message.includes('RATE_LIMIT_EXCEEDED');
};

const is404OrEntityNotFound = (error: any): boolean => {
  const message = error?.message || '';
  return message.includes('404') || message.includes('Requested entity was not found') || message.includes('ENTITY_NOT_FOUND');
};

/** 判断是否为网络层错误（客户端网络中断 / 连接不上服务器，换模型无意义） */
const isNetworkError = (error: any): boolean => {
  const message = error?.message || '';
  return message.includes('Failed to fetch') ||
         message.includes('network') ||
         message.includes('ERR_NETWORK') ||
         message.includes('ECONNRESET') ||
         message.includes('ECONNREFUSED') ||
         message.includes('ENOTFOUND') ||
         message.includes('TypeError: fetch') ||
         message.includes('Load failed') ||
         message.includes('aborted');
};

/** 代理流式 { text } 与 SDK 原生流式 candidates[].parts[] 兼容 */
function extractStreamChunkText(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') return '';
  const c = chunk as Record<string, unknown>;
  const parts = (c.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined)?.[0]?.content?.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    const joined = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
    if (joined.length > 0) return joined;
  }
  if (typeof c.text === 'string') return c.text;
  return '';
}

/** 非流式：代理 { text } 与 SDK candidates.parts 兼容 */
function extractGenerateText(res: unknown): string {
  if (!res || typeof res !== 'object') return '';
  const r = res as Record<string, unknown>;
  if (typeof r.text === 'string') return r.text;
  const parts = (r.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined)?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    return parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
  }
  return '';
}

const isRetryableError = (error: any): boolean => {
  const message = error?.message || '';
  const code = error?.code;
  if (is429Error(error)) return false; // 429 不重试同一模型，但会走 fallback
  if (isNetworkError(error)) return true; // 网络错误可重试
  return code === 503 ||
         message.includes('503') ||
         message.includes('502') ||
         message.includes('AI_SERVICE_ERROR') ||
         message.includes('UNAVAILABLE') ||
         message.includes('high demand') ||
         message.includes('overloaded') ||
         message.includes('timeout') ||
         message.includes('504') ||
         message.includes('TIMEOUT');
};

async function generateContentStreamWithRetry(
  client: AIClient,
  options: {
    model: string;
    contents: any[];
    config: any;
    fallbackModels?: string[];
    interviewSessionId?: string;
  },
  abortSignal?: AbortSignal
): Promise<AsyncIterable<any>> {
  const primary = options.model;
  const tail = options.fallbackModels ?? INTERVIEW_FALLBACK_TAIL;
  const tryOrder = [primary, ...tail.filter((m) => m !== primary)];

  let lastError: Error | null = null;
  let networkRetryBudget = RETRY_CONFIG.networkRetries;

  for (let i = 0; i < tryOrder.length; i++) {
    const M = tryOrder[i];
    const proxyFallbacks = tryOrder.slice(i + 1);

    for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
      if (abortSignal?.aborted) {
        throw new Error('已取消');
      }

      try {
        const stream = await client.generateContentStream({
          model: M,
          contents: options.contents,
          config: options.config,
          fallbackModels: proxyFallbacks,
          ...(options.interviewSessionId ? { interviewSessionId: options.interviewSessionId } : {}),
        });
        return stream;
      } catch (error: any) {
        lastError = error;
        devWarn(
          `API 调用失败 (模型 ${M}, 尝试 ${attempt + 1}/${RETRY_CONFIG.maxRetries}):`,
          error.message
        );

        // 网络错误：不切模型，用更长间隔重试
        if (isNetworkError(error) && networkRetryBudget > 0) {
          networkRetryBudget--;
          const netDelay = Math.min(
            RETRY_CONFIG.networkBaseDelay * Math.pow(1.5, RETRY_CONFIG.networkRetries - networkRetryBudget - 1) + Math.random() * 1000,
            RETRY_CONFIG.networkMaxDelay
          );
          devLog(`网络异常，${Math.round(netDelay / 1000)} 秒后重试（剩余 ${networkRetryBudget} 次）...`);
          await delay(netDelay);
          attempt--;
          continue;
        }

        if (is429Error(error)) break;
        if (is404OrEntityNotFound(error)) break;
        if (!isRetryableError(error)) {
          throw error;
        }

        if (attempt < RETRY_CONFIG.maxRetries - 1) {
          const delayMs = Math.min(
            RETRY_CONFIG.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
            RETRY_CONFIG.maxDelay
          );
          devLog(`等待 ${Math.round(delayMs / 1000)} 秒后重试...`);
          await delay(delayMs);
        }
      }
    }

    // 网络错误耗尽重试预算后直接抛出
    if (lastError && isNetworkError(lastError) && networkRetryBudget <= 0) {
      break;
    }

    if (i < tryOrder.length - 1) {
      if (abortSignal?.aborted) throw new Error('已取消');
      devLog(`切换候选模型: ${tryOrder[i + 1]}`);
      await delay(500);
    }
  }

  throw lastError || new Error('API 调用失败，所有模型均不可用');
}

// ==================== 类型导出 ====================

export interface FileData {
  name: string;
  data: string;
  mimeType: string;
}

export interface InterviewCallbacks {
  onMessage: (message: InterviewMessage) => void;
  onComplete: () => void;
  onError: (error: string) => void;
  onWaitingForInput?: (round: number, phase: string) => void;
}

export interface InteractiveInterviewState {
  resume: string;
  jobDescription: string;
  settings: InterviewSettings;
  conversationHistory: Array<{role: string, content: string}>;
  currentRound: number;
  isComplete: boolean;
  /** 与代理 usage_logs 场次一致；人机模式整场共用 */
  interviewSessionId: string;
  supplementInfo?: InterviewSupplementInfo;
}

// ==================== 纯模拟模式 ====================

export const runInterview = async (
  resume: string,
  jobDescription: string,
  settings: InterviewSettings,
  callbacks: InterviewCallbacks,
  abortSignal?: AbortSignal,
  supplementInfo?: InterviewSupplementInfo
) => {
  const client = createAIClient('interview');
  const interviewSessionId = crypto.randomUUID();
  const conversationHistory: Array<{role: string, content: string}> = [];
  const { totalRounds, interviewerRole } = settings;

  callbacks.onMessage({
    type: 'system',
    content: `面试开始，共 ${totalRounds} 轮`,
    timestamp: new Date().toISOString()
  });

  try {
    for (let roundNum = 1; roundNum <= totalRounds; roundNum++) {
      if (abortSignal?.aborted) {
        callbacks.onMessage({
          type: 'system',
          content: '面试已停止',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const phase = getInterviewPhase(roundNum, totalRounds);
      
      callbacks.onMessage({
        type: 'round',
        content: `第 ${roundNum}/${totalRounds} 轮 - ${getPhaseLabel(phase)}`,
        round: roundNum,
        phase,
        timestamp: new Date().toISOString()
      });

      // 1. 面试官提问
      callbacks.onMessage({
        type: 'interviewer',
        content: '',
        round: roundNum,
        isStreaming: true,
        timestamp: new Date().toISOString()
      });

      const interviewerPrompt = buildInterviewerPrompt({
        jobDescription,
        resume,
        currentRound: roundNum,
        totalRounds,
        phase,
        interviewerRole,
        conversationHistory,
        isInteractiveMode: false,
        supplementInfo,
        isFirstRound: roundNum === 1,
      });

      let interviewerResponse = '';
      const simulationInterviewerUserText =
        roundNum === 1
          ? '请开始面试（开场第 1 轮）。格式与约束见系统指令与「本轮要求」。'
          : '请阅读对话历史中候选人上一轮的回答。若其中向你提出问题、反问或想了解团队/业务，请先真诚、简要回应，再自然衔接你的下一个考察问题；禁止无视对方追问、突兀跳到简历上另一段无关经历。请直接输出你作为面试官的完整发言。';
      try {
        const stream = await generateContentStreamWithRetry(client, {
          model: MODEL_PRIMARY_INTERVIEW,
          contents: [{ parts: [{ text: simulationInterviewerUserText }] }],
          config: {
            systemInstruction: interviewerPrompt,
            temperature:
              roundNum === 1
                ? Math.min(PHASE_TEMPERATURE[phase] ?? 0.8, 0.72)
                : PHASE_TEMPERATURE[phase] ?? 0.8,
            safetySettings: SAFETY_SETTINGS,
          },
          interviewSessionId,
        }, abortSignal);

        for await (const chunk of stream) {
          if (abortSignal?.aborted) break;
          const text = extractStreamChunkText(chunk);
          interviewerResponse += text;
          callbacks.onMessage({
            type: 'interviewer',
            content: interviewerResponse,
            round: roundNum,
            isStreaming: true,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error: any) {
        devWarn('Interviewer generation error:', error);
        throw error;
      }

      if (abortSignal?.aborted) return;

      callbacks.onMessage({
        type: 'interviewer',
        content: interviewerResponse,
        round: roundNum,
        isStreaming: false,
        timestamp: new Date().toISOString()
      });

      conversationHistory.push({ role: 'interviewer', content: interviewerResponse });

      if (abortSignal?.aborted) return;

      // 2. 面试者回答
      callbacks.onMessage({
        type: 'interviewee',
        content: '',
        round: roundNum,
        isStreaming: true,
        timestamp: new Date().toISOString()
      });

      const intervieweePrompt = buildIntervieweePrompt(resume, jobDescription, conversationHistory, interviewerRole, phase, supplementInfo);

      let intervieweeResponse = '';
      try {
        const stream = await generateContentStreamWithRetry(client, {
          model: MODEL_PRIMARY_INTERVIEW,
          contents: [{ parts: [{ text: `面试官的问题：\n${interviewerResponse}\n\n请专业地回答这个问题。` }] }],
          config: {
            systemInstruction: intervieweePrompt,
            temperature: 0.7,
            safetySettings: SAFETY_SETTINGS,
          },
          interviewSessionId,
        }, abortSignal);

        for await (const chunk of stream) {
          if (abortSignal?.aborted) break;
          const text = extractStreamChunkText(chunk);
          intervieweeResponse += text;
          callbacks.onMessage({
            type: 'interviewee',
            content: intervieweeResponse,
            round: roundNum,
            isStreaming: true,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error: any) {
        devWarn('Interviewee generation error:', error);
        throw error;
      }

      if (abortSignal?.aborted) return;

      if (!intervieweeResponse.trim() && !abortSignal?.aborted) {
        try {
          const q =
            interviewerResponse.length > 20000
              ? `${interviewerResponse.slice(0, 20000)}\n\n[… 上文已截断]`
              : interviewerResponse;
          const res = await client.generateContent({
            model: MODEL_PRIMARY_INTERVIEW,
            contents: [
              {
                parts: [
                  {
                    text: `面试官的问题：\n${q}\n\n请用中文完整回答，至少 4 句话，禁止空内容或仅省略号。`,
                  },
                ],
              },
            ],
            config: {
              systemInstruction:
                intervieweePrompt +
                '\n\n【重要】你必须输出一段完整候选人回答，禁止输出空字符串、仅「…」或无话术的占位。',
              temperature: 0.65,
              safetySettings: SAFETY_SETTINGS,
              fallbackModels: INTERVIEW_FALLBACK_TAIL,
            },
            interviewSessionId,
          });
          intervieweeResponse = extractGenerateText(res).trim();
        } catch (e) {
          devWarn('Interviewee non-stream fallback failed:', e);
        }
      }

      callbacks.onMessage({
        type: 'interviewee',
        content: intervieweeResponse,
        round: roundNum,
        isStreaming: false,
        timestamp: new Date().toISOString()
      });

      conversationHistory.push({ role: 'interviewee', content: intervieweeResponse });
    }

    if (abortSignal?.aborted) return;

    // 生成面试总结
    callbacks.onMessage({
      type: 'summary',
      content: '',
      isStreaming: true,
      timestamp: new Date().toISOString()
    });

    const roleConfig = ROLE_CONFIG[interviewerRole];
    const summaryPrompt = buildSummaryPrompt(jobDescription, resume, conversationHistory, false, interviewerRole, supplementInfo);
    
    let summaryContent = '';
    try {
      const stream = await generateContentStreamWithRetry(client, {
        model: MODEL_PRIMARY_INTERVIEW,
        contents: [{ parts: [{ text: summaryPrompt }] }],
        config: {
          systemInstruction: `你是 ${roleConfig.name}（${roleConfig.title}）。${roleConfig.systemInstruction.substring(0, 200)}`,
          temperature: 0.6,
          safetySettings: SAFETY_SETTINGS,
        },
        interviewSessionId,
      }, abortSignal);

      for await (const chunk of stream) {
        if (abortSignal?.aborted) break;
        const text = extractStreamChunkText(chunk);
        summaryContent += text;
        callbacks.onMessage({
          type: 'summary',
          content: summaryContent,
          isStreaming: true,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error: any) {
      devWarn('Summary generation error:', error);
      throw error;
    }

    if (abortSignal?.aborted) return;

    callbacks.onMessage({
      type: 'summary',
      content: summaryContent,
      isStreaming: false,
      timestamp: new Date().toISOString()
    });

    callbacks.onMessage({
      type: 'system',
      content: '面试结束',
      timestamp: new Date().toISOString()
    });

    try {
      const { questions, experiences } = extractInterviewContent(conversationHistory);
      saveInterviewHistory(resume, questions, experiences);
    } catch (e) {
      devWarn('保存面试历史失败:', e);
    }

    callbacks.onComplete();

  } catch (error: any) {
    devWarn('Interview error:', error);
    callbacks.onError(error.message || '面试过程出错');
  }
};

// ==================== 人机交互模式 API ====================

export const generateFirstQuestion = async (
  resume: string,
  jobDescription: string,
  settings: InterviewSettings,
  callbacks: InterviewCallbacks,
  abortSignal?: AbortSignal,
  supplementInfo?: InterviewSupplementInfo
): Promise<InteractiveInterviewState | null> => {
  const client = createAIClient('interview');
  const interviewSessionId = crypto.randomUUID();
  const { totalRounds, interviewerRole } = settings;
  const conversationHistory: Array<{role: string, content: string}> = [];
  const currentRound = 1;
  const phase = getInterviewPhase(currentRound, totalRounds);

  callbacks.onMessage({
    type: 'system',
    content: `人机交互面试开始，共 ${totalRounds} 轮，请认真作答`,
    timestamp: new Date().toISOString()
  });

  callbacks.onMessage({
    type: 'round',
    content: `第 ${currentRound}/${totalRounds} 轮 - ${getPhaseLabel(phase)}`,
    round: currentRound,
    phase,
    timestamp: new Date().toISOString()
  });

  callbacks.onMessage({
    type: 'interviewer',
    content: '',
    round: currentRound,
    isStreaming: true,
    timestamp: new Date().toISOString()
  });

  const interviewerPrompt = buildInterviewerPrompt({
    jobDescription,
    resume,
    currentRound,
    totalRounds,
    phase,
    interviewerRole,
    conversationHistory,
    isInteractiveMode: true,
    supplementInfo,
    isFirstRound: true,
  });

  let interviewerResponse = '';
  try {
    const stream = await generateContentStreamWithRetry(client, {
      model: MODEL_PRIMARY_INTERVIEW,
      contents: [
        {
          parts: [
            {
              text: `请开始面试（开场第 1 轮）。格式与禁止项见系统指令与「本轮要求」。`,
            },
          ],
        },
      ],
      config: {
        systemInstruction: interviewerPrompt,
        // 开场首轮略降温度，减少「炫技式长问题」漂移
        temperature: Math.min(PHASE_TEMPERATURE[phase] ?? 0.8, 0.72),
        safetySettings: SAFETY_SETTINGS,
      },
      interviewSessionId,
    }, abortSignal);

    for await (const chunk of stream) {
      if (abortSignal?.aborted) return null;
      const text = extractStreamChunkText(chunk);
      interviewerResponse += text;
      callbacks.onMessage({
        type: 'interviewer',
        content: interviewerResponse,
        round: currentRound,
        isStreaming: true,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error: any) {
    devWarn('First question generation error:', error);
    callbacks.onError(error.message || '生成问题出错');
    return null;
  }

  if (abortSignal?.aborted) return null;

  callbacks.onMessage({
    type: 'interviewer',
    content: interviewerResponse,
    round: currentRound,
    isStreaming: false,
    timestamp: new Date().toISOString()
  });

  conversationHistory.push({ role: 'interviewer', content: interviewerResponse });
  callbacks.onWaitingForInput?.(currentRound, phase);

  return {
    resume,
    jobDescription,
    settings,
    conversationHistory,
    currentRound,
    isComplete: false,
    interviewSessionId,
    supplementInfo
  };
};

export const processUserAnswer = async (
  state: InteractiveInterviewState,
  userAnswer: string,
  callbacks: InterviewCallbacks,
  abortSignal?: AbortSignal
): Promise<InteractiveInterviewState | null> => {
  const client = createAIClient('interview');
  const { resume, jobDescription, settings, conversationHistory, currentRound, supplementInfo, interviewSessionId } = state;
  const { totalRounds, interviewerRole } = settings;

  callbacks.onMessage({
    type: 'interviewee',
    content: userAnswer,
    round: currentRound,
    isStreaming: false,
    timestamp: new Date().toISOString()
  });

  conversationHistory.push({ role: 'interviewee', content: userAnswer });

  const nextRound = currentRound + 1;

  // 最后一轮：生成面试总结
  if (nextRound > totalRounds) {
    callbacks.onMessage({
      type: 'summary',
      content: '',
      isStreaming: true,
      timestamp: new Date().toISOString()
    });

    const roleConfig = ROLE_CONFIG[interviewerRole];
    const summaryPrompt = buildSummaryPrompt(jobDescription, resume, conversationHistory, true, interviewerRole, supplementInfo);
    
    let summaryContent = '';
    try {
      const stream = await generateContentStreamWithRetry(client, {
        model: MODEL_PRIMARY_INTERVIEW,
        contents: [{ parts: [{ text: summaryPrompt }] }],
        config: {
          systemInstruction: `你是 ${roleConfig.name}（${roleConfig.title}）。注意：面试者的回答是真实用户输入的，请基于其实际表现进行评估。${roleConfig.systemInstruction.substring(0, 200)}`,
          temperature: 0.6,
          safetySettings: SAFETY_SETTINGS,
        },
        interviewSessionId,
      }, abortSignal);

      for await (const chunk of stream) {
        if (abortSignal?.aborted) return null;
        const text = extractStreamChunkText(chunk);
        summaryContent += text;
        callbacks.onMessage({
          type: 'summary',
          content: summaryContent,
          isStreaming: true,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error: any) {
      devWarn('Summary generation error:', error);
      callbacks.onError(error.message || '生成评估报告出错');
      return null;
    }

    if (abortSignal?.aborted) return null;

    callbacks.onMessage({
      type: 'summary',
      content: summaryContent,
      isStreaming: false,
      timestamp: new Date().toISOString()
    });

    callbacks.onMessage({
      type: 'system',
      content: '面试结束',
      timestamp: new Date().toISOString()
    });

    try {
      const { questions, experiences } = extractInterviewContent(conversationHistory);
      saveInterviewHistory(resume, questions, experiences);
    } catch (e) {
      devWarn('保存面试历史失败:', e);
    }

    callbacks.onComplete();

    return {
      ...state,
      conversationHistory,
      currentRound: nextRound,
      isComplete: true
    };
  }

  // 非最后一轮：面试官点评 + 下一个问题
  const nextPhase = getInterviewPhase(nextRound, totalRounds);

  callbacks.onMessage({
    type: 'round',
    content: `第 ${nextRound}/${totalRounds} 轮 - ${getPhaseLabel(nextPhase)}`,
    round: nextRound,
    phase: nextPhase,
    timestamp: new Date().toISOString()
  });

  callbacks.onMessage({
    type: 'interviewer',
    content: '',
    round: nextRound,
    isStreaming: true,
    timestamp: new Date().toISOString()
  });

  // 使用统一的 buildInterviewerPrompt（替代原来的 getInterviewerFeedbackPrompt）
  const feedbackPrompt = buildInterviewerPrompt({
    jobDescription,
    resume,
    currentRound: nextRound,
    totalRounds,
    phase: nextPhase,
    interviewerRole,
    conversationHistory,
    isInteractiveMode: true,
    supplementInfo,
    userAnswer,
    isFirstRound: false,
  });

  let interviewerResponse = '';
  // 收尾阶段：把候选人问题直接放在用户消息中，避免模型忽略 system prompt 中的内容
  const userPromptText = nextPhase === 'closing'
    ? `【重要】候选人已经提出了问题，请直接回答，不要再次邀请提问。\n\n候选人刚才的问题：\n${userAnswer}\n\n请针对以上问题给出回答，并感谢候选人的时间。`
    : `请阅读候选人刚才的回答全文。\n若其中向你提出问题、反问或想了解团队/业务/JD 相关现状，你必须先真诚回应，再点评并衔接下一个考察问题；不要忽略对方的追问、也不要突然跳到简历上无关的另一段经历而不承上启下。\n\n候选人刚才的回答：\n${userAnswer}`;
  try {
    const stream = await generateContentStreamWithRetry(client, {
      model: MODEL_PRIMARY_INTERVIEW,
      contents: [{ parts: [{ text: userPromptText }] }],
      config: {
        systemInstruction: feedbackPrompt,
        temperature: PHASE_TEMPERATURE[nextPhase] ?? 0.8,
        safetySettings: SAFETY_SETTINGS,
      },
      interviewSessionId,
    }, abortSignal);

    for await (const chunk of stream) {
      if (abortSignal?.aborted) return null;
      const text = extractStreamChunkText(chunk);
      interviewerResponse += text;
      callbacks.onMessage({
        type: 'interviewer',
        content: interviewerResponse,
        round: nextRound,
        isStreaming: true,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error: any) {
    devWarn('Feedback generation error:', error);
    callbacks.onError(error.message || '生成反馈出错');
    return null;
  }

  if (abortSignal?.aborted) return null;

  callbacks.onMessage({
    type: 'interviewer',
    content: interviewerResponse,
    round: nextRound,
    isStreaming: false,
    timestamp: new Date().toISOString()
  });

  conversationHistory.push({ role: 'interviewer', content: interviewerResponse });
  callbacks.onWaitingForInput?.(nextRound, nextPhase);

  return {
    ...state,
    conversationHistory,
    currentRound: nextRound,
    isComplete: false
  };
};

// ==================== 导出面试记录 ====================

export const exportInterviewRecord = (messages: InterviewMessage[], resumeName?: string, mode?: InterviewMode): string => {
  const timestamp = new Date().toISOString().split('T')[0];
  let markdown = `# 模拟面试记录\n\n`;
  markdown += `**日期**: ${timestamp}\n`;
  markdown += `**模式**: ${mode === 'interactive' ? '人机交互' : '纯模拟'}\n\n`;
  if (resumeName) {
    markdown += `**候选人**: ${resumeName}\n\n`;
  }
  markdown += `---\n\n`;

  for (const msg of messages) {
    switch (msg.type) {
      case 'system':
        markdown += `> 📌 ${msg.content}\n\n`;
        break;
      case 'round':
        markdown += `## ${msg.content}\n\n`;
        break;
      case 'interviewer':
        if (!msg.isStreaming) {
          markdown += `### 🎤 面试官\n\n${msg.content}\n\n`;
        }
        break;
      case 'interviewee':
        if (!msg.isStreaming) {
          markdown += `### 👤 面试者\n\n${msg.content}\n\n`;
        }
        break;
      case 'summary':
        if (!msg.isStreaming) {
          markdown += `---\n\n## 📊 面试评估报告\n\n${msg.content}\n\n`;
        }
        break;
      case 'error':
        markdown += `> ⚠️ ${msg.content}\n\n`;
        break;
    }
  }

  return markdown;
};
