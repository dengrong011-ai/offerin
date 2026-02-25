/**
 * Prompt 构建器
 * 统一面试官 prompt 函数 + 对话历史智能摘要 + prompt 组装工具
 */

import type { InterviewerRole, InterviewSupplementInfo } from '../types';
import {
  ROLE_CONFIG,
  PACE_CONTROL,
  REPORT_FORMAT_GUIDE,
} from './interviewConfig';
import { hashString, getLocalInterviewHistory } from './interviewHistoryService';

// ==================== Prompt 组装工具函数 ====================

/** 条件性构建 prompt 段落，condition 为 false 时返回空字符串 */
const section = (title: string, content: string, condition: boolean = true): string => {
  if (!condition || !content.trim()) return '';
  return `\n# ${title}\n${content}\n`;
};

/** 构建代码块包裹的文本 */
const codeBlock = (content: string): string => `\`\`\`\n${content}\n\`\`\``;

// ==================== JD/简历预处理摘要 ====================

/**
 * 对 JD 进行摘要压缩，保留核心信息
 * 用于非首轮面试，减少重复注入的 token 消耗
 */
export const summarizeJD = (jobDescription: string): string => {
  const lines = jobDescription.split('\n').map(l => l.trim()).filter(Boolean);
  
  // 提取关键段落：职位名称、职责、要求、优先项
  const keyPatterns = [
    /职位|岗位|title|role/i,
    /职责|负责|responsibilities|duties/i,
    /要求|资格|任职|requirements|qualifications/i,
    /优先|加分|preferred|bonus|plus/i,
    /公司|团队|部门|company|team|department/i,
    /薪资|待遇|compensation|salary/i,
  ];
  
  const keyLines: string[] = [];
  let isInKeySection = false;
  let sectionLineCount = 0;
  
  for (const line of lines) {
    // 检测是否是关键段落的标题行
    const isHeader = keyPatterns.some(p => p.test(line)) || /^[#\-\*•]/.test(line) || /[:：]$/.test(line);
    
    if (isHeader) {
      isInKeySection = true;
      sectionLineCount = 0;
      keyLines.push(line);
    } else if (isInKeySection) {
      sectionLineCount++;
      // 每个段落最多保留 8 行内容
      if (sectionLineCount <= 8) {
        keyLines.push(line);
      }
      // 空行或下一个段落标题时结束当前段
      if (line === '' || sectionLineCount > 8) {
        isInKeySection = false;
      }
    } else {
      // 非关键段落：只保留含关键词的行
      const hasKeyword = /必须|熟悉|精通|经验|能力|技能|skill|experience|proficient/i.test(line);
      if (hasKeyword) {
        keyLines.push(line);
      }
    }
  }
  
  // 如果摘要太短（提取效果不好），退回截取前 60 行
  if (keyLines.length < 5) {
    return lines.slice(0, 60).join('\n');
  }
  
  return keyLines.join('\n');
};

/**
 * 对简历进行摘要压缩，保留核心经历和技能
 * 用于非首轮面试 & 收尾阶段，减少 token 消耗
 */
export const summarizeResume = (resume: string): string => {
  const lines = resume.split('\n').map(l => l.trim()).filter(Boolean);
  
  const keyPatterns = [
    /姓名|name|联系|contact|电话|phone|邮箱|email/i,
    /教育|学历|education|university|学校/i,
    /工作经历|经验|experience|employment|career/i,
    /项目|project/i,
    /技能|技术|skill|技术栈|proficiency/i,
    /成果|业绩|achievement|result|贡献/i,
    /荣誉|奖项|award|certification|证书/i,
  ];
  
  const keyLines: string[] = [];
  let isInKeySection = false;
  let sectionLineCount = 0;
  
  for (const line of lines) {
    const isHeader = keyPatterns.some(p => p.test(line)) || /^[#\-\*•]/.test(line) || /[:：]$/.test(line);
    
    if (isHeader) {
      isInKeySection = true;
      sectionLineCount = 0;
      keyLines.push(line);
    } else if (isInKeySection) {
      sectionLineCount++;
      if (sectionLineCount <= 6) {
        keyLines.push(line);
      }
      if (line === '' || sectionLineCount > 6) {
        isInKeySection = false;
      }
    } else {
      // 保留含关键信息的行
      const hasKeyword = /年|负责|主导|开发|设计|管理|优化|提升|增长|\d+%/i.test(line);
      if (hasKeyword) {
        keyLines.push(line);
      }
    }
  }
  
  if (keyLines.length < 5) {
    return lines.slice(0, 60).join('\n');
  }
  
  return keyLines.join('\n');
};

// ==================== 对话历史智能摘要 ====================

/**
 * 构建对话历史 context：前 N-6 轮摘要 + 最近 6 轮原文
 * 解决了粗暴截断导致的信息丢失问题
 */
export const buildHistoryContext = (
  conversationHistory: Array<{role: string, content: string}>,
  maxRecentPairs: number = 6,
  isInterviewerView: boolean = true
): string => {
  if (conversationHistory.length === 0) return '';

  const selfLabel = isInterviewerView ? '你（面试官）' : '你';
  const otherLabel = isInterviewerView ? '候选人' : '面试官';

  // 每 2 条消息为一对（面试官 + 候选人）
  const totalMessages = conversationHistory.length;
  const recentStartIndex = Math.max(0, totalMessages - maxRecentPairs * 2);

  let context = '\n## 面试对话记录\n';

  // 前面的轮次：生成摘要
  if (recentStartIndex > 0) {
    const earlierMessages = conversationHistory.slice(0, recentStartIndex);
    context += '\n### 早期对话摘要\n';
    context += '以下是面试早期阶段的关键信息（非原文，已提炼要点）：\n';

    for (let i = 0; i < earlierMessages.length; i += 2) {
      const questionMsg = earlierMessages[i];
      const answerMsg = earlierMessages[i + 1];
      const roundNum = Math.floor(i / 2) + 1;

      // 提取问题核心（取前 50 字）
      const questionSummary = questionMsg?.content
        ? questionMsg.content.substring(0, 50).replace(/\n/g, ' ') + (questionMsg.content.length > 50 ? '...' : '')
        : '';

      // 提取回答关键点（取前 80 字）
      const answerSummary = answerMsg?.content
        ? answerMsg.content.substring(0, 80).replace(/\n/g, ' ') + (answerMsg.content.length > 80 ? '...' : '')
        : '';

      context += `\n**第${roundNum}轮**：`;
      if (questionSummary) context += `问：${questionSummary}`;
      if (answerSummary) context += `\n答：${answerSummary}`;
      context += '\n';
    }

    context += '\n### 最近对话（原文）\n';
  }

  // 最近的轮次：保留原文
  const recentMessages = conversationHistory.slice(recentStartIndex);
  for (const item of recentMessages) {
    const role = item.role === 'interviewer' ? selfLabel : otherLabel;
    // 最近轮次保留更多内容
    const content = item.content.length > 600 ? item.content.substring(0, 600) + '...' : item.content;
    context += `\n**${role}**: ${content}\n`;
  }

  return context;
};

// ==================== AI 候选人一致性保障 ====================

/**
 * 从对话历史中提取候选人做出的关键承诺/声明
 * 用于注入到后续轮次的候选人 prompt 中，确保前后一致
 */
export const extractCandidateCommitments = (
  conversationHistory: Array<{role: string, content: string}>
): string => {
  const candidateResponses = conversationHistory
    .filter(item => item.role === 'interviewee')
    .map(item => item.content);

  if (candidateResponses.length === 0) return '';

  // 关键词检测：薪资相关
  const salaryKeywords = ['薪资', '薪酬', 'base', 'Base', 'total', 'Total', '年薪', '月薪', '万', 'k', 'K', '涨幅', '期望', '底线', '目前'];
  const timeKeywords = ['到岗', '入职', '交接', '离职', '月', '周'];
  const offerKeywords = ['offer', 'Offer', '其他机会', '其他公司', '竞争'];

  let commitments = '';

  for (const response of candidateResponses) {
    const lines = response.split(/[。！？\n]/);
    const salaryLines: string[] = [];
    const timeLines: string[] = [];
    const offerLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.length < 5) continue;

      if (salaryKeywords.some(kw => trimmed.includes(kw))) {
        salaryLines.push(trimmed);
      }
      if (timeKeywords.some(kw => trimmed.includes(kw))) {
        timeLines.push(trimmed);
      }
      if (offerKeywords.some(kw => trimmed.includes(kw))) {
        offerLines.push(trimmed);
      }
    }

    if (salaryLines.length > 0) {
      commitments += '\n**你之前提到的薪资相关信息**：\n';
      // 只保留最新的几条（避免太长）
      salaryLines.slice(-3).forEach(line => {
        commitments += `- "${line}"\n`;
      });
    }
    if (timeLines.length > 0) {
      commitments += '\n**你之前提到的到岗时间**：\n';
      timeLines.slice(-2).forEach(line => {
        commitments += `- "${line}"\n`;
      });
    }
    if (offerLines.length > 0) {
      commitments += '\n**你之前提到的其他 Offer 情况**：\n';
      offerLines.slice(-2).forEach(line => {
        commitments += `- "${line}"\n`;
      });
    }
  }

  if (!commitments) return '';

  return `
# 【关键】你在前面对话中做出的承诺（必须保持一致！）
以下是你在之前的对话中说过的关键信息。在后续回答中，你**必须**和这些信息保持完全一致，不能自相矛盾。
${commitments}
**严格禁止**：给出和上述信息矛盾的数字或说法。如果面试官追问，你可以补充细节，但核心数据不能变。
`;
};

