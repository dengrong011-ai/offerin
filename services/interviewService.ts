
import { GoogleGenAI } from "@google/genai";
import type { InterviewMessage, InterviewSettings, InterviewMode } from '../types';

const getApiKey = () => process.env.API_KEY || process.env.GEMINI_API_KEY || '';

// 面试官系统提示词
const getInterviewerPrompt = (
  jobDescription: string,
  resume: string,
  currentRound: number,
  totalRounds: number,
  phase: string,
  style: string,
  conversationHistory: Array<{role: string, content: string}>,
  isInteractiveMode: boolean = false
) => {
  const styleDescriptions: Record<string, string> = {
    standard: "保持专业、客观的态度，既要考察能力也要让候选人感到尊重",
    pressure: "适当施加压力，追问细节，考察候选人在压力下的表现",
    friendly: "营造轻松友好的氛围，以对话的方式了解候选人"
  };
  const styleDesc = styleDescriptions[style] || styleDescriptions.standard;

  const phaseDescriptions: Record<string, string> = {
    opening: `这是面试开场阶段。请：
- 简短介绍自己（可以虚构一个职位，如"技术总监"）
- 简要介绍公司和团队情况
- 用一个轻松的开场问题让候选人自我介绍`,
    
    basic: `这是基础问题阶段。请：
- 询问候选人的教育背景、工作经历概况
- 了解候选人对这个岗位的理解和期望
- 提问一些基础的专业知识问题`,
    
    professional: `这是专业深入阶段。请：
- 针对简历中提到的项目经验深入提问
- 考察候选人的专业技能深度
- 可以提出一些技术难题或方案设计问题`,
    
    scenario: `这是场景题阶段。请：
- 提出与岗位相关的实际工作场景问题
- 考察候选人的问题解决能力和思维方式
- 可以追问候选人的思考过程`,
    
    closing: `这是收尾阶段。请：
- 询问候选人是否有问题想了解
- 简要总结面试情况
- 告知后续流程（可以虚构）
- 礼貌地结束面试`
  };
  const phaseDesc = phaseDescriptions[phase] || phaseDescriptions.basic;

  let historyContext = "";
  if (conversationHistory.length > 0) {
    historyContext = "\n## 之前的面试对话\n";
    const recentHistory = conversationHistory.slice(-6);
    for (const item of recentHistory) {
      const role = item.role === "interviewer" ? "你（面试官）" : "候选人";
      const content = item.content.length > 500 ? item.content.substring(0, 500) + "..." : item.content;
      historyContext += `\n**${role}**: ${content}\n`;
    }
  }

  // 人机交互模式下的额外指导
  const interactiveModeGuidance = isInteractiveMode ? `

# 人机交互模式特别说明
这是真实用户在回答问题。你需要：
1. 仔细阅读用户的回答，理解其内容和质量
2. 根据用户回答的内容自然地追问或转换话题
3. 如果用户回答得好，可以适当肯定；如果回答不够完整，可以追问
4. 保持对话的连贯性和自然性，就像真实面试一样` : '';

  return `# 角色设定
你是一位资深的技术面试官，拥有丰富的面试经验和扎实的技术背景。你需要站在业务角度，全面考察候选人与岗位的匹配度。

# 面试风格
${styleDesc}

# 岗位JD（职位描述）
\`\`\`
${jobDescription}
\`\`\`

# 候选人简历
\`\`\`
${resume}
\`\`\`

# 当前面试进度
- 当前轮次: 第 ${currentRound} 轮 / 共 ${totalRounds} 轮
- 当前阶段: ${phase}
${historyContext}
${interactiveModeGuidance}

# 本轮要求
${phaseDesc}

# 输出要求
- 直接输出你要说的话，不需要加任何角色标识
- 每次只提1-2个问题，不要一次性问太多
- 根据候选人之前的回答进行追问和深入
- 保持专业、自然的对话风格
- 如果是收尾阶段，要有明确的结束语`;
};

