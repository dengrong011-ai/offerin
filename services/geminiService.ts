
import { createAIClient, type AIClient } from "./geminiProxy";
import {
  FALLBACK_AFTER_3_1_PRO,
  FALLBACK_FILE_EXTRACT,
  FALLBACK_RESUME_EDIT,
  FALLBACK_TRANSLATION,
  MODEL_PRIMARY_AUTO_REWRITE,
  MODEL_PRIMARY_DIAGNOSIS,
  MODEL_PRIMARY_FILE_EXTRACT,
  MODEL_PRIMARY_FILE_MULTIMODAL,
  MODEL_PRIMARY_RESUME_EDIT,
  MODEL_PRIMARY_TRANSLATION,
} from "./geminiModelRouting";

const RETRY_CONFIG = {
  maxRetries: 2,        // 主模型最多重试 2 次（快速失败，尽早尝试备用模型）
  baseDelay: 800,       // 初始等待 0.8 秒
  maxDelay: 3000,       // 最大等待 3 秒
  networkRetries: 3,    // 网络错误额外重试次数（不切模型）
  networkBaseDelay: 2000, // 网络错误初始等待 2 秒
  networkMaxDelay: 8000,  // 网络错误最大等待 8 秒
};

/** 生产环境不输出日志（隐藏模型名等敏感信息） */
const isDev = import.meta.env.DEV;
const devLog = (...args: any[]) => { if (isDev) console.log(...args); };
const devWarn = (...args: any[]) => { if (isDev) console.warn(...args); };

/** 3.1 主路径之后的默认候选（与 geminiModelRouting 一致） */
const DEFAULT_TAIL_AFTER_PRIMARY = [...FALLBACK_AFTER_3_1_PRO];

// 带重试的延迟函数
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

// 判断是否为可重试的错误（服务端暂时不可用）
const isRetryableError = (error: any): boolean => {
  const message = error?.message || '';
  const code = error?.code;
  if (is429Error(error)) return false; // 429 不重试同一模型，但会走 fallback
  if (isNetworkError(error)) return true; // 网络错误可重试
  return code === 503 || code === 429 ||
         message.includes('503') ||
         message.includes('UNAVAILABLE') ||
         message.includes('high demand') ||
         message.includes('overloaded') ||
         message.includes('timeout');
};

type RetryCallOptions = {
  model: string;
  contents: any[];
  config: any;
  /** 主模型之后的候选顺序（不含主模型）；缺省为 3.1 路径默认链 */
  fallbackModels?: string[];
};

