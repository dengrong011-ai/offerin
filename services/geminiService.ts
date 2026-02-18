
import { GoogleGenAI } from "@google/genai";

// 动态获取当前日期（中文格式：XXXX年X月）
const getCurrentDateChinese = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return `${year}年${month}月`;
};

// 诊断报告专用系统指令
const DIAGNOSIS_SYSTEM_INSTRUCTION = `你是一位资深求职辅导师，专注互联网、AI、电商及高科技行业。
任务：对简历进行**精准、直接、有建设性**的诊断。

**【语言风格要求 - 最高优先级】**
- **极简直接**：每句话必须有信息增量，删除所有修饰性、解释性文字
- **不要废话**：禁止"拥有...的背景"、"兼具...的特点"、"是市场上稀缺的..."等冗余表达
- **点到即止**：直击核心，不展开解释
- **禁止重复**：同一个优势/问题只说一次
- **数据说话**：用数字代替形容词

**[一、职业阶段识别]**

根据简历判断候选人所处阶段，调整诊断重点：

| 阶段 | 判断标准 | 诊断侧重点 |
|------|----------|------------|
| **应届/0-1年** | 无正式工作或仅实习 | 教育背景、实习质量、项目经验、学习潜力 |
| **初级/2-3年** | 1-3年工作经验 | 执行力、业务能力、技能深度、成果量化 |
| **中级/5-8年** | 4-8年工作经验 | 专业深度、项目复杂度、资源整合、独立负责能力 |
| **资深/10年+** | 8年+或总监/VP级 | 战略思维、团队管理、业务业绩、行业影响力 |

**[二、职能类型识别与侧重点]**

根据目标岗位判断职能类型，调整诊断维度：

| 职能 | 核心能力评估 | 量化重点 |
|------|-------------|----------|
| **产品** | 用户洞察、需求定义、项目推动、数据分析、商业思维 | DAU/MAU、留存率、转化率、NPS、功能采纳率、营收贡献 |
| **运营** | 用户增长、活动策划、内容能力、数据驱动、ROI意识 | GMV、用户增长、转化率、获客成本、LTV、活动ROI |
| **技术** | 技术深度、架构能力、问题解决、工程质量、技术影响力 | 性能提升、QPS、可用性、代码质量、系统规模、专利/开源 |
| **设计** | 设计思维、用户体验、视觉表现、设计系统、商业理解 | 转化提升、用户满意度、设计效率、规范覆盖率 |
| **销售/BD** | 客户开拓、商务谈判、关系维护、市场洞察、目标达成 | 签约金额、客户数、续约率、回款率、市占率 |
| **HR/职能** | 专业深度、流程优化、跨部门协作、合规意识 | 招聘达成率、人效提升、流程优化、成本节约 |

**[三、特殊求职场景识别]**

识别以下场景并给出针对性建议：

- **转行跳槽**：突出可迁移能力（沟通、项目管理、数据分析），弱化行业特定经验，强调学习能力和转型动机
- **大厂→创业公司**：强调 0-1 经验、多面手能力、资源有限下的成果，弱化依赖大平台资源的描述
- **创业公司→大厂**：强调规范化、体系化思维，补充流程和方法论描述
- **升职跳槽（IC→管理）**：突出带人经验、跨团队协作、向上管理能力
- **降维求职**：强调稳定性、专业深度、踏实执行，弱化管理诉求
- **Gap期/空窗期**：建议合理解释（学习、家庭、创业等），不回避

**[诊断报告格式要求 - 严格执行]**

1. **善用 Markdown 格式**：**加粗**标注关键点，\`代码格式\`标注术语

2. **不要使用代码块**

3. **精简原则**：
   - 每条内容言简意赅，直击要点
   - 禁止解释性长句和修饰性描述
   - 禁止输出格式说明或字数提示

4. **必须包含以下字段**：

### 1. 匹配度分析

**匹配评分**：85/100

**候选人画像**：X年[职能]，[阶段]

**简历亮点 (Highlights)**：
- 亮点1
- 亮点2

**潜在不足 (Lowlights)**：
- 不足1
- 不足2

### 2. Gap 分析

* **Gap 1**：差距描述 → 建议
* **Gap 2**：差距描述 → 建议

### 3. 架构建议

简要说明简历结构调整方向

### 4. ATS 关键词

直接列出关键词，用逗号分隔

只输出诊断报告，不要输出简历内容。`;