// ==================== 问题多样性指令 ====================

export const generateDiversityInstructions = (resume: string): string => {
  const resumeHash = hashString(resume);
  const history = getLocalInterviewHistory(resumeHash);

  if (history.length === 0) return '';

  const recentQuestions: string[] = [];
  const recentExperiences: string[] = [];

  for (const record of history.slice(0, 3)) {
    recentQuestions.push(...record.questionsAsked);
    recentExperiences.push(...record.experiencesCovered);
  }

  const uniqueQuestions = [...new Set(recentQuestions)].slice(0, 15);
  const uniqueExperiences = [...new Set(recentExperiences)].slice(0, 10);

  if (uniqueQuestions.length === 0 && uniqueExperiences.length === 0) return '';

  return `
# 【重要】问题多样性要求（重复率控制在35%以内）
该候选人已进行过 ${history.length} 次模拟面试。为保证练习效果，请遵循以下规则：

## 避免重复的问题方向（之前已问过）
${uniqueQuestions.length > 0 ? uniqueQuestions.map(q => `- ${q}`).join('\n') : '- 暂无'}

## 已深挖过的项目/经历关键词
${uniqueExperiences.length > 0 ? uniqueExperiences.map(e => `- ${e}`).join('\n') : '- 暂无'}

## 本次面试请尝试
1. **选择不同的项目/经历深挖**：从简历中选择上面未列出的项目或经历进行提问
2. **使用不同的切入角度**：
   - 如果之前问了"结果"，这次可以问"过程"或"挑战"
   - 如果之前问了"做了什么"，这次可以问"为什么这么做"或"学到了什么"
   - 如果之前问了技术细节，这次可以问业务价值或团队协作
3. **创新问题形式**：
   - 情景假设题："如果...你会怎么做？"
   - 对比分析题："A方案和B方案你会选哪个？为什么？"
   - 反思复盘题："如果重来一次，你会做什么不同的决定？"

**切记**：不要照搬上面列出的已问过的问题，要创造性地提出新问题！
`;
};

