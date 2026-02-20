
import { GoogleGenAI } from "@google/genai";
import type { InterviewMessage, InterviewSettings, InterviewMode, InterviewerRole, InterviewSupplementInfo } from '../types';

const getApiKey = () => process.env.API_KEY || process.env.GEMINI_API_KEY || '';

// 重试配置
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 2000,  // 初始等待 2 秒
  maxDelay: 10000,  // 最大等待 10 秒
};

// 带重试的延迟函数
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 判断是否为可重试的错误
const isRetryableError = (error: any): boolean => {
  const message = error?.message || '';
  const code = error?.code;
  // 503 服务不可用、429 速率限制、UNAVAILABLE 状态都可以重试
  return code === 503 || code === 429 || 
         message.includes('503') || 
         message.includes('UNAVAILABLE') ||
         message.includes('high demand') ||
         message.includes('overloaded');
};

// 带重试的流式 API 调用
async function generateContentStreamWithRetry(
  ai: GoogleGenAI,
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
      const stream = await ai.models.generateContentStream(options);
      return stream;
    } catch (error: any) {
      lastError = error;
      console.warn(`API 调用失败 (尝试 ${attempt + 1}/${RETRY_CONFIG.maxRetries}):`, error.message);
      
      if (!isRetryableError(error)) {
        throw error;  // 不可重试的错误直接抛出
      }
      
      if (attempt < RETRY_CONFIG.maxRetries - 1) {
        // 指数退避 + 随机抖动
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

// 文件数据类型
export interface FileData {
  name: string;
  data: string;
  mimeType: string;
}

// 面试官角色配置
const INTERVIEWER_ROLE_CONFIG: Record<InterviewerRole, {
  name: string;
  title: string;
  style: 'friendly' | 'standard' | 'pressure';
  focusAreas: string[];
  typicalQuestions: string[];
  guidanceNotes: string;
  // 收尾阶段：候选人反问的指导
  closingGuidance: {
    // 面试官视角：如何引导候选人提问
    interviewerGuide: string;
    // 候选人视角：推荐提问的方向
    candidateQuestionTopics: string[];
    // 示例好问题（结合具体场景）
    exampleQuestions: string[];
    // 避免问的问题
    avoidQuestions: string[];
  };
}> = {
  ta: {
    name: '第一轮/TA',
    title: 'HR/招聘专员',
    style: 'friendly',
    focusAreas: [
      '跳槽原因（社招）/ 职业规划（校招）',
      '求职意向度和动机',
      '期望薪资、到岗时间',
      '岗位级别适配度（Scope匹配）',
      '基本沟通表达能力',
      '稳定性预判（过往跳槽频率）',
      '对公司/岗位的了解程度'
    ],
    typicalQuestions: [
      '请先做一个简单的自我介绍',
      '为什么离开上一家公司？',
      '为什么对我们公司/这个岗位感兴趣？',
      '你的期望薪资是多少？',
      '最快什么时候能到岗？',
      '你对我们公司了解多少？',
      '你的职业规划是什么？'
    ],
    guidanceNotes: `作为 HR/TA，你的目标是快速筛选候选人的基本匹配度。
- 保持友好、开放的态度，让候选人放松
- 重点关注软性因素：动机、稳定性、沟通能力
- 对于硬伤（频繁跳槽、期望不匹配等）要敏锐识别
- 面试时间通常 30-45 分钟`,
    closingGuidance: {
      interviewerGuide: `作为 HR，在收尾阶段：
- 主动询问候选人是否有问题
- 可以介绍后续面试安排（如有）
- 回答关于公司文化、团队规模、工作环境等问题
- 对于薪资细节可以简要回应或表示后续会详谈`,
      candidateQuestionTopics: [
        '后续面试流程和安排',
        '这个岗位的具体职责和日常工作',
        '团队规模和组织架构',
        '岗位的核心期望和能力要求',
        '公司的培训和发展机会'
      ],
      exampleQuestions: [
        '请问接下来的面试流程是怎样的？大概需要多长时间？',
        '这个岗位目前是新设立的还是有前任？设立的背景是什么？',
        '团队目前有多少人？主要的分工是怎样的？',
        '除了JD上写的，您觉得这个岗位最看重候选人的什么特质？',
        '公司对于新员工有什么培训或 onboarding 安排吗？'
      ],
      avoidQuestions: [
        '具体薪资数字（第一轮不宜追问细节）',
        '加班强度（显得消极）',
        '竞争对手情况（HR 可能不了解）'
      ]
    }
  },
  peers: {
    name: '第二轮/Peers',
    title: '同级同事/专业面试官',
    style: 'standard',
    focusAreas: [
      '过往项目的深度和复杂度',
      '技术/专业能力硬实力',
      '项目细节（数据来源、逻辑推导、决策过程）',
      '解决问题的具体方法',
      '协作能力、沟通风格',
      '能否快速上手当前工作'
    ],
    typicalQuestions: [
      '介绍一下你最有挑战性的项目',
      '这个项目你具体负责哪些部分？',
      '这个数据是怎么得来的？能详细说说吗？',
      '遇到XX问题时你是怎么解决的？',
      '如果让你重新做这个项目，你会怎么优化？',
      '你在团队中通常扮演什么角色？',
      '说说你和同事产生分歧时是怎么处理的？'
    ],
    guidanceNotes: `作为 Peers 面试官，你的目标是验证候选人的专业能力和真实性。
- 深挖项目细节，追问具体数据和逻辑
- 对于模糊或不一致的地方要追问清楚
- 考察是否能与团队现有成员良好协作
- 可以适当挑战性追问，但保持客观
- 面试时间通常 45-60 分钟`,
    closingGuidance: {
      interviewerGuide: `作为 Peers 面试官，在收尾阶段：
- 可以分享一些团队日常工作的真实情况
- 回答关于技术栈、工作流程、协作方式的问题
- 可以适当分享自己在团队的工作体验
- 对于候选人关心的实际工作问题给予真诚回答`,
      candidateQuestionTopics: [
        '团队目前的技术栈/工具链',
        '日常工作中最大的挑战是什么',
        '与哪些团队协作最多',
        '当前亟待解决的业务/技术问题',
        '团队的工作节奏和氛围'
      ],
      exampleQuestions: [
        '团队目前用什么技术栈/工具？有什么正在推进的技术升级吗？',
        '这个岗位日常工作中，最常打交道的是哪些团队或角色？',
        '您在团队工作这段时间，觉得最有挑战的事情是什么？',
        '如果我入职的话，最希望我优先解决或上手的是什么问题？',
        '团队目前有什么痛点是希望新同事能帮忙改善的？'
      ],
      avoidQuestions: [
        '宏观战略问题（不是 peers 能回答的层面）',
        '晋升机会和薪资（显得功利）',
        '其他候选人情况（不专业）'
      ]
    }
  },
  leader: {
    name: '第三轮/+1',
    title: '直属 Leader/团队负责人',
    style: 'pressure',
    focusAreas: [
      '学习能力、成长潜力',
      '方法论和思维框架',
      '经验可迁移性',
      '主动性、Ownership',
      '抗压能力、适应变化能力',
      '团队文化适配度',
      '带人/协调资源能力（中高级）'
    ],
    typicalQuestions: [
      '从这个项目你总结了什么方法论？',
      '如果给你一个全新的领域，你会怎么快速上手？',
      '资源不足时你会怎么推进项目？',
      '说说你主动发起或推动的一件事',
      '遇到阻力时你是怎么处理的？',
      '你觉得这个岗位最重要的能力是什么？',
      '你期望在我们团队获得什么成长？'
    ],
    guidanceNotes: `作为直属 Leader，你的目标是评估候选人的成长潜力和团队适配度。
- 考察思维深度和方法论抽象能力
- 通过场景化问题测试抗压和应变能力
- 评估候选人能否融入团队文化
- 可以适当施压，考察真实反应
- 这是用人决策的关键轮次
- 面试时间通常 45-60 分钟`,
    closingGuidance: {
      interviewerGuide: `作为直属 Leader，在收尾阶段：
- 可以分享对团队未来发展的规划
- 回答关于团队文化、管理风格的问题
- 可以给候选人一些关于岗位的建议
- 适当透露对新人的期望和重点工作`,
      candidateQuestionTopics: [
        '新人入职后的期望和目标',
        '团队未来半年/一年的规划',
        '您的管理风格和带人方式',
        '我的经验和能力与岗位的匹配度',
        '团队目前最需要解决的问题'
      ],
      exampleQuestions: [
        '如果我有幸加入，您希望我在前三个月重点达成什么目标？',
        '团队未来半年到一年的重点方向是什么？我可能参与哪些项目？',
        '从今天的交流来看，您觉得我有哪些方面还需要加强？',
        '您平时是怎么带团队的？团队的沟通和协作方式是怎样的？',
        '这个岗位在团队中的定位是什么？最希望解决什么问题？'
      ],
      avoidQuestions: [
        '过于细节的执行层问题（显得格局不够）',
        '工作生活平衡（除非对方主动提及）',
        '和其他候选人的比较'
      ]
    }
  },
  director: {
    name: '第四轮/+2',
    title: 'Leader 的 Leader/总监/VP',
    style: 'standard',
    focusAreas: [
      '对行业/业务的宏观理解',
      '战略思维、大局观',
      '长期职业规划与公司发展匹配度',
      '价值观、文化认同',
      '影响力、领导潜质（中高级）',
      '对目标岗位角色的宏观理解'
    ],
    typicalQuestions: [
      '你怎么看这个行业的发展趋势？',
      '你认为这个岗位在组织中的价值是什么？',
      '5 年后你想成为什么样的人？',
      '你觉得做好这份工作最重要的是什么？',
      '说说你对我们业务的理解',
      '如果你是这个团队的负责人，你会怎么做？',
      '你有什么想问我的？'
    ],
    guidanceNotes: `作为高层管理者，你的目标是评估候选人的格局和长期潜力。
- 问题偏向宏观和战略层面
- 考察候选人的视野和格局
- 评估价值观和文化认同
- 保持威严但开放的态度
- 这是文化/战略把关的轮次
- 面试时间通常 30-45 分钟`,
    closingGuidance: {
      interviewerGuide: `作为总监/VP 级别的面试官，在收尾阶段：
- 可以分享对行业和公司发展的看法
- 回答关于公司战略、文化、愿景的问题
- 给候选人一些职业发展的建议
- 展现对优秀人才的欣赏和期待`,
      candidateQuestionTopics: [
        '行业趋势和公司战略方向',
        '部门/产品的竞争力和差异化',
        '公司文化和团队氛围',
        '对新人的期望和建议',
        '业务面临的挑战和机遇'
      ],
      exampleQuestions: [
        '您怎么看这个行业/领域未来3-5年的发展趋势？',
        '相比竞品，您认为我们的核心竞争力在哪里？',
        '您当初为什么选择这个方向/赛道？是什么吸引了您？',
        '对于即将加入团队的新人，您有什么建议吗？',
        '您觉得我们这个业务目前面临的最大挑战是什么？'
      ],
      avoidQuestions: [
        '过于细节的执行问题（浪费高管时间）',
        '敏感的商业数据和财务信息',
        '薪资谈判细节（不是这一轮的重点）'
      ]
    }
  },
  hrbp: {
    name: '第五轮/HRBP',
    title: 'HRBP/Offer 谈判官',
    style: 'pressure',
    focusAreas: [
      '薪资谈判（摸底期望和底线）',
      '到岗时间（催促尽快入职）',
      '竞争 Offer 情况（评估优先级）',
      'Offer 细节沟通（职级、福利等）',
      '特殊诉求处理（远程、WLB等）',
      '候选人决策意向'
    ],
    typicalQuestions: [
      '恭喜你通过了所有面试！我们来聊聊 Offer 的细节',
      '你目前的薪资结构是怎样的？',
      '你的期望薪资是多少？这个数字是怎么得出的？',
      '你手上还有其他 Offer 吗？分别是什么情况？',
      '最快什么时候可以入职？能否再提前一些？',
      '如果薪资和你的期望有一定差距，你会怎么考虑？',
      '除了薪资，你还有什么其他诉求吗？',
      '我需要了解你的底线，这样我才能更好地帮你向内部争取'
    ],
    guidanceNotes: `作为 HRBP，你的目标是了解候选人的薪资期望和底线，为后续内部审批做准备。

**重要：真实的 HRBP 谈判流程**：
1. HRBP 在这个阶段**不会当场确认最终薪资**，只会收集信息
2. 你会表示"需要回去和业务/薪酬委员会沟通"、"帮你争取"
3. 你的目标是摸清候选人的真实期望和底线
4. 对于候选人报的价格，你可以表示"我会尽力帮你争取"，但不要直接确认
5. 如果候选人期望过高，可以适当管理预期："这个数字可能有一定挑战，我需要和内部沟通"

**谈判技巧**：
- 先了解对方的完整薪资结构（base、奖金、股票等）
- 追问期望数字的来源和逻辑
- 了解竞争 Offer 的具体情况
- 了解候选人的优先级（现金 vs 股票、薪资 vs 级别等）
- 保持专业但有一定的谈判压力
- 最终表态是"我会把你的诉求带回去争取"

- 面试时间通常 30-45 分钟`,
    closingGuidance: {
      interviewerGuide: `作为 HRBP，在收尾阶段：
- **不要当场给出最终薪资承诺**
- 总结候选人的核心诉求（薪资期望、到岗时间、特殊需求等）
- 如果候选人不愿透露底线，不要反复追问，可以说"我理解，我会基于你的期望去争取"
- 表示会"帮候选人向内部争取"
- 明确下一步流程："我会尽快和业务/薪酬委员会沟通，争取在 X 天内给你反馈"
- 询问候选人的决策时间线`,
      candidateQuestionTopics: [
        '薪资反馈时间线',
        '五险一金缴纳基数和比例',
        '其他福利待遇（餐补、交通、房补等）',
        '工作时间和考勤制度',
        '年假安排和调休政策',
        '落户/转 Base 支持（如适用）',
        '试用期政策'
      ],
      exampleQuestions: [
        '请问大概多久能给我最终的薪资反馈？',
        '公司的五险一金是按什么基数缴纳的？公积金比例是多少？',
        '除了基本薪资，公司还有哪些福利？比如餐补、交通补贴、房补等？',
        '公司的工作时间是怎样的？是弹性工作制还是固定打卡？',
        '年假是怎么安排的？入职第一年有多少天？',
        '如果涉及到转 Base/落户，公司能提供什么支持？',
        '试用期是多长时间？试用期内薪资和福利有差异吗？',
        '我手上有其他 Offer 需要在 X 天内答复，咱们这边能赶上吗？'
      ],
      avoidQuestions: [
        '反复追问具体薪资数字（HRBP 此时还没有最终答案）',
        '询问其他候选人的情况',
        '过于强硬地下最后通牒',
        '问太多业务细节问题（这不是 HRBP 的专业领域）'
      ]
    }
  }
};

// 面试官系统提示词
const getInterviewerPrompt = (
  jobDescription: string,
  resume: string,
  currentRound: number,
  totalRounds: number,
  phase: string,
  interviewerRole: InterviewerRole,
  conversationHistory: Array<{role: string, content: string}>,
  isInteractiveMode: boolean = false,
  supplementInfo?: InterviewSupplementInfo
) => {
  const roleConfig = INTERVIEWER_ROLE_CONFIG[interviewerRole];
  
  const styleDescriptions: Record<string, string> = {
    standard: "保持专业、客观的态度，既要考察能力也要让候选人感到尊重",
    pressure: "适当施加压力，追问细节，考察候选人在压力下的表现",
    friendly: "营造轻松友好的氛围，以对话的方式了解候选人"
  };
  const styleDesc = styleDescriptions[roleConfig.style];

  const phaseDescriptions: Record<string, string> = {
    opening: `这是面试开场阶段。请：
- 简短介绍自己（你是${roleConfig.title}）
- 简要说明本轮面试的重点
- 用一个轻松的开场问题让候选人自我介绍`,
    
    basic: `这是基础了解阶段。请重点关注：
${roleConfig.focusAreas.slice(0, 3).map(f => `- ${f}`).join('\n')}`,
    
    professional: `这是深入考察阶段。请重点关注：
${roleConfig.focusAreas.slice(3).map(f => `- ${f}`).join('\n')}

参考问题：
${roleConfig.typicalQuestions.slice(2, 5).map(q => `- ${q}`).join('\n')}`,
    
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
你是一位${roleConfig.title}，正在进行${roleConfig.name}面试。

# 【重要】面试官知识背景
请仔细阅读下方的岗位 JD，根据 JD 内容推断你作为面试官的知识背景：
1. **你的专业领域**：基于 JD 中描述的岗位职责和所属部门，推断你擅长的领域（如：商业化、产品、运营、技术等）
2. **你的知识边界**：你只深入了解 JD 相关的业务领域，对于 JD 未涉及的技术细节（如底层算法、模型训练、数据工程等）只有表面了解
3. **提问原则**：
   - 你的问题应该聚焦于 JD 中明确提到的职责和能力要求
   - 如果 JD 是商业化/BD/GTM 方向，你不应该问太深入的技术实现细节
   - 如果 JD 是研发/算法方向，你可以深入问技术细节
   - 如果候选人提到了你不太了解的技术细节，你可以追问"这个对业务有什么帮助"而不是继续深挖技术

# 不同轮次面试官的关注重点
- **TA/HR（第一轮）**：关注动机、稳定性、基本匹配度，不深入专业细节
- **Peers（第二轮）**：关注专业能力和项目经验的真实性，可以追问细节
- **+1 Leader（第三轮）**：关注方法论、潜力、团队适配，问题偏向"how"和"why"
- **+2 Director（第四轮）**：关注格局、战略思维、文化认同，问题偏向宏观

# 面试官背景
${roleConfig.guidanceNotes}

# 面试风格
${styleDesc}

# 本轮核心关注点
${roleConfig.focusAreas.map(f => `- ${f}`).join('\n')}

# 典型问题参考
${roleConfig.typicalQuestions.map(q => `- ${q}`).join('\n')}

# 岗位JD（职位描述）
\`\`\`
${jobDescription}
\`\`\`

# 候选人简历
\`\`\`
${resume}
\`\`\`
${supplementInfo && (supplementInfo.currentSalary || supplementInfo.expectedSalary || supplementInfo.availableTime || supplementInfo.otherInfo) ? `
# 候选人补充信息（仅用于谈薪环节模拟）
${supplementInfo.currentSalary ? `- 当前薪资结构：${supplementInfo.currentSalary}` : ''}
${supplementInfo.expectedSalary ? `- 期望薪资范围：${supplementInfo.expectedSalary}` : ''}
${supplementInfo.availableTime ? `- 最快到岗时间：${supplementInfo.availableTime}` : ''}
${supplementInfo.otherInfo ? `- 其他信息：${supplementInfo.otherInfo}` : ''}

**谈薪环节指导**：
1. 在面试接近尾声时，自然地过渡到薪资/到岗话题
2. 先通过提问了解候选人的期望，再给出你的反馈
3. 一般 30% 左右的涨幅是市场上的合理跳槽诉求
4. 可以模拟真实的谈判场景，尝试了解候选人的期望和优先级
5. **重要**：你看到的候选人薪资信息是真实情况，但你要假装不知道。通过提问自然获取信息，不要直接暴露你已知道对方底牌
6. 对于 HRBP 轮次：你的目标是收集信息，了解候选人的期望和底线范围，表示会"帮候选人争取"
` : ''}
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
- 【重要】问题必须在你的知识领域范围内，不要问超出 JD 涉及范围的深度技术问题
- 【重要】不要提及"最后一轮"、"这是第X轮"、具体面试轮次、后续流程、Hiring Committee、Offer 等信息，这是模拟面试，不涉及真实流程`;
};

// 面试官点评提示词（人机交互模式专用）
const getInterviewerFeedbackPrompt = (
  jobDescription: string,
  resume: string,
  currentRound: number,
  totalRounds: number,
  phase: string,
  interviewerRole: InterviewerRole,
  conversationHistory: Array<{role: string, content: string}>,
  userAnswer: string,
  supplementInfo?: InterviewSupplementInfo
) => {
  const roleConfig = INTERVIEWER_ROLE_CONFIG[interviewerRole];
  
  const styleDescriptions: Record<string, string> = {
    standard: "给出客观、专业的点评",
    pressure: "指出不足之处，追问细节",
    friendly: "以鼓励为主，温和地提出改进建议"
  };
  const styleDesc = styleDescriptions[roleConfig.style];

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
你是一位${roleConfig.title}，正在进行${roleConfig.name}面试，需要对候选人的回答进行简短点评，并准备下一个问题。

# 【重要】面试官知识背景
请根据 JD 推断你的专业背景：
- 你只深入了解 JD 相关的业务领域
- 对于 JD 未涉及的技术细节（如底层算法、模型训练等），你只有表面了解
- 你的追问应该聚焦于 JD 中明确提到的职责和能力要求
- 如果候选人提到你不太了解的技术，可以追问"这对业务有什么价值"而非深挖技术细节

# 本轮核心关注点
${roleConfig.focusAreas.map(f => `- ${f}`).join('\n')}

# 岗位JD
\`\`\`
${jobDescription}
\`\`\`

# 候选人简历
\`\`\`
${resume}
\`\`\`
${supplementInfo && (supplementInfo.currentSalary || supplementInfo.expectedSalary || supplementInfo.availableTime || supplementInfo.otherInfo) ? `
# 候选人补充信息（谈薪参考）
${supplementInfo.currentSalary ? `- 当前薪资：${supplementInfo.currentSalary}` : ''}
${supplementInfo.expectedSalary ? `- 期望薪资：${supplementInfo.expectedSalary}` : ''}
${supplementInfo.availableTime ? `- 到岗时间：${supplementInfo.availableTime}` : ''}
${supplementInfo.otherInfo ? `- 其他：${supplementInfo.otherInfo}` : ''}
` : ''}
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
- 直接输出内容，不要加角色标识
- 【重要】下一个问题必须在你的知识领域范围内，不要问超出 JD 涉及范围的深度技术问题`;
};

// 面试者系统提示词（纯模拟模式）
const getIntervieweePrompt = (
  resume: string,
  jobDescription: string,
  conversationHistory: Array<{role: string, content: string}>,
  interviewerRole: InterviewerRole = 'peers',
  currentPhase: string = 'professional',
  supplementInfo?: InterviewSupplementInfo
) => {
  const roleConfig = INTERVIEWER_ROLE_CONFIG[interviewerRole];
  
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
${supplementInfo && (supplementInfo.currentSalary || supplementInfo.expectedSalary || supplementInfo.availableTime || supplementInfo.otherInfo) ? `
# 你的真实情况（用于谈薪环节）
${supplementInfo.currentSalary ? `- 当前薪资：${supplementInfo.currentSalary}` : ''}
${supplementInfo.expectedSalary ? `- 期望薪资：${supplementInfo.expectedSalary}` : ''}
${supplementInfo.availableTime ? `- 到岗时间：${supplementInfo.availableTime}` : ''}
${supplementInfo.otherInfo ? `- 其他：${supplementInfo.otherInfo}` : ''}

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
` : ''}
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
  supplementInfo?: InterviewSupplementInfo;
}

// 运行模拟面试（纯模拟模式）
export const runInterview = async (
  resume: string,
  jobDescription: string,
  settings: InterviewSettings,
  callbacks: InterviewCallbacks,
  abortSignal?: AbortSignal,
  supplementInfo?: InterviewSupplementInfo
) => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  const conversationHistory: Array<{role: string, content: string}> = [];
  const { totalRounds, interviewerRole } = settings;

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
        interviewerRole,
        conversationHistory,
        false,
        supplementInfo
      );

      let interviewerResponse = '';
      try {
        const stream = await generateContentStreamWithRetry(ai, {
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

      const intervieweePrompt = getIntervieweePrompt(resume, jobDescription, conversationHistory, interviewerRole, phase, supplementInfo);

      let intervieweeResponse = '';
      try {
        const stream = await generateContentStreamWithRetry(ai, {
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

    const summaryPrompt = buildSummaryPrompt(jobDescription, resume, conversationHistory, false, interviewerRole, supplementInfo);
    
    let summaryContent = '';
    try {
      const stream = await generateContentStreamWithRetry(ai, {
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
  abortSignal?: AbortSignal,
  supplementInfo?: InterviewSupplementInfo
): Promise<InteractiveInterviewState | null> => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  const { totalRounds, interviewerRole } = settings;
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
    interviewerRole,
    conversationHistory,
    true,
    supplementInfo
  );

  let interviewerResponse = '';
  try {
    const stream = await generateContentStreamWithRetry(ai, {
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
    isComplete: false,
    supplementInfo
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
  
  const { resume, jobDescription, settings, conversationHistory, currentRound, supplementInfo } = state;
  const { totalRounds, interviewerRole } = settings;

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

    const summaryPrompt = buildSummaryPrompt(jobDescription, resume, conversationHistory, true, interviewerRole, supplementInfo);
    
    let summaryContent = '';
    try {
      const stream = await generateContentStreamWithRetry(ai, {
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
    interviewerRole,
    conversationHistory,
    userAnswer,
    supplementInfo
  );

  let interviewerResponse = '';
  try {
    const stream = await generateContentStreamWithRetry(ai, {
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
  isInteractiveMode: boolean = false,
  interviewerRole: InterviewerRole = 'peers',
  supplementInfo?: InterviewSupplementInfo
) => {
  const roleConfig = INTERVIEWER_ROLE_CONFIG[interviewerRole];
  
  // 补充信息部分（如果有）
  const supplementSection = supplementInfo && (supplementInfo.currentSalary || supplementInfo.expectedSalary || supplementInfo.availableTime || supplementInfo.otherInfo) 
    ? `\n## 候选人补充信息（薪资/到岗）
${supplementInfo.currentSalary ? `- 当前薪资结构：${supplementInfo.currentSalary}` : ''}
${supplementInfo.expectedSalary ? `- 期望薪资范围：${supplementInfo.expectedSalary}` : ''}
${supplementInfo.availableTime ? `- 最快到岗时间：${supplementInfo.availableTime}` : ''}
${supplementInfo.otherInfo ? `- 其他信息：${supplementInfo.otherInfo}` : ''}
`
    : '';
  
  let prompt = `请根据以下面试记录，给出详细的面试评估报告。

## 面试类型
${roleConfig.name}（${roleConfig.title}）

## 本轮面试核心关注点
${roleConfig.focusAreas.map(f => `- ${f}`).join('\n')}

## 岗位要求
${jobDescription}

## 候选人简历
${resume}
${supplementSection}
## 面试记录
`;
  
  for (const item of conversationHistory) {
    const role = item.role === "interviewer" ? "面试官" : "面试者";
    prompt += `\n**${role}**: ${item.content}\n`;
  }

  // 根据面试官角色定制评估维度
  // 如果有补充信息，TA角色需要额外评估薪资谈判
  const hasSalaryInfo = supplementInfo && (supplementInfo.currentSalary || supplementInfo.expectedSalary);
  
  const roleEvaluationDimensions: Record<InterviewerRole, string> = {
    ta: `
请从以下维度进行评估（HR/TA 视角）：
1. **求职动机与稳定性** - 跳槽原因是否合理，稳定性预判
2. **意向度匹配** - 候选人对岗位/公司的了解和兴趣程度
3. **沟通表达能力** - 表达是否清晰、有条理
4. **薪资与级别匹配** - 期望是否与岗位匹配
5. **基本素质评估** - 职业素养、态度等软性因素
6. **是否推荐进入下一轮** - 明确给出是/否及理由
${hasSalaryInfo ? `
### 💰 薪资谈判专项评估（重要）
基于候选人提供的薪资信息，请额外评估：
1. **期望薪资合理性** - 结合当前薪资、市场行情和岗位要求，评估涨幅是否合理（一般 30% 左右是合理的跳槽诉求）
2. **谈判策略表现** - 候选人在谈薪过程中的表达技巧、心态和策略
3. **议价空间分析** - 基于对话内容，分析公司可以争取的空间
4. **建议定薪范围** - 综合以上因素，给出建议的 Offer 薪资范围
5. **谈薪建议** - 给候选人的谈薪策略改进建议` : ''}`,
    
    peers: `
请从以下维度进行评估（Peers 专业面视角）：
1. **技术/专业能力** - 硬实力与岗位需求的匹配度
2. **项目经验深度** - 对过往项目的理解深度和真实性
3. **问题解决能力** - 遇到问题时的思路和方法
4. **协作与沟通** - 团队协作能力和沟通风格
5. **上手速度预估** - 能否快速融入当前工作
6. **综合评分与建议** - 打分（满分10分）及改进建议`,
    
    leader: `
请从以下维度进行评估（直属 Leader +1 视角）：
1. **学习能力与潜力** - 成长空间和学习速度
2. **方法论与思维框架** - 是否有系统化的思维方式
3. **主动性与 Ownership** - 是否具备主动推动事情的能力
4. **抗压与适应能力** - 面对压力和变化的应对能力
5. **团队文化适配** - 是否适合团队氛围和文化
6. **综合评估与录用建议** - 是否推荐录用及理由`,
    
    director: `
请从以下维度进行评估（总监/VP +2 视角）：
1. **行业视野与大局观** - 对行业和业务的宏观理解
2. **战略思维能力** - 思考问题的高度和深度
3. **职业规划匹配度** - 个人发展与公司发展的契合度
4. **价值观与文化认同** - 是否认同公司文化和价值观
5. **领导潜质（如适用）** - 影响力和领导能力
6. **最终录用建议** - 是否推荐录用及定级建议`,

    hrbp: `
请从以下维度进行评估（HRBP Offer 谈判视角）：

### 💰 薪资谈判表现评估
1. **薪资期望表达** - 候选人是否清晰、合理地表达了期望薪资
2. **谈判策略与技巧** - 候选人的谈判方式是否得当（如先了解对方范围、强调价值等）
3. **心态与情绪管理** - 面对压价时是否保持冷静和专业
4. **底线把控能力** - 是否有明确的底线，同时保持适度灵活

### ⏰ 到岗时间博弈评估
5. **时间表达合理性** - 给出的到岗时间是否合理
6. **灵活度与诚意** - 是否展现了一定的灵活性和入职诚意

### 🎯 整体谈判能力评估
7. **议价筹码运用** - 是否合理利用了竞争 Offer、自身优势等筹码
8. **双赢思维** - 是否在争取利益的同时考虑双方接受度
9. **决策果断性** - 面对 Offer 时的决策效率和明确性

### 📊 给候选人的谈薪建议
基于本次模拟，给出具体的改进建议：
- 哪些地方表现好，可以继续保持
- 哪些地方需要改进，如何改进
- 真实谈薪时的注意事项和策略建议
${hasSalaryInfo ? `
### 💡 薪资匹配度分析
基于候选人提供的信息：
- 当前薪资与期望薪资的涨幅是否合理
- 市场行情下的定价建议
- 给候选人的期望调整建议（如有）` : ''}`
  };

  // 评估报告格式指导
  const reportFormatGuide = `

**评估报告输出格式要求**：

1. **报告标题**：以 "## 📝 面试评估报告" 开头

2. **基本信息**（简短一行）：
   - 候选人：XXX  面试轮次：XXX  岗位：XXX

3. **评分概览**（使用清晰的列表，每项一行）：
   每个维度占一行，格式如：
   - **维度名称**：⭐⭐⭐⭐⭐ (5/5) - 一句话简评
   
   示例：
   - **学习能力与潜力**：⭐⭐⭐⭐⭐ (5/5) - 跨专业背景转型成功，展现极强学习能力
   - **方法论与思维框架**：⭐⭐⭐⭐☆ (4/5) - 有系统化思维，但可进一步提炼

4. **详细评估分析**：每个维度用 "### 维度名称" 作为小标题，下面用段落详细分析

5. **总结与建议**：用 "### 📌 总结与建议" 作为标题

6. **排版要点**：
   - 使用 ### 作为小节标题
   - 每个段落之间空一行
   - 列表项之间不需要空行
   - 重要观点用 **加粗** 标记
`;

  // 推荐反问题库部分 - 用特殊分隔符分开，便于前端解析
  const recommendedQuestionsSection = `

===SECTION_DIVIDER===

在本轮面试结束时，以下是一些适合向 ${roleConfig.title} 提问的高质量问题。

请根据上述简历和岗位 JD 的具体内容，生成 5-8 个定制化的反问问题。

**生成要求**
1. 必须结合 JD 中的具体业务场景（如具体产品名、技术栈、业务方向等）
2. 必须结合简历中的个人经历（如过往项目经验、技能背景等）
3. 不要使用通用套话，每个问题都要有具体的切入点
4. 问题要体现对岗位的深入思考，展示候选人的专业度

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

**注意**：这是人机交互模式的面试，面试者的回答是真实用户输入的。请基于用户的实际回答进行客观评估。
${roleEvaluationDimensions[interviewerRole]}
${reportFormatGuide}

请给出详细、专业、具有建设性的评估报告。

**重要**：在评估报告结束后，必须单独一行输出 \`===SECTION_DIVIDER===\`，然后再输出推荐反问部分。
${recommendedQuestionsSection}`;
  } else {
    prompt += `
${roleEvaluationDimensions[interviewerRole]}
${reportFormatGuide}

请给出详细、专业的评估报告。

**重要**：在评估报告结束后，必须单独一行输出 \`===SECTION_DIVIDER===\`，然后再输出推荐反问部分。
${recommendedQuestionsSection}`;
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