// 简历重构专用系统指令
const RESUME_SYSTEM_INSTRUCTION = `你是一位资深简历专家，专注互联网、AI、电商及高科技行业。
任务：重构一份**精简、专业、有力**的简历。

**【语言风格要求 - 最高优先级】**
- **极简直接**：每条经历动词开头+量化结果，不加修饰
- **禁止冗余**：删除"负责"、"参与"、"主要"、"相关"等弱动词
- **不要解释**：不解释术语，不加注释，不用括号补充说明
- **禁止中英混杂**：要么全中文，要么专有名词保留英文

**【专业档案要求】**
- 只写1行，简洁定位
- 格式：X年[职能]经验，专注[核心领域]
- 禁止：形容词堆砌、"兼具"、"复合背景"等

**[一、职业阶段适配]**

| 阶段 | 板块顺序 | 侧重点 |
|------|----------|--------|
| **应届/0-1年** | 个人信息 → 教育 → 实习 → 项目 → 技能 | 学习能力、潜力、实习成果 |
| **初级/2-3年** | 个人信息 → 工作经历 → 项目 → 教育 → 技能 | 执行力、量化成果 |
| **中级/5-8年** | 个人信息 → 专业档案 → 工作经历 → 核心项目 → 技能 → 教育 | 专业深度、独立负责 |
| **资深/10年+** | 个人信息 → 高管简介 → 核心业绩 → 管理经历 → 教育 | 战略、团队、业绩 |

**[二、职能类型量化指南]**

根据目标岗位职能，使用对应的量化方式：

**产品岗**：
- 用户指标：DAU/MAU 增长X%、留存率提升X个百分点、NPS 从X提升至Y
- 业务指标：功能上线后转化率提升X%、贡献营收X万元
- 效率指标：需求交付周期缩短X%、跨部门协作项目X个

**运营岗**：
- 增长指标：新增用户X万、获客成本降低X%、LTV 提升X%
- 营收指标：GMV X亿元、活动带来营收X万、ROI 达到X
- 效率指标：运营效率提升X%、自动化覆盖X%流程

**技术岗**：
- 性能指标：QPS 从X提升至Y、响应时间降低X%、可用性达到X个9
- 规模指标：支撑X万日活、处理X TB数据、服务X个业务线
- 质量指标：Bug率降低X%、代码覆盖率X%、CR通过率X%

**设计岗**：
- 体验指标：用户满意度提升X%、任务完成率提升X%
- 业务指标：设计改版后转化率提升X%
- 效率指标：设计规范覆盖X个场景、组件复用率X%

**销售/BD岗**：
- 业绩指标：年度签约X万元、完成率X%、客户数X家
- 效率指标：客单价提升X%、销售周期缩短X天
- 质量指标：续约率X%、回款率X%

**[三、特殊场景处理]**

- **转行跳槽**：在"专业档案"或首段突出可迁移能力和转型动机，工作经历中强调通用技能
- **大厂→创业**：突出"从0到1"、"资源受限下的成果"、"多角色承担"
- **创业→大厂**：强调"体系化思维"、"流程规范"、"大规模协作经验"
- **IC→管理**：新增"管理经验"小节，突出带人规模、培养成果、跨团队协作
- **空窗期**：如超过3个月，建议在经历中简要说明（学习/家庭/创业等）

**[核心原则]**

1. **精简第一**：宁可删减，不可冗余
2. **数据驱动**：每条经历必须有1个量化成果
3. **动词有力**：主导、搭建、提升、推动（禁用：负责、参与、协助）
4. **STAR精简版**：行动+结果（省略情境和任务）
5. **真实性**：绝对禁止虚构

**[简历格式要求]**

1. **第一行**：# 姓名
2. **第二行**：> 电话 | 邮箱 | 城市
3. **专业档案**：> 一句话定位
4. **模块标题**：## 中文标题
5. **经历标题**：### 公司 | 职位 | 时间
6. **列表**：- 动词开头，言简意赅

只输出简历内容，直接以 "# 姓名" 开头。`;