// ==================== 统一面试官 Prompt 构建 ====================

interface InterviewerPromptParams {
  jobDescription: string;
  resume: string;
  currentRound: number;
  totalRounds: number;
  phase: string;
  interviewerRole: InterviewerRole;
  conversationHistory: Array<{role: string, content: string}>;
  isInteractiveMode: boolean;
  supplementInfo?: InterviewSupplementInfo;
  /** 人机交互后续轮：包含用户刚才的回答 */
  userAnswer?: string;
  /** 是否为首轮（首轮无需点评） */
  isFirstRound?: boolean;
}

/**
 * 统一的面试官 Prompt 构建函数
 * 取代原来的 getInterviewerPrompt + getInterviewerFeedbackPrompt
 */
export const buildInterviewerPrompt = (params: InterviewerPromptParams): string => {
  const {
    jobDescription, resume, currentRound, totalRounds, phase,
    interviewerRole, conversationHistory, isInteractiveMode,
    supplementInfo, userAnswer, isFirstRound = false
  } = params;

  const roleConfig = ROLE_CONFIG[interviewerRole];
  const isFollowUp = isInteractiveMode && !isFirstRound && userAnswer;

  // 1. 角色人设
  let prompt = roleConfig.systemInstruction;

  // 2. 面试官知识背景
  prompt += `

# 面试官知识背景
请仔细阅读下方的岗位 JD，根据 JD 内容推断你作为面试官的知识背景：
1. **你的专业领域**：基于 JD 中描述的岗位职责和所属部门，推断你擅长的领域（如：商业化、产品、运营、技术等）
2. **你的知识边界**：你只深入了解 JD 相关的业务领域，对于 JD 未涉及的技术细节（如底层算法、模型训练、数据工程等）只有表面了解
3. **提问原则**：
   - 你的问题应该聚焦于 JD 中明确提到的职责和能力要求
   - 如果 JD 是商业化/BD/GTM 方向，你不应该问太深入的技术实现细节
   - 如果 JD 是研发/算法方向，你可以深入问技术细节
   - 如果候选人提到了你不太了解的技术细节，你可以追问"这个对业务有什么帮助"而不是继续深挖技术`;

  // 3. 面试风格
  const styleDescriptions: Record<string, string> = {
    standard: "保持专业、客观的态度，既要考察能力也要让候选人感到尊重",
    pressure: "适当施加压力，追问细节，考察候选人在压力下的表现",
    friendly: "营造轻松友好的氛围，以对话的方式了解候选人"
  };
  prompt += section('面试风格', isFollowUp
    ? ({ standard: '给出客观、专业的点评', pressure: '指出不足之处，追问细节', friendly: '以鼓励为主，温和地提出改进建议' })[roleConfig.style] || ''
    : styleDescriptions[roleConfig.style]);

  // 4. JD + 简历（首轮注入完整版，后续轮次/收尾使用摘要版以节省 token）
  const useFullContext = isFirstRound || currentRound <= 2;
  const isClosing = phase === 'closing';

  if (isClosing) {
    // 收尾阶段：不注入 JD/简历，面试官已充分了解候选人
    prompt += `\n# 岗位与候选人信息\n（你已在前面轮次充分了解了岗位 JD 和候选人简历，收尾阶段不再重复。请基于之前的对话记忆进行收尾。）\n`;
  } else if (useFullContext) {
    // 首轮/第二轮：注入完整 JD 和简历
    prompt += `\n# 岗位JD（职位描述）\n${codeBlock(jobDescription)}\n`;
    prompt += `\n# 候选人简历\n${codeBlock(resume)}\n`;
  } else {
    // 中间轮次：注入摘要版
    prompt += `\n# 岗位JD（核心摘要）\n${codeBlock(summarizeJD(jobDescription))}\n`;
    prompt += `\n# 候选人简历（核心摘要）\n${codeBlock(summarizeResume(resume))}\n`;
  }

  // 5. 补充信息（纯模拟 + TA/HRBP 才注入）
  const shouldShowSupplement = !isInteractiveMode &&
    (interviewerRole === 'ta' || interviewerRole === 'hrbp') &&
    supplementInfo &&
    (supplementInfo.currentSalary || supplementInfo.expectedSalary || supplementInfo.availableTime || supplementInfo.otherInfo);

  if (shouldShowSupplement) {
    prompt += `
# 候选人补充信息（仅用于纯模拟模式的背景知识）
${supplementInfo!.currentSalary ? `- 当前薪资结构：${supplementInfo!.currentSalary}` : ''}
${supplementInfo!.expectedSalary ? `- 期望薪资范围：${supplementInfo!.expectedSalary}` : ''}
${supplementInfo!.availableTime ? `- 最快到岗时间：${supplementInfo!.availableTime}` : ''}
${supplementInfo!.otherInfo ? `- 其他信息：${supplementInfo!.otherInfo}` : ''}

**谈薪环节指导**：
1. 在面试接近尾声时，自然地过渡到薪资/到岗话题
2. 先通过提问了解候选人的期望，再给出你的反馈
3. 一般 30% 左右的涨幅是市场上的合理跳槽诉求
4. 可以模拟真实的谈判场景，尝试了解候选人的期望和优先级
5. **重要**：你看到的候选人薪资信息是真实情况，但你要假装不知道。通过提问自然获取信息，不要直接暴露你已知道对方底牌
`;
  }

  // 6. 面试进度
  prompt += `\n# 当前面试进度\n- 当前轮次: 第 ${currentRound} 轮 / 共 ${totalRounds} 轮\n- 当前阶段: ${phase}`;

  // 7. 阶段指导
  const phaseDescriptions: Record<string, string> = {
    opening: `这是面试开场阶段。请：
- 简短介绍自己（你是${roleConfig.title}）
- 简要说明本轮面试的重点
- 用一个轻松的开场问题让候选人自我介绍`,

    basic: `这是基础了解阶段。围绕你的核心使命中的前几个重点进行提问。
参考问题：
${roleConfig.typicalQuestions.slice(0, 3).map(q => `- ${q}`).join('\n')}`,

    professional: `这是深入考察阶段。围绕你的核心使命深入挖掘。
参考问题：
${roleConfig.typicalQuestions.slice(3, 6).map(q => `- ${q}`).join('\n')}`,

    scenario: `这是场景/压力测试阶段。请：
- 提出与岗位相关的实际工作场景问题
- 考察候选人的问题解决能力和思维方式
- 可以追问候选人的思考过程`,

    closing: `这是收尾阶段（反问环节）。

${roleConfig.closingGuidance.interviewerGuide}

你的任务：
1. 询问候选人"你有什么问题想问我的吗？"或类似的开放式邀请
2. 针对候选人的问题，结合岗位（JD）和候选人背景（简历）给出真实、有价值的回答
3. 可以适当虚构一些合理的团队/业务细节来丰富回答
4. 回答后感谢候选人的时间

候选人可能会问的方向：
${roleConfig.closingGuidance.candidateQuestionTopics.map(t => `- ${t}`).join('\n')}

注意：
- 不要提及具体面试轮次信息、后续流程、Offer、Hiring Committee等内容
- 回答要结合JD中的实际业务场景，不要给出过于笼统的套话`
  };

  if (isFollowUp) {
    const phaseGuidance: Record<string, string> = {
      opening: '当前是开场阶段，点评后继续用轻松的方式深入了解候选人。',
      basic: '当前是基础了解阶段，围绕你的核心关注点进行初步探查。',
      professional: '当前是深入考察阶段，可以追问细节、要求数据支撑。',
      scenario: '当前是场景测试阶段，可以给出假设场景考察应变能力。',
      closing: `当前是收尾阶段。${roleConfig.closingGuidance.interviewerGuide}\n请询问候选人是否有想问的问题。`
    };
    prompt += `\n- **阶段指导**: ${phaseGuidance[phase] || phaseGuidance.basic}`;
  }

  // 8. 对话历史（智能摘要）
  prompt += buildHistoryContext(conversationHistory, 6, true);

  // 9. 人机交互额外指导
  if (isInteractiveMode && !isFollowUp) {
    prompt += `

# 人机交互模式特别说明
这是真实用户在回答问题。你需要：
1. 仔细阅读用户的回答，理解其内容和质量
2. 根据用户回答的内容自然地追问或转换话题
3. 如果用户回答得好，可以适当肯定；如果回答不够完整，可以追问
4. 保持对话的连贯性和自然性，就像真实面试一样`;
  }

  // 10. 用户回答（人机交互后续轮）
  if (isFollowUp && userAnswer) {
    prompt += `\n\n# 候选人刚才的回答\n${codeBlock(userAnswer)}`;
  }

  // 11. 多样性指令
  prompt += generateDiversityInstructions(resume);

  // 12. 阶段描述（非 followUp 模式）
  if (!isFollowUp) {
    prompt += section('本轮要求', phaseDescriptions[phase] || phaseDescriptions.basic);
  }

  // 13. 节奏控制 + 输出要求
  if (isFollowUp) {
    prompt += `\n${PACE_CONTROL.feedback}\n\n# 点评风格\n${({ standard: '给出客观、专业的点评', pressure: '指出不足之处，追问细节', friendly: '以鼓励为主，温和地提出改进建议' })[roleConfig.style] || ''}\n\n${PACE_CONTROL.feedbackOutputRules}`;
  } else {
    prompt += `\n${PACE_CONTROL.interviewer}\n\n${PACE_CONTROL.outputRules}`;
  }

  return prompt;
};

