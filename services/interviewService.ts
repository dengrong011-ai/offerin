
import { createAIClient, type AIClient } from "./geminiProxy";
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
    console.error('保存面试历史失败:', error);
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
};

/**
 * 仅主模型（各调用处写的 gemini-3.1-pro-preview）失败后的降级顺序，不要包含主模型本身。
 * 实际流程：① 先请求主模型，最多重试 RETRY_CONFIG.maxRetries 次（429/404 不重试同模型，直接进②）
 * ② 按顺序尝试下列模型，直到成功或全部失败。
 * 另：走 /api/gemini/proxy 时，服务端对单次请求还有一层 429/404 → 2.5pro→2.5flash→2.0 的 fallback（见 proxy.ts）。
 */
/** 使用官方稳定 Model code：preview-05-06 等旧 ID 在 v1beta 易 404，见 ai.google.dev 文档 */
const FALLBACK_MODELS = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const is429Error = (error: any): boolean => {
  const message = error?.message || '';
  const code = error?.code;
  return code === 429 || message.includes('429') || message.includes('AI_RATE_LIMIT_EXCEEDED') || message.includes('RATE_LIMIT_EXCEEDED');
};

const is404OrEntityNotFound = (error: any): boolean => {
  const message = error?.message || '';
  return message.includes('404') || message.includes('Requested entity was not found') || message.includes('ENTITY_NOT_FOUND');
};

const isRetryableError = (error: any): boolean => {
  const message = error?.message || '';
  const code = error?.code;
  if (is429Error(error)) return false; // 429 不重试同一模型，但会走 fallback
  return code === 503 ||
         message.includes('503') ||
         message.includes('502') ||
         message.includes('AI_SERVICE_ERROR') ||
         message.includes('UNAVAILABLE') ||
         message.includes('high demand') ||
         message.includes('overloaded') ||
         message.includes('Failed to fetch') ||
         message.includes('TypeError') ||
         message.includes('network') ||
         message.includes('ECONNRESET') ||
         message.includes('timeout') ||
         message.includes('aborted') ||
         message.includes('504') ||
         message.includes('TIMEOUT');
};