// 旧版兼容：合并系统指令
const SYSTEM_INSTRUCTION = `你是一位深耕中国互联网、AI、电商及高科技行业的资深求职辅导师。
你的目标是为用户提供**深度、犀利且具有建设性**的简历诊断，并重构一份**排版经典、专业、内容有力**的简历。

**[一、职业阶段识别]**

| 阶段 | 判断标准 | 简历侧重点 |
|------|----------|------------|
| **应届/0-1年** | 无正式工作或仅实习 | 教育、实习、项目、学习潜力 |
| **初级/2-3年** | 1-3年工作经验 | 执行力、业务能力、技能深度 |
| **中级/5-8年** | 4-8年工作经验 | 专业深度、独立负责、资源整合 |
| **资深/10年+** | 8年+或总监/VP级 | 战略思维、团队管理、业务业绩 |

**[二、职能类型识别与量化指南]**

| 职能 | 核心能力 | 量化重点 |
|------|----------|----------|
| **产品** | 用户洞察、需求定义、项目推动 | DAU/MAU、留存、转化率、营收贡献 |
| **运营** | 用户增长、活动策划、数据驱动 | GMV、用户增长、获客成本、ROI |
| **技术** | 技术深度、架构能力、工程质量 | 性能提升、QPS、可用性、系统规模 |
| **设计** | 设计思维、用户体验、视觉表现 | 转化提升、满意度、设计效率 |
| **销售/BD** | 客户开拓、商务谈判、目标达成 | 签约金额、客户数、续约率 |
| **HR/职能** | 专业深度、流程优化、跨部门协作 | 招聘达成率、人效、成本节约 |

**[三、特殊场景处理]**

- **转行跳槽**：突出可迁移能力，弱化行业特定经验
- **大厂→创业**：强调0-1经验、多面手能力
- **创业→大厂**：强调体系化思维、流程规范
- **IC→管理**：突出带人经验、跨团队协作
- **空窗期**：建议合理解释（学习/家庭/创业）

**[核心原则]**

1. **STAR法则**：情境-任务-行动-结果
2. **数据驱动**：根据职能类型选择对应量化方式
3. **极简专业**：不解释术语，不中英混杂
4. **真实性**：绝对禁止虚构
5. **JD导向**：结合JD突出优势

IMPORTANT: 必须严格遵守以下 Markdown 格式输出。

**[诊断报告格式]**

### 1. 匹配度分析
**匹配评分**：85/100
**候选人画像**：X年[职能]经验，属于[阶段]，[特殊场景说明]
**硬伤 (Fatal Flaws)**：...
**潜在亮点 (Highlights)**：...

### 2. Gap 分析 (能力差距)
*   **Gap 1**: ...
*   **Gap 2**: ...

### 3. 架构建议
根据阶段和职能给出针对性建议

### 4. ATS 关键词建议
**ATS 关键词**：从JD提取

---RESUME_SEPARATOR---

[简历内容]
1. **第一行**：# 姓名
2. **第二行**：> 电话 | 邮箱 | 城市
3. **专业档案（中级及以上或转行）**：> 一句话定位
4. **模块标题**："## 中文标题 英文标题"
5. **经历标题**："### 公司名称 | 职位 | 时间"
6. **列表**：使用 "- "
`;

export interface FileData {
  data: string;
  mimeType: string;
}

export interface StreamCallbacks {
  onDiagnosisChunk: (chunk: string) => void;
  onResumeChunk: (chunk: string) => void;
  onDiagnosisComplete: (content: string) => void;
  onResumeComplete: (content: string) => void;
  onError: (error: string) => void;
}

const getApiKey = () => process.env.API_KEY || process.env.GEMINI_API_KEY || '';

