
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

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 2000,
  maxDelay: 10000,
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const isRetryableError = (error: any): boolean => {
  const message = error?.message || '';
  const code = error?.code;
  return code === 503 || code === 429 || 
         message.includes('503') || 
         message.includes('UNAVAILABLE') ||
         message.includes('high demand') ||
         message.includes('overloaded');
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
      
      if (!isRetryableError(error)) {
        throw error;
      }
      
      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        const delayMs = Math.min(
          RETRY_CONFIG.baseDelay * Math.pow(2, attempt) + Math.random() * 1000,
          RETRY_CONFIG.maxDelay
        );
        console.log(`等待 ${Math.round(delayMs/1000)} 秒后重试...`);
        await delay(delayMs);
      }
    }
  }
  
  throw lastError || new Error('API 调用失败');
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
  try {
    const stream = await generateContentStreamWithRetry(client, {
      model: "gemini-3.1-pro-preview",
      contents: [{ parts: [{ text: "请对候选人的回答进行点评，并提出下一个问题。" }] }],
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