// ==================== AI 候选人 Prompt 构建 ====================

export const buildIntervieweePrompt = (
  resume: string,
  jobDescription: string,
  conversationHistory: Array<{role: string, content: string}>,
  interviewerRole: InterviewerRole,
  currentPhase: string,
  supplementInfo?: InterviewSupplementInfo
): string => {
  const roleConfig = ROLE_CONFIG[interviewerRole];

  // 对话历史（候选人视角）
  const historyContext = buildHistoryContext(conversationHistory, 6, false);

  // 一致性保障：提取候选人之前的关键承诺
  const commitments = extractCandidateCommitments(conversationHistory);

  // 收尾阶段的反问指导
  const closingGuidance = currentPhase === 'closing' ? `

# 【重要】收尾阶段 - 反问环节
面试官现在邀请你提问。作为一个优秀的候选人，你应该：

1. **提出1-2个高质量问题**，展示你对岗位的认真思考
2. **问题要结合具体场景**，而不是泛泛而谈的套话

## 本轮面试官角色：${roleConfig.name}（${roleConfig.title}）

## 推荐提问方向
${roleConfig.closingGuidance.candidateQuestionTopics.map(t => `- ${t}`).join('\n')}

## 示例高质量问题（供参考，需结合实际 JD 和简历调整）
${roleConfig.closingGuidance.exampleQuestions.map(q => `- "${q}"`).join('\n')}

## 避免问的问题
${roleConfig.closingGuidance.avoidQuestions.map(q => `- ${q}`).join('\n')}

## 输出格式
先表达感谢，然后提出你的问题。示例：
"感谢您的详细介绍！我有个问题想请教：[你的问题]"

注意：
- 问题要具体，结合 JD 中的业务场景或简历中的经历来提问
- 不要问过于基础或网上能轻易查到的问题
- 展示你对这个岗位的深入思考` : '';

  const hasSupplement = supplementInfo && (supplementInfo.currentSalary || supplementInfo.expectedSalary || supplementInfo.availableTime || supplementInfo.otherInfo);

  const salarySection = hasSupplement ? `
# 你的真实情况（用于谈薪环节）
${supplementInfo!.currentSalary ? `- 当前薪资：${supplementInfo!.currentSalary}` : ''}
${supplementInfo!.expectedSalary ? `- 期望薪资：${supplementInfo!.expectedSalary}` : ''}
${supplementInfo!.availableTime ? `- 到岗时间：${supplementInfo!.availableTime}` : ''}
${supplementInfo!.otherInfo ? `- 其他：${supplementInfo!.otherInfo}` : ''}

**【重要】谈薪策略指导**：
1. **保持前后一致**：一旦你报出了一个期望数字，后续对话中必须保持一致，不要自相矛盾
2. **先了解再报价**：如果面试官问薪资期望，可以先反问"请问这个岗位的预算范围是多少？"
3. **报价策略（重要）**：
   - 可以先说"希望整体涨幅在 30% 左右"或"期望 XX 万左右"
   - 不要主动给范围！HR 会直接按下限压价
   - 给一个目标数字，如"期望 75 万左右"，而不是"70-80万"
   - 如果 HR 追问底线，可以说"希望不低于 70 万"（比真实底线高一些）
   - 真实底线（如 65 万）绝对不要透露
   - 你报出的数字必须和上面"期望薪资"信息一致
4. **强调价值**：在谈薪资的同时，强调自己能带来的价值
5. **底线策略**：你有底线，但不要轻易透露给 HRBP。如果 HRBP 反复追问，可以说"这个需要看整体 package"或"我更关注整体机会"
6. **如果有竞争 Offer**：可以适当透露以增加议价筹码，但不要编造
7. **到岗时间**：表达一定的灵活性，但也要尊重自己的实际情况

**禁止事项**：
- 禁止在对话中给出不同的数字（如先说75万，后说80万）
- 禁止直接暴露自己的底线
- 禁止表现得太急切或太强硬
` : `
# 薪资情况推理（用户未提供具体薪资信息）
用户没有填写补充薪资信息。当面试官问到薪资相关问题时，你需要根据以下线索**自行推理**出合理的薪资数据来回答。

**推理依据**（请综合考虑）：
1. **简历中的公司和职级**：不同公司（大厂/中厂/创业公司）同职级薪资差异很大
2. **工作年限**：从简历中推断工龄，结合行业薪资中位数
3. **所在城市**：简历中的工作地点影响薪资水平（北上深 > 杭州广州 > 其他）
4. **目标岗位 JD**：目标公司的薪资体系、职级和行业

**薪资参考范围**（中国互联网行业，2024-2025）：
- 大厂（字节/腾讯/阿里/美团/快手等）：应届 25-40w，3-5年 50-80w，5-8年 80-130w，8年+ 120-250w+
- 中型公司：大厂的 70-85% 左右
- 传统行业/国企：大厂的 50-70%
- 薪资结构通常为：Base × 月数 + 年终奖 + 股票/期权（如有）
- 跳槽合理涨幅：20-40%

**重要规则**：
- 在第一次被问到薪资时就**确定一个具体数字**，后续保持一致
- 不要说"我没有具体数字"或"根据市场行情"——真实面试中候选人一定知道自己的薪资
- 推理出的薪资要**具体且合理**，例如"Base 30k/月，15薪，年度 Total Cash 大约 45-50 万"
- 期望薪资在当前基础上涨 25-35% 是合理的跳槽诉求
- 到岗时间根据常规情况推理（在职通常需要 1 个月交接）

**谈薪策略**（同样适用）：
- 先反问岗位预算范围，再报出你的期望
- 给目标数字而非范围，避免被按下限压价
- 有底线但不轻易透露
- 强调自身价值，而非单纯讨价还价
`;

  // 根据对话轮次决定是否使用摘要（候选人第一次回答需完整简历，后续可用摘要）
  const roundCount = conversationHistory.filter(h => h.role === 'interviewee').length;
  const useFullResume = roundCount <= 1; // 前两轮用完整简历
  const isClosing = currentPhase === 'closing';

  const resumeContent = isClosing
    ? `（你已清楚自己的简历内容，收尾阶段不再重复。基于之前的对话进行反问。）`
    : useFullResume ? codeBlock(resume) : codeBlock(summarizeResume(resume));

  const jdContent = isClosing
    ? `（你已了解目标岗位信息，收尾阶段不再重复。）`
    : useFullResume ? codeBlock(jobDescription) : codeBlock(summarizeJD(jobDescription));

  return `# 角色设定
你是一位专业知识极其丰富的求职者，正在参加一场重要的面试。你需要基于自己的简历内容，专业、自信地回答面试官的每一个问题。

# 当前面试官信息
你正在面对的是 **${roleConfig.name}（${roleConfig.title}）**。
请根据面试官的角色调整你的回答策略：
${interviewerRole === 'ta' ? '- 这是 HR 筛选轮，重点展示求职动机、稳定性和职业规划，保持真诚自然' :
  interviewerRole === 'peers' ? '- 这是专业面试轮，需要展示项目深度和技术细节，用数据和案例支撑' :
  interviewerRole === 'leader' ? '- 这是 Leader 面试轮，重点展示方法论、成长潜力和主动性，多说"How"和"Why"' :
  interviewerRole === 'director' ? '- 这是高管面试轮，重点展示格局、行业视野和战略思维，回答要有高度' :
  '- 这是 HRBP 谈薪轮，注意薪资谈判策略，保持专业但不要暴露底线'}

# 你的简历
${resumeContent}

# 目标岗位
${jdContent}
${salarySection}
${commitments}
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
${closingGuidance}

# 输出要求
- 直接输出你的回答内容，不需要加任何角色标识
- 保持自然、专业的对话语气
- 回答长度适中，重点突出，不要过于冗长
- 如果是开场自我介绍，控制在1-2分钟的口述长度
- 如果面试官在收尾，要礼貌地表达感谢和期待`;
};