// 带重试的流式 API 调用（支持模型回退；与代理 fallbackModels 同步「剩余候选」）
// 网络错误（ERR_NETWORK_CHANGED / Failed to fetch）不切模型，用更长间隔重试
export async function generateContentStreamWithRetry(
  client: AIClient,
  options: RetryCallOptions
): Promise<AsyncIterable<any>> {
  const primary = options.model;
  const tail = options.fallbackModels ?? DEFAULT_TAIL_AFTER_PRIMARY;
  const tryOrder = [primary, ...tail.filter((m) => m !== primary)];

  let lastError: Error | null = null;
  let networkRetryBudget = RETRY_CONFIG.networkRetries; // 全局网络重试预算

  for (let i = 0; i < tryOrder.length; i++) {
    const M = tryOrder[i];
    const proxyFallbacks = tryOrder.slice(i + 1);

    for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
      try {
        const stream = await client.generateContentStream({
          model: M,
          contents: options.contents,
          config: options.config,
          fallbackModels: proxyFallbacks,
        });
        return stream;
      } catch (error: any) {
        lastError = error;
        devWarn(
          `API 流式失败 (模型 ${M}, 尝试 ${attempt + 1}/${RETRY_CONFIG.maxRetries}):`,
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
          // 回退 attempt 使当前模型继续重试（不切模型）
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

    // 如果是网络错误导致的失败，不切模型直接抛出（切了也没用）
    if (lastError && isNetworkError(lastError) && networkRetryBudget <= 0) {
      break;
    }

    if (i < tryOrder.length - 1) {
      devLog(`切换候选模型: ${tryOrder[i + 1]}`);
      await delay(500);
    }
  }

  throw lastError || new Error("API 调用失败，所有模型均不可用");
}

/** 非流式 + 客户端模型链 + 代理内 fallback；职业探索等可复用 */
export async function generateContentWithRetry(
  client: AIClient,
  options: RetryCallOptions
): Promise<any> {
  const primary = options.model;
  const tail = options.fallbackModels ?? DEFAULT_TAIL_AFTER_PRIMARY;
  const tryOrder = [primary, ...tail.filter((m) => m !== primary)];

  let lastError: Error | null = null;
  let networkRetryBudget = RETRY_CONFIG.networkRetries;

  for (let i = 0; i < tryOrder.length; i++) {
    const M = tryOrder[i];
    const proxyFallbacks = tryOrder.slice(i + 1);

    for (let attempt = 0; attempt < RETRY_CONFIG.maxRetries; attempt++) {
      try {
        const response = await client.generateContent({
          model: M,
          contents: options.contents,
          config: options.config,
          fallbackModels: proxyFallbacks,
        });
        return response;
      } catch (error: any) {
        lastError = error;
        devWarn(
          `API 非流式失败 (模型 ${M}, 尝试 ${attempt + 1}/${RETRY_CONFIG.maxRetries}):`,
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

    if (lastError && isNetworkError(lastError) && networkRetryBudget <= 0) {
      break;
    }

    if (i < tryOrder.length - 1) {
      devLog(`切换候选模型: ${tryOrder[i + 1]}`);
      await delay(500);
    }
  }

  throw lastError || new Error("API 调用失败，所有模型均不可用");
}

// 动态获取当前日期（中文格式：XXXX年X月）
const getCurrentDateChinese = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return `${year}年${month}月`;
};

// 诊断报告专用系统指令（精简版）
const DIAGNOSIS_SYSTEM_INSTRUCTION = `你是资深求职辅导师，专注互联网/AI/电商/高科技行业。任务：精准诊断简历。

**【风格要求】** 极简直接，点到即止，数据说话，无需冗余修饰。

**【职业阶段】** 应届(教育/实习) | 0-2年(教育/工作) | 初级2-3年(执行力/量化) | 中级5-8年(专业深度) | 资深10年+(战略/管理)

**【职能量化重点】**
- 产品：DAU/MAU、留存、转化率、营收
- 运营：GMV、用户增长、获客成本、ROI
- 技术：QPS、可用性、系统规模、性能提升
- 设计：转化提升、满意度、设计效率
- 销售：签约额、客户数、续约率

**【特殊场景】** 转行(可迁移能力) | 大厂→创业(0-1经验) | 创业→大厂(体系化) | IC→管理(带人经验) | 空窗期(合理解释)

**【匹配度评分规则 — 严格按维度评分】**
总分 = 各维度得分之和，满分100。每个维度独立打分，不可跳过。

| 维度 | 权重 | 评分标准 |
|------|------|----------|
| 技能匹配 | 25分 | JD要求的核心技能命中率：命中90%+=23-25, 70-89%=18-22, 50-69%=12-17, <50%=0-11 |
| 经验匹配 | 25分 | 行业经验+年限+职级匹配度：完全吻合=23-25, 相近=18-22, 有差距=12-17, 明显不符=0-11 |
| 项目贴合 | 25分 | 项目工作内容与JD工作场景的关联度+深度：高度相关=23-25, 部分相关=18-22, 弱相关=12-17, 不相关=0-11 |
| 内容规范 | 25分 | 量化密度+STAR法则+格式排版：优秀=23-25, 良好=18-22, 一般=12-17, 差=0-11 |

**评分纪律**：
- 必须先逐维度打分，再求和得总分，不可先拍总分再凑子项
- 若未提供JD，技能匹配和项目贴合仅评估简历本身的竞争力水准
- 总分不应出现模糊区域——如果犹豫，回到子项逐条核实

**【输出格式 - 严格执行】**
注意：所有带冒号的标题行后必须换行，内容从新行开始。

### 1. 候选人画像
**匹配评分**：XX/100
**维度得分**：技能匹配 XX/25 | 经验匹配 XX/25 | 项目贴合 XX/25 | 内容规范 XX/25
**候选人画像**：X年[职能]，[阶段]，一句话总评
**简历亮点 (Highlights)**：
- 亮点1
- 亮点2

### 2. 潜在不足与 Gap 分析
融合各评分维度的诊断结论。每条不足用一行概括问题+建议，不要展开大段文字。格式严格如下：
- **不足标题**：一句话问题描述 → 一句话改进建议
- **不足标题**：一句话问题描述 → 一句话改进建议
- **不足标题**：一句话问题描述 → 一句话改进建议
（3-5条即可，每条控制在50字以内）

### 3. 架构建议
用编号列表，每条**严格一行**概括调整方向，禁止换行、禁止子列表、禁止用 - 展开。3-5条即可。
1. 一句话建议（不超过60字）
2. 一句话建议（不超过60字）
3. 一句话建议（不超过60字）

### 4. ATS 关键词
关键词1, 关键词2, 关键词3...（直接输出逗号分隔，不带冒号标题）

只输出诊断报告，禁止在标题冒号后直接接内容。每个板块保持简洁，点到即止。`;

// 简历重构专用系统指令（精简版）
const RESUME_SYSTEM_INSTRUCTION = `你是资深简历专家，专注互联网/AI/电商/高科技行业。任务：重构专业简历。此处「精简」指压缩套话、理顺表达与结构，**不是**删光整块板块或砍掉整节。

**【风格要求】** 动词开头+量化结果，不解释术语，不中英混杂。

**【板块顺序说明】** 下列「→」表示模块的先后；「A/B」表示两个**独立的一级模块**「## …」（如「## 工作经历」与「## 核心项目」）的推荐顺序，**不是**把两段合并成一节或把项目塞进工作经历标题下（雇佣关系下的项目仍写在对应公司条目内即可）。

**【职业阶段板块顺序】**
- 应届：个人信息→教育→实习→技能
- 0-2年（刚毕业、工作经历少）：个人信息→教育→工作经历/核心项目→技能。除非学历有明显负面影响（如非目标院校、GPA偏低、专业与岗位严重不匹配），否则学历必须靠前
- 初级2-3年：学历突出时 个人信息→教育→工作经历→技能；学历一般或负向时 个人信息→工作经历→教育→技能
- 中级：个人信息→工作经历→技能→教育
- 资深：个人信息→工作经历→技能→教育（核心业绩与管理经历写在「## 工作经历」内对应公司与条目中；勿单独新增「## 核心业绩」等与下方允许一级标题不一致的章节）

**【量化参考】**
- 产品：DAU/MAU增长X%、留存提升X点、转化率X%、营收X万
- 运营：GMV X亿、新增用户X万、获客成本降X%、ROI X
- 技术：QPS提升X倍、响应时间降X%、可用性X个9、支撑X万DAU
- 设计：转化提升X%、满意度X%、组件复用率X%
- 销售：签约X万、完成率X%、续约率X%

**【特殊场景】** 转行(可迁移能力) | 大厂→创业(0-1) | 创业→大厂(体系化) | IC→管理(带人规模)

**【核心原则】** 保持精简专业 | 动词有力 | 禁止虚构 | **量化优先**：有依据则写清数字；无依据则保留质性描述，**禁止编造**具体数字、金额或比例；若必须用占位符表示待补充指标，**仅**使用「X%」

**【内容保留】** 在真实、不虚构的前提下，**优先保留**原简历各板块（工作经历、项目、教育、技能等）的要点与条目，避免整段删除或把某一节砍到只剩标题；优化重点放在**措辞、顺序、STAR/可量化处尽量量化**，给用户留出自行补充、逐条精调的空间。

**【禁止使用的标题/关键词】**
禁止在简历中使用以下词汇作为标题或内容：核心加分项、亮点总结、优势总结、关键优势、核心竞争力总结、个人亮点、职业亮点。
简历标题只能使用：工作经历、教育背景、专业技能、个人项目、实习经历、核心项目 等常规标题。
禁止创建"专业档案"、"高管简介"、"个人简介"等独立章节，一句话档案只能放在头部 > 引用行中。

**【严格禁止】**
0. **事实性字段零修改**：公司/组织名称、任职起止时间（如"2025.06 - 至今"）、学校名称、学历学位、毕业时间、证书名称等**客观事实字段**，必须**逐字照抄**原简历，**绝对禁止**更改、"修正"或"推断"——即使你认为原始数据可能有误，也只能保留原文。优化范围仅限措辞、结构和量化，不涉及任何事实性字段。
1. 禁止添加任何注释、备注或说明性文字（如"注："、"说明："、"备注："、"*注*"等）
2. **个人项目/个人作品与任职经历分离**：若原简历已将「个人项目」「个人作品」「核心项目」「副业/独立开发/开源作品」等**单独成节**（独立 ## 一级标题），输出中**必须保留为独立一级板块**，**禁止**为统一模板而合并进「## 工作经历」。雇主任职期间的项目/业务仍写在对应**公司名**条目下作子 bullet 即可。
3. **雇佣经历**：禁止将同一套任职拆成多个并列模块（如「工作经历」与「工作经历（早期）」）；所有公司任职必须放在同一个「## 工作经历」下，按时间倒序。禁止在无原稿依据时新建与「工作经历」重复的「项目经历」「项目经验」等混乱标题来塞入本属雇佣的内容。
4. 禁止在简历条目下添加任何解释性注释（如"此项目体现..."、"此经历证明..."等）
5. 简历内容必须是纯粹的简历格式，不包含任何元说明或括号备注
6. 绝对禁止虚构任何原简历内容不存在的项目、经历、技能和数据

**【格式要求】**
# 姓名
> 电话 | 邮箱 | 城市
> 一句话专业档案（中级及以上，放在头部引用行即可，禁止再创建独立的"## 专业档案"或"## 高管简介"章节）
## 模块标题
### 公司 | 职位 | 时间
- 动词开头的成果描述

直接以"# 姓名"开头输出简历，只输出简历内容本身，不要任何额外说明。`;

export interface FileData {
  data: string;
  mimeType: string;
}

// StreamCallbacks 保留向后兼容（已拆分为 DiagnosisCallbacks + ResumeRewriteCallbacks）
export interface StreamCallbacks {
  onDiagnosisChunk: (chunk: string) => void;
  onResumeChunk: (chunk: string) => void;
  onDiagnosisComplete: (content: string) => void;
  onResumeComplete: (content: string) => void;
  onError: (error: string) => void;
}

const handleApiError = (error: any): string => {
  const errMsg = error.message || "";
  if (errMsg.includes("PAYLOAD_TOO_LARGE") || errMsg.includes("413") || errMsg.includes("FUNCTION_PAYLOAD_TOO_LARGE")) {
    return "PAYLOAD_TOO_LARGE";
  }
  if (errMsg.includes("Requested entity was not found") || errMsg.includes("404")) {
    return "ENTITY_NOT_FOUND";
  }
  if (errMsg.includes("safety") || errMsg.includes("Candidate blocked")) {
    return "SAFETY_BLOCKED";
  }
  if (errMsg.includes("429") || errMsg.includes("quota")) {
    return "QUOTA_EXCEEDED";
  }
  return errMsg || "UNKNOWN_ERROR";
};

// Vercel Serverless Function 请求体限制约 4.5MB，预留 0.5MB 给 prompt/config
const MAX_PAYLOAD_BASE64_BYTES = 3 * 1024 * 1024; // 3MB base64 数据上限

// 构建分析请求的共享上下文
const buildAnalysisContext = (
  jd: string, resume: string, aspiration: string,
  jdFile?: FileData, resumeFile?: FileData
) => {
  const simulationDate = getCurrentDateChinese();

  // 估算附件总 base64 大小，超限时降级：优先保留简历附件，丢弃 JD 附件
  const estimateBase64Size = (file?: FileData) => file ? file.data.length : 0;
  const totalSize = estimateBase64Size(jdFile) + estimateBase64Size(resumeFile);
  
  let effectiveJdFile = jdFile;
  let effectiveResumeFile = resumeFile;

  if (totalSize > MAX_PAYLOAD_BASE64_BYTES) {
    devWarn(`[buildAnalysisContext] 附件总大小 ${(totalSize / 1024 / 1024).toFixed(1)}MB 超过限制，进行降级处理`);
    if (resumeFile && jdFile) {
      // 先丢弃 JD 附件（JD 通常有文本备份）
      effectiveJdFile = undefined;
      devWarn('[buildAnalysisContext] 丢弃 JD 附件，仅保留简历附件');
      // 如果仅简历仍超限，也丢弃简历附件
      if (estimateBase64Size(resumeFile) > MAX_PAYLOAD_BASE64_BYTES) {
        effectiveResumeFile = undefined;
        devWarn('[buildAnalysisContext] 简历附件仍超限，全部降级为纯文本');
      }
    } else if (resumeFile && estimateBase64Size(resumeFile) > MAX_PAYLOAD_BASE64_BYTES) {
      effectiveResumeFile = undefined;
      devWarn('[buildAnalysisContext] 简历附件超限，降级为纯文本');
    } else if (jdFile && estimateBase64Size(jdFile) > MAX_PAYLOAD_BASE64_BYTES) {
      effectiveJdFile = undefined;
      devWarn('[buildAnalysisContext] JD 附件超限，降级为纯文本');
    }
  }
  
  const buildParts = () => {
    const parts: any[] = [];
    if (effectiveJdFile) {
      parts.push({ inlineData: { data: effectiveJdFile.data, mimeType: effectiveJdFile.mimeType } });
    }
    if (effectiveResumeFile) {
      parts.push({ inlineData: { data: effectiveResumeFile.data, mimeType: effectiveResumeFile.mimeType } });
    }
    return parts;
  };

  const baseContext = `[系统时间上下文]: 当前日期为 ${simulationDate}。请以此日期为基准计算工作年限和状态（如"至今"）。
【禁止】：在诊断报告和简历中，绝对不要出现"基于XX时间节点"、"截止XX"、"模拟时间"、"模拟日期"、"当前模拟"等时间相关描述。直接分析内容，不需要说明时间基准。
[JD 岗位描述]:
${jd || (effectiveJdFile ? '(见附件)' : '未提供')}

[用户简历]:
${resume || (effectiveResumeFile ? '(见附件)' : '未提供')}

[用户诉求]:
${aspiration || '无特定诉求'}`;

  return { buildParts, baseContext };
};

// 仅诊断（不自动触发重写，节省 token）
export interface DiagnosisCallbacks {
  onDiagnosisChunk: (chunk: string) => void;
  onDiagnosisComplete: (content: string) => void;
  onError: (error: string) => void;
}

export const analyzeResumeStream = async (
  jd: string,
  resume: string,
  aspiration: string,
  callbacks: DiagnosisCallbacks,
  jdFile?: FileData,
  resumeFile?: FileData
) => {
  const client = createAIClient('diagnosis');
  const { buildParts, baseContext } = buildAnalysisContext(jd, resume, aspiration, jdFile, resumeFile);

  const parts = buildParts();
  parts.push({ 
    text: `${baseContext}\n\n请对这份简历进行深度诊断分析。只输出诊断报告，不要输出简历。` 
  });

  try {
    const stream = await generateContentStreamWithRetry(client, {
      model: MODEL_PRIMARY_DIAGNOSIS,
      contents: [{ parts }],
      config: {
        systemInstruction: DIAGNOSIS_SYSTEM_INSTRUCTION,
        temperature: 0.3, // 低温度确保评分稳定一致
        maxOutputTokens: 4096, // 控制输出长度，避免生成过长内容拖慢速度
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ] as any
      },
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const text = chunk.text || '';
      fullContent += text;
      callbacks.onDiagnosisChunk(text);
    }
    callbacks.onDiagnosisComplete(fullContent);
    return fullContent;
  } catch (error: any) {
    devWarn("Diagnosis Stream Error:", error);
    const errMsg = handleApiError(error);
    callbacks.onError(errMsg);
    throw new Error(errMsg);
  }
};

// 全局重构（基于诊断结果，用户点击后才触发）
export interface ResumeRewriteCallbacks {
  onResumeChunk: (chunk: string) => void;
  onResumeComplete: (content: string) => void;
  onError: (error: string) => void;
}

export const rewriteResumeStream = async (
  jd: string,
  resume: string,
  aspiration: string,
  diagnosisResult: string,
  callbacks: ResumeRewriteCallbacks,
  jdFile?: FileData,
  resumeFile?: FileData
) => {
  const client = createAIClient('auto_rewrite');
  // 重构阶段：如果已有文本内容则跳过附件，避免重复传输大文件（诊断时已解析过）
  const skipFiles = !!(jd.trim() || resume.trim());
  const { buildParts, baseContext } = buildAnalysisContext(
    jd, resume, aspiration,
    skipFiles ? undefined : jdFile,
    skipFiles ? undefined : resumeFile
  );

  const parts = buildParts();
  parts.push({ 
    text: `${baseContext}

[诊断报告 - 请务必针对以下问题进行改进]:
${diagnosisResult}

请根据以上信息，特别是诊断报告中指出的问题和建议，重构一份专业简历。
**关键要求**：
1. 必须修正诊断报告中指出的所有"硬伤"
2. 必须弥补诊断报告中指出的"Gap"（能力差距）
3. 必须融入诊断报告建议的 ATS 关键词
4. 严格遵守真实性原则，不要虚构项目、经历、技能和数据；无依据需占位时**仅**使用「X%」，勿用其他占位或模糊数字
5. 禁止添加任何"注："、"说明："等注释性文字
6. **保留信息量**：优先保留原简历各板块的要点与条目，避免整段删除或把某一节砍到过短；以专业化表述与诊断修正为主，便于用户自行细改。（个人项目与任职经历分离、雇佣经历合并等结构规则以系统指令为准，勿重复发挥。）
7. **事实字段原封不动**：公司名称、任职起止时间、学校名称、学历学位等客观事实必须与原简历完全一致，严禁修改
只输出简历内容，直接以 "# 姓名" 开头，不要任何额外说明或备注。` 
  });

  try {
    const stream = await generateContentStreamWithRetry(client, {
      model: MODEL_PRIMARY_AUTO_REWRITE,
      contents: [{ parts }],
      config: {
        systemInstruction: RESUME_SYSTEM_INSTRUCTION,
        temperature: 0.3,
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ] as any
      },
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const text = chunk.text || '';
      fullContent += text;
      callbacks.onResumeChunk(text);
    }
    callbacks.onResumeComplete(fullContent);
    return fullContent;
  } catch (error: any) {
    devWarn("Resume Rewrite Stream Error:", error);
    const errMsg = handleApiError(error);
    callbacks.onError(errMsg);
    throw new Error(errMsg);
  }
};

export const translateResume = async (content: string) => {
  const client = createAIClient('translation');
  
  
  const systemInstruction = `You are an elite Resume Editor for the US/Global Tech market (Silicon Valley standards).
  Your task is to translate a Chinese resume into **extremely concise, high-impact English**.

  **CORE PHILOSOPHY: LESS IS MORE.**
  Chinese resumes tend to be narrative. English resumes must be telegraphic and punchy.
  
  **STYLE GUIDE: TIMES NEW ROMAN CLASSIC**
  The user prefers a very traditional, professional look. Ensure the Markdown structure implies a clean, classic layout.

  **STRICT RULES FOR EXTREME CONCISENESS:**
  1.  **Aggressive Condensation**: 
      -   **CUT** all filler words ("successfully", "effectively", "responsible for", "participated in", "in order to").
      -   **Start IMMEDIATELY** with a Power Verb (e.g., "Engineered", "Scaled", "Slashed", "Launched").
      -   Aim for **1 line per bullet point** where possible. Max 2 lines.

  2.  **Data & Metrics (NON-NEGOTIABLE)**:
      -   **PRESERVE ALL NUMBERS**: You must retain every single metric (e.g., "30%", "2M users", "50ms latency"). 
      -   The translation is worthless if the numbers are lost.

  3.  **Localization**:
      -   "KOL" -> "Influencers/Creators"
      -   "私域" -> "Private Traffic" or "Community"
      -   "大厂" -> "Top-tier Tech"
      -   "落地" -> "Delivered" or "Launched"

  4.  **Format Preservation**: 
      -   STRICTLY preserve the existing Markdown structure (#, ##, ###, -).
      -   Keep header format: \`# Name\` -> \`> Tel | Email | Location\`.
      -   Translate Labels: "电话"->Tel, "邮箱"->Email.

  5.  **No Fluff**: 
      -   Do not translate the sentence structure. Read the *meaning*, then rewrite it using "Verb + Metric + Context".
      -   Example: "Responsible for building the backend system which improved speed by 20%" -> "Engineered backend system, boosting performance by 20%."

  Input is a Markdown resume. Output ONLY the translated Markdown text. START DIRECTLY WITH "# Name". DO NOT ADD ANY INTRODUCTORY TEXT.`;

  const prompt = `Translate to professional, concise English:\n\n${content}`;

  try {
     const response = await generateContentWithRetry(client, {
      model: MODEL_PRIMARY_TRANSLATION,
      fallbackModels: [...FALLBACK_TRANSLATION],
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.3,
      },
    });
    return response.text || "";
  } catch (e: any) {
      devWarn("Translation Error:", e);
      throw new Error(e.message || "TRANSLATION_FAILED");
  }
}

// 音频转文字（使用 Gemini API）
export interface AudioTranscriptionCallbacks {
  onTranscribing: () => void;
  onChunk: (text: string) => void;
  onComplete: (text: string) => void;
  onError: (error: string) => void;
}

export const transcribeAudio = async (
  audioBlob: Blob,
  callbacks: AudioTranscriptionCallbacks,
  actionType: string = 'transcribe'
) => {
  const client = createAIClient(actionType);
  

  callbacks.onTranscribing();

  try {
    // 将 Blob 转换为 base64
    const arrayBuffer = await audioBlob.arrayBuffer();
    const base64Audio = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    const systemInstruction = `你是一个专业的语音转文字助手。
你的任务是将用户提供的音频准确转录为文字。

【最重要的要求 - 必须严格执行】：
无论音频是什么语言（普通话、粤语、闽南语、英语混杂中文等），只要包含中文内容，输出必须全部使用简体中文字符。
绝对禁止输出繁体中文（如：這個、對於、產品、運營、訓練等）。
必须转换为简体中文（如：这个、对于、产品、运营、训练等）。

其他要求：
1. 准确转录音频中的所有内容
2. 保持原意，不要添加或删减内容
3. 使用正确的标点符号
4. 如果音频是纯英语或其他非中文语言，则输出对应语言的文字
5. 只输出转录的文字内容，不要添加任何解释或说明`;

    const response = await generateContentStreamWithRetry(client, {
      model: MODEL_PRIMARY_FILE_MULTIMODAL,
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: audioBlob.type || 'audio/webm',
              data: base64Audio
            }
          },
          {
            text: '请将这段音频转录为文字。如果是中文，必须输出简体中文。只输出转录内容，不要添加任何其他说明。'
          }
        ]
      }],
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
      },
    });

    let fullText = '';
    for await (const chunk of response) {
      const text = chunk.text || '';
      fullText += text;
      callbacks.onChunk(text);
    }

    callbacks.onComplete(fullText);
    return fullText;
  } catch (error: any) {
    devWarn("Audio Transcription Error:", error);
    const errorMsg = handleApiError(error);
    callbacks.onError(errorMsg);
    throw new Error(errorMsg);
  }
};