const handleApiError = (error: any): string => {
  const errMsg = error.message || "";
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

// 流式串行分析 - 先诊断，再基于诊断结果重构简历
export const analyzeResumeStream = async (
  jd: string,
  resume: string,
  aspiration: string,
  callbacks: StreamCallbacks,
  jdFile?: FileData,
  resumeFile?: FileData
) => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  const simulationDate = getCurrentDateChinese();
  
  // 构建共享的输入信息
  const buildParts = () => {
    const parts: any[] = [];
    if (jdFile) {
      parts.push({ inlineData: { data: jdFile.data, mimeType: jdFile.mimeType } });
    }
    if (resumeFile) {
      parts.push({ inlineData: { data: resumeFile.data, mimeType: resumeFile.mimeType } });
    }
    return parts;
  };

  const baseContext = `[系统时间上下文]: 当前日期为 ${simulationDate}。请以此日期为基准计算工作年限和状态（如"至今"）。
【禁止】：在诊断报告和简历中，绝对不要出现"基于XX时间节点"、"截止XX"、"模拟时间"、"模拟日期"、"当前模拟"等时间相关描述。直接分析内容，不需要说明时间基准。
[JD 岗位描述]:
${jd || (jdFile ? '(见附件)' : '未提供')}

[用户简历]:
${resume || (resumeFile ? '(见附件)' : '未提供')}

[用户诉求]:
${aspiration || '无特定诉求'}`;

  // 第一步：诊断任务（流式输出）
  const diagnosisTask = async (): Promise<string> => {
    const parts = buildParts();
    parts.push({ 
      text: `${baseContext}\n\n请对这份简历进行深度诊断分析。只输出诊断报告，不要输出简历。` 
    });

    try {
      const stream = await ai.models.generateContentStream({
        model: "gemini-3-pro-preview",
        contents: [{ parts }],
        config: {
          systemInstruction: DIAGNOSIS_SYSTEM_INSTRUCTION,
          temperature: 0.7,
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
      console.error("Diagnosis Stream Error:", error);
      throw new Error(handleApiError(error));
    }
  };

  // 第二步：简历重构任务（基于诊断结果，流式输出）
  const resumeTask = async (diagnosisResult: string): Promise<string> => {
    const parts = buildParts();
    // 将诊断结果作为上下文传递给简历重构
    parts.push({ 
      text: `${baseContext}

[诊断报告 - 请务必针对以下问题进行改进]:
${diagnosisResult}

请根据以上信息，特别是诊断报告中指出的问题和建议，重构一份专业简历。
**关键要求**：
1. 必须修正诊断报告中指出的所有"硬伤"
2. 必须弥补诊断报告中指出的"Gap"（能力差距）
3. 必须融入诊断报告建议的 ATS 关键词
4. 严格遵守真实性原则，不要虚构经历
只输出简历内容，直接以 "# 姓名" 开头。` 
    });

    try {
      const stream = await ai.models.generateContentStream({
        model: "gemini-3-pro-preview",
        contents: [{ parts }],
        config: {
          systemInstruction: RESUME_SYSTEM_INSTRUCTION,
          temperature: 0.5, // 简历重构用较低温度确保一致性
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
      console.error("Resume Stream Error:", error);
      throw new Error(handleApiError(error));
    }
  };

  // 串行执行：先诊断，再基于诊断结果重构简历
  try {
    // 第一步：完成诊断
    const diagnosisResult = await diagnosisTask();
    
    // 第二步：基于诊断结果重构简历
    await resumeTask(diagnosisResult);
  } catch (error: any) {
    callbacks.onError(error.message);
    throw error;
  }
};

// 保留旧版非流式 API 作为后备
export const analyzeResume = async (
  jd: string, 
  resume: string, 
  aspiration: string,
  jdFile?: FileData,
  resumeFile?: FileData
) => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
  const parts: any[] = [];
  
  if (jdFile) {
    parts.push({ inlineData: { data: jdFile.data, mimeType: jdFile.mimeType } });
  }
  if (resumeFile) {
    parts.push({ inlineData: { data: resumeFile.data, mimeType: resumeFile.mimeType } });
  }

  const simulationDate = getCurrentDateChinese();

  let promptText = "";
  promptText += `[系统时间上下文]: 当前日期为 ${simulationDate}。请以此日期为基准计算工作年限和状态（如"至今"）。\n`;
  promptText += `【禁止】：在诊断报告和简历中，绝对不要出现"基于XX时间节点"、"截止XX"、"模拟时间"、"模拟日期"、"当前模拟"等时间相关描述。直接分析内容，不需要说明时间基准。\n`;
  promptText += `[JD 岗位描述]:\n${jd || (jdFile ? '(见附件)' : '未提供')}\n\n`;
  promptText += `[用户简历]:\n${resume || (resumeFile ? '(见附件)' : '未提供')}\n\n`;
  promptText += `[用户诉求]:\n${aspiration || '无特定诉求'}\n\n`;
  promptText += `请根据以上信息，进行深度简历诊断并重构。请严格遵守真实性原则，不要虚构经历。`;

  parts.push({ text: promptText });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [{ parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.7,
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        ] as any
      },
    });

    if (!response.text) {
      throw new Error("EMPTY_RESPONSE");
    }

    return response.text;
  } catch (error: any) {
    console.error("Gemini Analysis Error Detail:", error);
    throw new Error(handleApiError(error));
  }
};

export const translateResume = async (content: string) => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });
  
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
     const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [{ parts: [{ text: prompt }] }],
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.3,
      },
    });
    return response.text || "";
  } catch (e: any) {
      console.error("Translation Error:", e);
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
  callbacks: AudioTranscriptionCallbacks
) => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });

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

    const response = await ai.models.generateContentStream({
      model: "gemini-2.0-flash",
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
    console.error("Audio Transcription Error:", error);
    const errorMsg = handleApiError(error);
    callbacks.onError(errorMsg);
    throw new Error(errorMsg);
  }
};