// 面试官点评提示词（人机交互模式专用）
const getInterviewerFeedbackPrompt = (
  jobDescription: string,
  resume: string,
  currentRound: number,
  totalRounds: number,
  phase: string,
  style: string,
  conversationHistory: Array<{role: string, content: string}>,
  userAnswer: string
) => {
  const styleDescriptions: Record<string, string> = {
    standard: "给出客观、专业的点评",
    pressure: "指出不足之处，追问细节",
    friendly: "以鼓励为主，温和地提出改进建议"
  };
  const styleDesc = styleDescriptions[style] || styleDescriptions.standard;

  let historyContext = "";
  if (conversationHistory.length > 0) {
    historyContext = "\n## 之前的面试对话\n";
    const recentHistory = conversationHistory.slice(-4);
    for (const item of recentHistory) {
      const role = item.role === "interviewer" ? "面试官" : "候选人";
      const content = item.content.length > 300 ? item.content.substring(0, 300) + "..." : item.content;
      historyContext += `\n**${role}**: ${content}\n`;
    }
  }

  return `# 角色设定
你是一位资深的技术面试官，正在对候选人的回答进行简短点评，并准备下一个问题。

# 岗位JD
\`\`\`
${jobDescription}
\`\`\`

# 候选人简历
\`\`\`
${resume}
\`\`\`

# 当前面试进度
- 当前轮次: 第 ${currentRound} 轮 / 共 ${totalRounds} 轮
- 当前阶段: ${phase}
${historyContext}

# 候选人刚才的回答
\`\`\`
${userAnswer}
\`\`\`

# 点评风格
${styleDesc}

# 输出要求
请按以下格式输出：
1. 首先对候选人的回答给出**简短点评**（1-2句话，可以是肯定、追问或建议）
2. 然后自然地**过渡到下一个问题**

注意：
- 点评要具体、有针对性，不要泛泛而谈
- 问题要与候选人的回答相关联，体现面试的连贯性
- 整体输出控制在 3-4 句话以内
- 直接输出内容，不要加角色标识`;
};

// 面试者系统提示词（纯模拟模式）
const getIntervieweePrompt = (
  resume: string,
  jobDescription: string,
  conversationHistory: Array<{role: string, content: string}>
) => {
  let historyContext = "";
  if (conversationHistory.length > 0) {
    historyContext = "\n## 之前的面试对话\n";
    const recentHistory = conversationHistory.slice(-6);
    for (const item of recentHistory) {
      const role = item.role === "interviewer" ? "面试官" : "你";
      const content = item.content.length > 500 ? item.content.substring(0, 500) + "..." : item.content;
      historyContext += `\n**${role}**: ${content}\n`;
    }
  }

  return `# 角色设定
你是一位专业知识极其丰富的求职者，正在参加一场重要的面试。你需要基于自己的简历内容，专业、自信地回答面试官的每一个问题。

# 你的简历
\`\`\`
${resume}
\`\`\`

# 目标岗位
\`\`\`
${jobDescription}
\`\`\`
${historyContext}

# 回答原则
1. **基于简历**: 所有回答都要基于简历中的真实经历，可以适当扩展细节但不能捏造
2. **专业深度**: 展示你对专业领域的深入理解，回答要有技术深度
3. **条理清晰**: 使用结构化的方式回答问题，如"首先...其次...最后..."
4. **案例支撑**: 尽量用具体的项目经验和数据来支撑你的观点
5. **适度谦逊**: 对于不了解的问题，诚实地表示不太了解，但可以表达学习意愿
6. **展示热情**: 表达对这个岗位和公司的兴趣和热情

# 回答技巧
- 使用 STAR 法则（Situation-Task-Action-Result）描述项目经验
- 技术问题要展示思考过程，不只是给出答案
- 场景题要分析问题、提出方案、说明权衡
- 适当反问以展示思考深度（但不要太频繁）

# 输出要求
- 直接输出你的回答内容，不需要加任何角色标识
- 保持自然、专业的对话语气
- 回答长度适中，重点突出，不要过于冗长
- 如果是开场自我介绍，控制在1-2分钟的口述长度
- 如果面试官在收尾，要礼貌地表达感谢和期待`;
};