/** PDF 的 base64 常以 JVBERi0 开头（对应 %PDF-）；部分环境 mime 为空时补上 */
function coalesceMimeForFileExtract(fileData: { data: string; mimeType: string }): string {
  let mime = (fileData.mimeType || '').trim();
  if (mime) return mime;
  const raw = fileData.data.replace(/\s/g, '');
  if (raw.length >= 8 && raw.startsWith('JVBERi0')) {
    return 'application/pdf';
  }
  return mime;
}

// 从文件中提取文本内容
export const extractTextFromFile = async (
  fileData: { data: string; mimeType: string },
  actionType: string = 'file_extract'
): Promise<string> => {
  const client = createAIClient(actionType);
  const mimeType = coalesceMimeForFileExtract(fileData);
  if (!mimeType) {
    throw new Error('无法识别文件类型，请使用 PDF、Word 或图片，并确保扩展名正确');
  }

  try {
    const response = await generateContentWithRetry(client, {
      model: MODEL_PRIMARY_FILE_EXTRACT,
      fallbackModels: [...FALLBACK_FILE_EXTRACT],
      contents: [{
        parts: [
          { inlineData: { data: fileData.data, mimeType: mimeType } },
          { text: "请提取这个文件中的所有文本内容，保持原有格式。只输出提取的文本，不要添加任何解释或评论。" }
        ]
      }],
      config: {
        temperature: 0.1,
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ] as any
      },
    });

    return response.text || '';
  } catch (error: any) {
    devWarn("Text Extraction Error:", error);
    throw new Error(handleApiError(error));
  }
};