async function generateContentStreamWithRetry(
  client: AIClient,
  options: {
    model: string;
    contents: any[];
    config: any;
  },
  abortSignal?: AbortSignal
): Promise<AsyncIterable<any>> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
    if (abortSignal?.aborted) {
      throw new Error('已取消');
    }

    try {
      const stream = await client.generateContentStream(options);
      return stream;
    } catch (error: any) {
      lastError = error;
      console.warn(`API 调用失败 (尝试 ${attempt + 1}/${RETRY_CONFIG.maxRetries}):`, error.message);

      if (is429Error(error)) break; // 429 不重试，直接进入 fallback
      if (is404OrEntityNotFound(error)) break; // 404 不重试，直接进入 fallback
      if (!isRetryableError(error)) {
        throw error;
      }

      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        const delayMs = Math.min(
          RETRY_CONFIG.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
          RETRY_CONFIG.maxDelay
        );
        console.log(`等待 ${Math.round(delayMs / 1000)} 秒后重试...`);
        await delay(delayMs);
      }
    }
  }

  // 主模型重试全部失败后，尝试备用模型（含 429/404 时直接 fallback，不同配额池）
  if (isRetryableError(lastError) || is429Error(lastError) || is404OrEntityNotFound(lastError)) {
    for (const fallbackModel of FALLBACK_MODELS) {
      if (fallbackModel === options.model) continue;
      if (abortSignal?.aborted) throw new Error('已取消');
      console.log(`主模型持续失败，尝试备用模型: ${fallbackModel}`);
      try {
        await delay(500);
        const stream = await client.generateContentStream({
          ...options,
          model: fallbackModel,
        });
        if (import.meta.env.DEV) {
          console.log(
            `%c[Offerin Gemini]%c 面试客户端重试成功，实际模型: %c${fallbackModel}%c（主模型 ${options.model} 未成功）`,
            'color:#10b981;font-weight:bold',
            '',
            'color:#f97316;font-weight:600',
            ''
          );
        }
        return stream;
      } catch (fallbackError: any) {
        console.warn(`备用模型 ${fallbackModel} 也失败:`, fallbackError.message);
        lastError = fallbackError;
      }
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
          ? '请根据当前面试阶段，提出你的问题。'
          : '请阅读对话历史中候选人上一轮的回答。若其中向你提出问题、反问或想了解团队/业务，请先真诚、简要回应，再自然衔接你的下一个考察问题；禁止无视对方追问、突兀跳到简历上另一段无关经历。请直接输出你作为面试官的完整发言。';
      try {
        const stream = await generateContentStreamWithRetry(client, {
          model: "gemini-3.1-pro-preview",
          contents: [{ parts: [{ text: simulationInterviewerUserText }] }],
          config: {
            systemInstruction: interviewerPrompt,
            temperature: PHASE_TEMPERATURE[phase] ?? 0.8,
            safetySettings: SAFETY_SETTINGS,
          },
        }, abortSignal);

        for await (const chunk of stream) {
          if (abortSignal?.aborted) break;
          const text = chunk.text || '';
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
        console.error('Interviewer generation error:', error);
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
          model: "gemini-3.1-pro-preview",
          contents: [{ parts: [{ text: `面试官的问题：\n${interviewerResponse}\n\n请专业地回答这个问题。` }] }],
          config: {
            systemInstruction: intervieweePrompt,
            temperature: 0.7,
            safetySettings: SAFETY_SETTINGS,
          },
        }, abortSignal);

        for await (const chunk of stream) {
          if (abortSignal?.aborted) break;
          const text = chunk.text || '';
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
        console.error('Interviewee generation error:', error);
        throw error;
      }

      if (abortSignal?.aborted) return;

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
        model: "gemini-3.1-pro-preview",
        contents: [{ parts: [{ text: summaryPrompt }] }],
        config: {
          systemInstruction: `你是 ${roleConfig.name}（${roleConfig.title}）。${roleConfig.systemInstruction.substring(0, 200)}`,
          temperature: 0.6,
          safetySettings: SAFETY_SETTINGS,
        },
      }, abortSignal);

      for await (const chunk of stream) {
        if (abortSignal?.aborted) break;
        const text = chunk.text || '';
        summaryContent += text;
        callbacks.onMessage({
          type: 'summary',
          content: summaryContent,
          isStreaming: true,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error: any) {
      console.error('Summary generation error:', error);
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
      console.error('保存面试历史失败:', e);
    }

    callbacks.onComplete();

  } catch (error: any) {
    console.error('Interview error:', error);
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
      model: "gemini-3.1-pro-preview",
      contents: [{ parts: [{ text: "请根据当前面试阶段，提出你的问题。" }] }],
      config: {
        systemInstruction: interviewerPrompt,
        temperature: PHASE_TEMPERATURE[phase] ?? 0.8,
        safetySettings: SAFETY_SETTINGS,
      },
    }, abortSignal);

    for await (const chunk of stream) {
      if (abortSignal?.aborted) return null;
      const text = chunk.text || '';
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
    console.error('First question generation error:', error);
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
  const { resume, jobDescription, settings, conversationHistory, currentRound, supplementInfo } = state;
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
        model: "gemini-3.1-pro-preview",
        contents: [{ parts: [{ text: summaryPrompt }] }],
        config: {
          systemInstruction: `你是 ${roleConfig.name}（${roleConfig.title}）。注意：面试者的回答是真实用户输入的，请基于其实际表现进行评估。${roleConfig.systemInstruction.substring(0, 200)}`,
          temperature: 0.6,
          safetySettings: SAFETY_SETTINGS,
        },
      }, abortSignal);

      for await (const chunk of stream) {
        if (abortSignal?.aborted) return null;
        const text = chunk.text || '';
        summaryContent += text;
        callbacks.onMessage({
          type: 'summary',
          content: summaryContent,
          isStreaming: true,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error: any) {
      console.error('Summary generation error:', error);
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
      console.error('保存面试历史失败:', e);
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
      model: "gemini-3.1-pro-preview",
      contents: [{ parts: [{ text: userPromptText }] }],
      config: {
        systemInstruction: feedbackPrompt,
        temperature: PHASE_TEMPERATURE[nextPhase] ?? 0.8,
        safetySettings: SAFETY_SETTINGS,
      },
    }, abortSignal);

    for await (const chunk of stream) {
      if (abortSignal?.aborted) return null;
      const text = chunk.text || '';
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
    console.error('Feedback generation error:', error);
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