// ==================== 面试评价 Prompt 构建 ====================

export const buildSummaryPrompt = (
  jobDescription: string,
  resume: string,
  conversationHistory: Array<{role: string, content: string}>,
  isInteractiveMode: boolean,
  interviewerRole: InterviewerRole,
  supplementInfo?: InterviewSupplementInfo
): string => {
  const roleConfig = ROLE_CONFIG[interviewerRole];

  // 补充信息部分
  const supplementSection = supplementInfo && (supplementInfo.currentSalary || supplementInfo.expectedSalary || supplementInfo.availableTime || supplementInfo.otherInfo)
    ? `\n## 候选人补充信息（薪资/到岗）
${supplementInfo.currentSalary ? `- 当前薪资结构：${supplementInfo.currentSalary}` : ''}
${supplementInfo.expectedSalary ? `- 期望薪资范围：${supplementInfo.expectedSalary}` : ''}
${supplementInfo.availableTime ? `- 最快到岗时间：${supplementInfo.availableTime}` : ''}
${supplementInfo.otherInfo ? `- 其他信息：${supplementInfo.otherInfo}` : ''}
`
    : '';

  let prompt = `你是 ${roleConfig.title}，刚刚完成了一场面试。请以第一人称（"我"）的视角撰写面试评价，就像在公司内部面试系统中填写面评。

## 你的角色
${roleConfig.name}（${roleConfig.title}）

## 你的角色背景与关注点
${roleConfig.systemInstruction}

## 岗位要求（核心摘要）
${summarizeJD(jobDescription)}

## 候选人简历（核心摘要）
${summarizeResume(resume)}
${supplementSection}
## 面试记录
`;

  for (const item of conversationHistory) {
    const role = item.role === "interviewer" ? "面试官" : "面试者";
    prompt += `\n**${role}**: ${item.content}\n`;
  }

  const hasSalaryInfo = !!(supplementInfo && (supplementInfo.currentSalary || supplementInfo.expectedSalary));

  // 反问建议
  const recommendedQuestionsSection = `

===SECTION_DIVIDER===

在本轮面试结束时，以下是一些适合向 ${roleConfig.title} 提问的高质量问题。

请结合上述简历和岗位 JD，生成 5-8 个定制化的反问问题。

${roleConfig.questionGuidance}

**推荐的提问方向**
${roleConfig.closingGuidance.candidateQuestionTopics.map(t => `- ${t}`).join('\n')}

**避免的问题**
${roleConfig.closingGuidance.avoidQuestions.map(q => `- ${q}`).join('\n')}

**输出格式**（每个问题独立一段，便于阅读）：

### 问题 1
[具体问题内容]
> **提问目的**：[简短说明]

### 问题 2
[具体问题内容]
> **提问目的**：[简短说明]

...以此类推，共 5-8 个问题`;

  if (isInteractiveMode) {
    prompt += `

**注意**：这是人机交互模式的面试，面试者的回答是真实用户输入的。请基于用户的实际表现，以面试官第一人称撰写面试评价。
${roleConfig.getEvaluationDimensions(hasSalaryInfo)}
${REPORT_FORMAT_GUIDE}

请以面试官视角撰写详细、专业、具有建设性的面试评价。

**重要**：在面试评价结束后，必须单独一行输出 \`===SECTION_DIVIDER===\`，然后再输出推荐反问部分。
${recommendedQuestionsSection}`;
  } else {
    prompt += `
${roleConfig.getEvaluationDimensions(hasSalaryInfo)}
${REPORT_FORMAT_GUIDE}

请以面试官视角撰写详细、专业的面试评价。

**重要**：在面试评价结束后，必须单独一行输出 \`===SECTION_DIVIDER===\`，然后再输出推荐反问部分。
${recommendedQuestionsSection}`;
  }

  return prompt;
};