// 智能精简简历内容（当超出一页时使用）
export const condenseResume = async (
  resumeMarkdown: string,
  currentPercentage: number, // 当前占用百分比，如 122
  targetPercentage: number = 95 // 目标百分比，默认 95%
): Promise<string> => {
  const client = createAIClient('resume_edit');
  

  // 计算需要精简的比例（保守一点，目标设为 93% 而不是太低）
  const safeTarget = Math.max(targetPercentage, 90); // 最少保留 90%
  const reductionNeeded = Math.ceil(((currentPercentage - safeTarget) / currentPercentage) * 100);

  const prompt = `你是一位**资深简历顾问**，擅长在保持核心竞争力的前提下精简简历篇幅。

## 任务
当前简历占用页面 **${currentPercentage}%**，需要精简到 **${safeTarget}%** 左右（需削减约 **${reductionNeeded}%** 的内容）。本功能的「精简」指删繁就简、合并重复表述、压缩 bullet，**不是**整节删除已有板块（下列「绝对禁止」另有说明）。

⚠️ **极其重要：精简幅度必须精确控制！**
- 目标是 **${safeTarget}%**，允许误差 ±3%（即 ${safeTarget - 3}%~${safeTarget + 3}%）
- **绝对不要**精简到 ${safeTarget - 8}% 以下！那样会丢失太多有价值的内容
- 每删除或压缩一条内容前，先评估：删除后是否会低于目标？如果会，就停止删除
- 宁可多保留一点内容（${safeTarget + 2}%），也不要过度删除（${safeTarget - 8}%）

## 核心策略：全局审视，精准瘦身

### 第一步：识别并删除重复内容（最优先）
- **全局扫描**整份简历，找出在不同工作经历/项目中**重复描述**的能力、技术或成果
- 例如：如果多段经历都提到"跨部门协作"、"数据分析"，只在最有说服力的那段保留
- 如果某项技能在"专业技能"里已列出，工作经历中不必再重复强调
- 合并高度相似的 bullet points（如两条都讲"提升转化率"，合并为一条最强的）

### 第二步：识别并压缩低重要性内容
- **判断标准**：对目标岗位价值较低、时间较久远、缺少量化数据的内容重要性较低
- 较早期的工作经历（5年以上前）：保留条目但将 bullet points 缩减到 1-2 条核心成果
- 通用性描述（如"具备良好沟通能力"）：直接删除或极度精简
- 过于细节的技术栈列举：只保留最核心的 3-5 项
- 没有量化结果的描述：压缩为半句话或删除

### 第三步：语言精简（补充手段）
- "负责XX系统的设计与开发" → "设计开发XX系统"
- "参与并完成了XX项目的实施" → "实施XX项目"
- 删除"等"、"以及"、"相关"、"主要"、"其中"等虚词

**注意**：执行完第一步后检查进度，如果已经接近目标（${safeTarget}%），就停止，不要继续执行后续步骤！

## ❌ 绝对禁止
- 虚构任何不存在的内容；无依据需数字占位时**仅**使用「X%」，禁止编造其他具体数字或「若干」「约」等模糊量
- 添加"核心加分项"、"亮点"、"总结"等新标题
- 改变原有的 Markdown 章节结构和层级；不得把原简历中独立的「个人项目/个人作品/核心项目」等板块合并进「工作经历」，也**不得为省篇幅整节删除**这些板块（仅允许板块内删繁就简、合并重复表述）
- 删除量化数据（如提升X%、MAU达到X）
- 删除联系方式和基本信息
- 整段删除某段工作经历（可以大幅压缩但条目必须保留）

## 原始简历

${resumeMarkdown}

## 输出要求

1. 直接输出精简后的 Markdown 简历，以 "# 姓名" 开头
2. 不要任何解释、注释或代码块包裹
3. **保持结构完整**，所有工作经历条目都要保留
4. 精简幅度精确控制在 ${reductionNeeded}% 左右，**不要过度删除**`;

  try {
    devLog(`[精简简历] 当前 ${currentPercentage}%，目标 ${targetPercentage}%，需删减 ${reductionNeeded}%`);
    
    const response = await generateContentWithRetry(client, {
      model: MODEL_PRIMARY_RESUME_EDIT,
      fallbackModels: [...FALLBACK_RESUME_EDIT],
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2, // 降低温度，让输出更稳定
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ] as any
      },
    });

    let result = response.text || '';
    
    // 清理可能的代码块包裹
    result = result.replace(/^```(?:markdown|md)?\n?/i, '').replace(/\n?```$/i, '');
    result = result.trim();
    
    // 检查精简效果
    const originalLength = resumeMarkdown.length;
    const resultLength = result.length;
    const actualReduction = Math.round((1 - resultLength / originalLength) * 100);
    
    devLog(`[精简完成] 原始 ${originalLength} 字符 → 精简后 ${resultLength} 字符，实际减少 ${actualReduction}%`);
    
    if (resultLength >= originalLength) {
      devWarn('[警告] 精简后内容没有变短，可能需要重试');
    }
    
    return result;
  } catch (error: any) {
    devWarn("Resume Condense Error:", error);
    throw new Error(handleApiError(error));
  }
};