// 获取面试阶段
const getInterviewPhase = (currentRound: number, totalRounds: number): string => {
  if (currentRound === 1) return "opening";
  if (currentRound <= totalRounds * 0.3) return "basic";
  if (currentRound <= totalRounds * 0.7) return "professional";
  if (currentRound <= totalRounds - 2) return "scenario";
  return "closing";
};

export interface InterviewCallbacks {
  onMessage: (message: InterviewMessage) => void;
  onComplete: () => void;
  onError: (error: string) => void;
  onWaitingForInput?: (round: number, phase: string) => void;
}

// 面试状态管理（人机交互模式）
export interface InteractiveInterviewState {
  resume: string;
  jobDescription: string;
  settings: InterviewSettings;
  conversationHistory: Array<{role: string, content: string}>;
  currentRound: number;
  isComplete: boolean;
}

// 运行模拟面试（纯模拟模式）
export const runInterview = async (
  resume: string,
  jobDescription: string,
  settings: InterviewSettings,
  callbacks: InterviewCallbacks,
  abortSignal?: AbortSignal
) => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  const conversationHistory: Array<{role: string, content: string}> = [];
  const { totalRounds, interviewStyle } = settings;

  // 发送面试开始信息
  callbacks.onMessage({
    type: 'system',
    content: `面试开始，共 ${totalRounds} 轮`,
    timestamp: new Date().toISOString()
  });

  try {
    for (let roundNum = 1; roundNum <= totalRounds; roundNum++) {
      // 检查是否被中止
      if (abortSignal?.aborted) {
        callbacks.onMessage({
          type: 'system',
          content: '面试已停止',
          timestamp: new Date().toISOString()
        });
        return;
      }

      const phase = getInterviewPhase(roundNum, totalRounds);
      
      // 发送轮次信息
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

      const interviewerPrompt = getInterviewerPrompt(
        jobDescription,
        resume,
        roundNum,
        totalRounds,
        phase,
        interviewStyle,
        conversationHistory,
        false
      );

      let interviewerResponse = '';
      try {
        const stream = await ai.models.generateContentStream({
          model: "gemini-3-pro-preview",
          contents: [{ parts: [{ text: "请根据当前面试阶段，提出你的问题。" }] }],
          config: {
            systemInstruction: interviewerPrompt,
            temperature: 0.8,
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ] as any
          },
        });

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

      // 面试官完成
      callbacks.onMessage({
        type: 'interviewer',
        content: interviewerResponse,
        round: roundNum,
        isStreaming: false,
        timestamp: new Date().toISOString()
      });

      conversationHistory.push({ role: 'interviewer', content: interviewerResponse });

      if (abortSignal?.aborted) break;

      // 2. 面试者回答
      callbacks.onMessage({
        type: 'interviewee',
        content: '',
        round: roundNum,
        isStreaming: true,
        timestamp: new Date().toISOString()
      });

      const intervieweePrompt = getIntervieweePrompt(resume, jobDescription, conversationHistory);

      let intervieweeResponse = '';
      try {
        const stream = await ai.models.generateContentStream({
          model: "gemini-3-pro-preview",
          contents: [{ parts: [{ text: `面试官的问题：\n${interviewerResponse}\n\n请专业地回答这个问题。` }] }],
          config: {
            systemInstruction: intervieweePrompt,
            temperature: 0.7,
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ] as any
          },
        });

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

      // 面试者完成
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

    const summaryPrompt = buildSummaryPrompt(jobDescription, resume, conversationHistory, false);
    
    let summaryContent = '';
    try {
      const stream = await ai.models.generateContentStream({
        model: "gemini-3-pro-preview",
        contents: [{ parts: [{ text: summaryPrompt }] }],
        config: {
          systemInstruction: "你是一位资深的HR面试评估专家，擅长从面试对话中评估候选人能力。",
          temperature: 0.6,
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ] as any
        },
      });

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

    callbacks.onComplete();

  } catch (error: any) {
    console.error('Interview error:', error);
    callbacks.onError(error.message || '面试过程出错');
  }
};

