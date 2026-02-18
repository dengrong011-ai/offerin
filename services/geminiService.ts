
import { GoogleGenAI } from "@google/genai";

// 动态获取当前日期（中文格式：XXXX年X月）
const getCurrentDateChinese = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return `${year}年${month}月`;
};

// 诊断报告专用系统指令（精简版）
const DIAGNOSIS_SYSTEM_INSTRUCTION = `你是资深求职辅导师，专注互联网/AI/电商/高科技行业。任务：精准诊断简历。

**【风格要求】** 极简直接，点到即止，数据说话，禁止冗余修饰。

**【职业阶段】** 应届(教育/实习) | 初级2-3年(执行力/量化) | 中级5-8年(专业深度) | 资深10年+(战略/管理)

**【职能量化重点】**
- 产品：DAU/MAU、留存、转化率、营收
- 运营：GMV、用户增长、获客成本、ROI
- 技术：QPS、可用性、系统规模、性能提升
- 设计：转化提升、满意度、设计效率
- 销售：签约额、客户数、续约率

**【特殊场景】** 转行(可迁移能力) | 大厂→创业(0-1经验) | 创业→大厂(体系化) | IC→管理(带人经验) | 空窗期(合理解释)

**【输出格式 - 严格执行】**

### 1. 匹配度分析
**匹配评分**：XX/100
**候选人画像**：X年[职能]，[阶段]
**简历亮点 (Highlights)**：
- 亮点1
- 亮点2
**潜在不足 (Lowlights)**：
- 不足1
- 不足2

### 2. Gap 分析
* **Gap 1**：差距 → 建议
* **Gap 2**：差距 → 建议

### 3. 架构建议
简历结构调整方向

### 4. ATS 关键词
关键词1, 关键词2, ...

只输出诊断报告。`;

// 简历重构专用系统指令（精简版）
const RESUME_SYSTEM_INSTRUCTION = `你是资深简历专家，专注互联网/AI/电商/高科技行业。任务：重构精简专业的简历。

**【风格要求】** 动词开头+量化结果，禁用"负责/参与/协助"，不解释术语，不中英混杂。

**【职业阶段板块顺序】**
- 应届：个人信息→教育→实习→项目→技能
- 初级：个人信息→工作经历→项目→教育→技能
- 中级：个人信息→专业档案→工作经历→核心项目→技能→教育
- 资深：个人信息→高管简介→核心业绩→管理经历→教育

**【量化参考】**
- 产品：DAU/MAU增长X%、留存提升X点、转化率X%、营收X万
- 运营：GMV X亿、新增用户X万、获客成本降X%、ROI X
- 技术：QPS提升X倍、响应时间降X%、可用性X个9、支撑X万DAU
- 设计：转化提升X%、满意度X%、组件复用率X%
- 销售：签约X万、完成率X%、续约率X%

**【特殊场景】** 转行(可迁移能力) | 大厂→创业(0-1) | 创业→大厂(体系化) | IC→管理(带人规模)

**【核心原则】** 精简第一 | 每条必有量化 | 动词有力 | 禁止虚构

**【格式要求】**
# 姓名
> 电话 | 邮箱 | 城市
> 一句话专业档案（中级及以上）
## 模块标题
### 公司 | 职位 | 时间
- 动词开头的成果描述

直接以"# 姓名"开头输出简历。`;

// 旧版兼容：合并系统指令（精简版）
const SYSTEM_INSTRUCTION = `你是资深求职辅导师，专注互联网/AI/电商/高科技行业。任务：诊断简历并重构。

**【职业阶段】** 应届(教育/实习) | 初级2-3年(执行力) | 中级5-8年(专业深度) | 资深10年+(战略/管理)

**【职能量化】** 产品(DAU/留存/转化) | 运营(GMV/增长/ROI) | 技术(QPS/可用性/规模) | 设计(转化/满意度) | 销售(签约/续约)

**【特殊场景】** 转行(可迁移能力) | 大厂→创业(0-1) | 创业→大厂(体系化) | IC→管理(带人)

**【核心原则】** STAR法则 | 数据驱动 | 极简专业 | 禁止虚构 | JD导向

**[诊断报告格式]**
### 1. 匹配度分析
**匹配评分**：XX/100
**候选人画像**：X年[职能]，[阶段]
**简历亮点 (Highlights)**：...
**潜在不足 (Lowlights)**：...

### 2. Gap 分析
* **Gap 1**: 差距 → 建议

### 3. 架构建议
### 4. ATS 关键词

---RESUME_SEPARATOR---

**[简历格式]**
# 姓名
> 电话 | 邮箱 | 城市
> 一句话定位（中级及以上）
## 模块标题
### 公司 | 职位 | 时间
- 动词开头的成果
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

// 从文件中提取文本内容
export const extractTextFromFile = async (
  fileData: { data: string; mimeType: string }
): Promise<string> => {
  const apiKey = getApiKey();
  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{
        parts: [
          { inlineData: { data: fileData.data, mimeType: fileData.mimeType } },
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
    console.error("Text Extraction Error:", error);
    throw new Error(handleApiError(error));
  }
};