// ============ 划取重写：AI 局部重写选中文本 ============

export type RewriteAction = 'concise' | 'quantify' | 'match_jd' | 'rewrite' | 'custom';

export interface RewriteStreamCallbacks {
  onChunk: (chunk: string) => void;
  onComplete: (fullText: string) => void;
  onError: (error: string) => void;
}

/** 流式局部重写选中的文本片段 */
export const rewriteSelectedText = async (
  selectedText: string,
  action: RewriteAction,
  customInstruction: string | undefined,
  context: {
    fullResume: string;
    jd?: string;
    diagnosis?: string;
  },
  callbacks: RewriteStreamCallbacks
) => {
  const client = createAIClient('resume_edit');

  const actionPrompts: Record<RewriteAction, string> = {
    concise: '精简整段内容，删除冗余词汇，保持核心信息和量化数据，使表达更简洁有力。',
    quantify: '为这段内容补充量化表达：若原文或上下文中已有明确数据则保留并强化。若无依据，**仅**使用「X%」作为占位符表示待补充指标；禁止编造具体数字、金额或比例，禁止使用「X」「N」「若干」「约」等除「X%」以外的任何占位或模糊写法。',
    match_jd: `根据以下JD要求，调整这段内容的关键词和表述方式，使其更匹配目标岗位：\n\n${context.jd || '（未提供JD）'}`,
    rewrite: '用更专业、有力的方式重写这段内容。动词开头，突出成果，保持简洁。',
    custom: customInstruction || '请优化这段内容。',
  };

  const quantifyExtra =
    action === 'quantify'
      ? `\n8. 【量化专项】需要数字但简历无依据时，**只**允许用「X%」占位，不得使用其他字符或文字作占位。`
      : '';

  const systemPrompt = `你是一位资深简历优化专家。用户正在逐段优化简历，你的任务是**只重写用户选中的部分**。

【核心规则】
1. 只输出重写后的文本，不要任何解释、注释或前缀
2. 保持原有的 Markdown 格式（如 "- " 开头的列表项、"### " 标题等）
3. 不要改变内容的层级结构
4. 保留所有真实的量化数据
5. 禁止虚构不存在的项目、数据或经历
6. 输出长度应与原文相近（除非用户要求精简）
7. 如果选中内容包含多个 bullet points，保持相同数量（除非要求精简）${quantifyExtra}`;

  const userPrompt = `【用户的操作指令】
${actionPrompts[action]}

【选中的文本】
${selectedText}

【完整简历上下文（仅供参考，不要修改未选中部分）】
${context.fullResume}
${context.diagnosis ? `\n【诊断报告参考】\n${context.diagnosis}` : ''}

请直接输出重写后的文本，不要任何多余说明。`;

  try {
    const stream = await generateContentStreamWithRetry(client, {
      model: MODEL_PRIMARY_RESUME_EDIT,
      fallbackModels: [...FALLBACK_RESUME_EDIT],
      contents: [{ parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: systemPrompt,
        temperature: 0.4,
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ] as any
      },
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const text = chunk.text || '';
      fullContent += text;
      callbacks.onChunk(text);
    }
    // 清理可能的代码块包裹
    fullContent = fullContent.replace(/^```(?:markdown|md)?\n?/i, '').replace(/\n?```$/i, '').trim();
    callbacks.onComplete(fullContent);
    return fullContent;
  } catch (error: any) {
    devWarn("Rewrite Selected Error:", error);
    const errMsg = handleApiError(error);
    callbacks.onError(errMsg);
    throw new Error(errMsg);
  }
};