// ==================== 人机交互模式 API ====================

// 生成面试官的第一个问题（人机交互模式）
export const generateFirstQuestion = async (
  resume: string,
  jobDescription: string,
  settings: InterviewSettings,
  callbacks: InterviewCallbacks,
  abortSignal?: AbortSignal
): Promise<InteractiveInterviewState | null> => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  const { totalRounds, interviewStyle } = settings;
  const conversationHistory: Array<{role: string, content: string}> = [];
  const currentRound = 1;
  const phase = getInterviewPhase(currentRound, totalRounds);

  // 发送面试开始信息
  callbacks.onMessage({
    type: 'system',
    content: `人机交互面试开始，共 ${totalRounds} 轮，请认真作答`,
    timestamp: new Date().toISOString()
  });

  // 发送轮次信息
  callbacks.onMessage({
    type: 'round',
    content: `第 ${currentRound}/${totalRounds} 轮 - ${getPhaseLabel(phase)}`,
    round: currentRound,
    phase,
    timestamp: new Date().toISOString()
  });

  // 面试官提问
  callbacks.onMessage({
    type: 'interviewer',
    content: '',
    round: currentRound,
    isStreaming: true,
    timestamp: new Date().toISOString()
  });

  const interviewerPrompt = getInterviewerPrompt(
    jobDescription,
    resume,
    currentRound,
    totalRounds,
    phase,
    interviewStyle,
    conversationHistory,
    true
  );

  let interviewerResponse = '';
  try {
    const stream = await ai.models.generateContentStream({
      model: "gemini-3-pro-preview",
      contents: [{ parts: [{ text: "请根据当前面试阶段，提出你的问题。" }] }],
      config: {
        systemInstruction: interviewerPrompt,
        temperature: 0.8,
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ] as any
      },
    });

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

  // 面试官完成
  callbacks.onMessage({
    type: 'interviewer',
    content: interviewerResponse,
    round: currentRound,
    isStreaming: false,
    timestamp: new Date().toISOString()
  });

  conversationHistory.push({ role: 'interviewer', content: interviewerResponse });

  // 通知等待用户输入
  callbacks.onWaitingForInput?.(currentRound, phase);

  return {
    resume,
    jobDescription,
    settings,
    conversationHistory,
    currentRound,
    isComplete: false
  };
};

// 处理用户回答并生成下一个问题（人机交互模式）
export const processUserAnswer = async (
  state: InteractiveInterviewState,
  userAnswer: string,
  callbacks: InterviewCallbacks,
  abortSignal?: AbortSignal
): Promise<InteractiveInterviewState | null> => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  const { resume, jobDescription, settings, conversationHistory, currentRound } = state;
  const { totalRounds, interviewStyle } = settings;

  // 添加用户回答到消息列表
  callbacks.onMessage({
    type: 'interviewee',
    content: userAnswer,
    round: currentRound,
    isStreaming: false,
    timestamp: new Date().toISOString()
  });

  conversationHistory.push({ role: 'interviewee', content: userAnswer });

  const nextRound = currentRound + 1;

  // 检查是否是最后一轮
  if (nextRound > totalRounds) {
    // 生成面试总结
    callbacks.onMessage({
      type: 'summary',
      content: '',
      isStreaming: true,
      timestamp: new Date().toISOString()
    });

    const summaryPrompt = buildSummaryPrompt(jobDescription, resume, conversationHistory, true);
    
    let summaryContent = '';
    try {
      const stream = await ai.models.generateContentStream({
        model: "gemini-3-pro-preview",
        contents: [{ parts: [{ text: summaryPrompt }] }],
        config: {
          systemInstruction: "你是一位资深的HR面试评估专家，擅长从面试对话中评估候选人能力。请对候选人的真实回答进行专业、客观的评估。",
          temperature: 0.6,
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
          ] as any
        },
      });

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

    callbacks.onComplete();

    return {
      ...state,
      conversationHistory,
      currentRound: nextRound,
      isComplete: true
    };
  }

  const nextPhase = getInterviewPhase(nextRound, totalRounds);

  // 发送轮次信息
  callbacks.onMessage({
    type: 'round',
    content: `第 ${nextRound}/${totalRounds} 轮 - ${getPhaseLabel(nextPhase)}`,
    round: nextRound,
    phase: nextPhase,
    timestamp: new Date().toISOString()
  });

  // 面试官点评 + 下一个问题
  callbacks.onMessage({
    type: 'interviewer',
    content: '',
    round: nextRound,
    isStreaming: true,
    timestamp: new Date().toISOString()
  });

  const feedbackPrompt = getInterviewerFeedbackPrompt(
    jobDescription,
    resume,
    nextRound,
    totalRounds,
    nextPhase,
    interviewStyle,
    conversationHistory,
    userAnswer
  );

  let interviewerResponse = '';
  try {
    const stream = await ai.models.generateContentStream({
      model: "gemini-3-pro-preview",
      contents: [{ parts: [{ text: "请对候选人的回答进行点评，并提出下一个问题。" }] }],
      config: {
        systemInstruction: feedbackPrompt,
        temperature: 0.8,
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ] as any
      },
    });

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

  // 面试官完成
  callbacks.onMessage({
    type: 'interviewer',
    content: interviewerResponse,
    round: nextRound,
    isStreaming: false,
    timestamp: new Date().toISOString()
  });

  conversationHistory.push({ role: 'interviewer', content: interviewerResponse });

  // 通知等待用户输入
  callbacks.onWaitingForInput?.(nextRound, nextPhase);

  return {
    ...state,
    conversationHistory,
    currentRound: nextRound,
    isComplete: false
  };
};

const buildSummaryPrompt = (
  jobDescription: string,
  resume: string,
  conversationHistory: Array<{role: string, content: string}>,
  isInteractiveMode: boolean = false
) => {
  let prompt = `请根据以下面试记录，给出详细的面试评估报告。

## 岗位要求
${jobDescription}

## 候选人简历
${resume}

## 面试记录
`;
  
  for (const item of conversationHistory) {
    const role = item.role === "interviewer" ? "面试官" : "面试者";
    prompt += `\n**${role}**: ${item.content}\n`;
  }

  if (isInteractiveMode) {
    prompt += `

**注意**：这是人机交互模式的面试，面试者的回答是真实用户输入的。请基于用户的实际回答进行客观评估。

请从以下几个维度进行评估：
1. **技术能力匹配度** - 候选人展示的技术栈与岗位需求的匹配程度
2. **专业深度** - 候选人回答中体现的专业知识深度
3. **沟通表达** - 候选人的表达清晰度、逻辑性和条理性
4. **应变能力** - 候选人对不同类型问题的应对能力
5. **改进建议** - 针对候选人的回答，给出具体的改进建议
6. **综合评价** - 整体面试表现评分（满分10分）及是否推荐

请给出详细、专业、具有建设性的评估报告。`;
  } else {
    prompt += `

请从以下几个维度进行评估：
1. **技术能力匹配度** - 候选人的技术栈与岗位需求的匹配程度
2. **专业深度** - 候选人对专业知识的掌握深度
3. **沟通表达** - 候选人的表达清晰度和逻辑性
4. **项目经验** - 候选人的项目经验与岗位的相关性
5. **综合建议** - 是否推荐录用及理由

请给出详细、专业的评估报告。`;
  }

  return prompt;
};

const getPhaseLabel = (phase: string): string => {
  const labels: Record<string, string> = {
    opening: '开场阶段',
    basic: '基础问题',
    professional: '专业深入',
    scenario: '场景题',
    closing: '收尾阶段'
  };
  return labels[phase] || phase;
};

// 导出面试记录为 Markdown
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
