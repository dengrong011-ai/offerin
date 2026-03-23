import { createAIClient } from './geminiProxy';
import { generateContentWithRetry, generateContentStreamWithRetry } from './geminiService';
import { MODEL_PRIMARY_CAREER_EXPLORE } from './geminiModelRouting';
import type { UserPreferences, UserProfile, DirectionRecommendation, CareerPlan, PlanTask, Phase } from '../types';

/** 画像 / 方向 流式生成时的回调（用于加载态展示，不保证逐 token） */
export type CareerExploreStreamOptions = {
  onStreamChunk?: (accumulatedText: string) => void;
  /** 流式因网络中断失败、即将自动改走非流式时调用（可更新 loading 文案） */
  onStreamFallback?: () => void;
};

/** 长连接流式易被 ERR_NETWORK_CHANGED / 断网打断；此类错误自动回退为非流式单次请求 */
function isStreamNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes('Failed to fetch') ||
    msg.includes('ERR_NETWORK') ||
    msg.includes('NETWORK_CHANGED') ||
    msg.includes('Load failed') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('aborted') ||
    msg.includes('TypeError: fetch')
  );
}

/** 代理 { text } 与 Google SDK 流式 candidates.parts 兼容 */
function extractStreamChunkText(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') return '';
  const c = chunk as Record<string, unknown>;
  const parts = (c.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined)?.[0]
    ?.content?.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    const joined = parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).join('');
    if (joined.length > 0) return joined;
  }
  if (typeof c.text === 'string') return c.text;
  return '';
}

async function collectCareerExploreStream(
  client: ReturnType<typeof createAIClient>,
  params: {
    model: string;
    contents: { role: string; parts: { text: string }[] }[];
    config: Record<string, unknown>;
  },
  onStreamChunk?: (accumulatedText: string) => void,
): Promise<string> {
  const stream = await generateContentStreamWithRetry(client, params);
  let acc = '';
  for await (const chunk of stream) {
    acc += extractStreamChunkText(chunk);
    onStreamChunk?.(acc);
  }
  return acc;
}

async function collectCareerExploreStreamOrFallback(
  client: ReturnType<typeof createAIClient>,
  params: {
    model: string;
    contents: { role: string; parts: { text: string }[] }[];
    config: Record<string, unknown>;
  },
  streamOptions?: CareerExploreStreamOptions,
): Promise<string> {
  try {
    return await collectCareerExploreStream(client, params, streamOptions?.onStreamChunk);
  } catch (e: unknown) {
    if (!isStreamNetworkError(e)) throw e;
    streamOptions?.onStreamFallback?.();
    const result = await generateContentWithRetry(client, {
      model: params.model,
      contents: params.contents,
      config: params.config,
    });
    return extractTextFromResult(result);
  }
}

function extractTextFromResult(result: unknown): string {
  if (result && typeof result === 'object' && 'text' in result && typeof (result as { text: string }).text === 'string') {
    return (result as { text: string }).text;
  }
  const r = result as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = r?.candidates?.[0]?.content?.parts?.[0]?.text;
  return typeof text === 'string' ? text : '';
}

function repairTruncatedJson(text: string): string {
  let s = text.trim();
  s = s.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  // 模型偶发先输出 "Here is..." 再输出 JSON；从首个 { 或 [ 起解析
  const jsonStart = s.search(/[\[{]/);
  if (jsonStart > 0) {
    s = s.slice(jsonStart);
  }

  try {
    JSON.parse(s);
    return s;
  } catch { /* needs repair */ }

  // Strategy: find the last position where a complete value boundary exists
  // (closing `}` or `]` not inside a string), then truncate and close.
  let lastGoodPos = -1;
  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      lastGoodPos = i;
    }
  }

  // Truncate to the last complete closing bracket/brace
  if (lastGoodPos > 0 && depth > 0) {
    s = s.substring(0, lastGoodPos + 1);
  }

  // Re-count unclosed brackets after truncation
  let openBraces = 0;
  let openBrackets = 0;
  inString = false;
  escaped = false;
  for (const ch of s) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }

  // Clean trailing partial tokens
  if (inString) s += '"';
  s = s.replace(/,\s*$/, '');

  while (openBrackets > 0) { s += ']'; openBrackets--; }
  while (openBraces > 0) { s += '}'; openBraces--; }

  return s;
}

/** 职业探索各步：空响应 / 截断 JSON 时给出可读错误，避免裸报 Unexpected end of JSON input */
function parseCareerExploreJson(text: string, stepLabel: string): unknown {
  const t = (text || '').trim();
  if (!t) {
    throw new Error(`${stepLabel}：模型未返回内容，请重试或缩短简历后再试`);
  }
  const cleaned = repairTruncatedJson(t);
  if (!cleaned.trim()) {
    throw new Error(`${stepLabel}：无法解析为 JSON，请重试`);
  }
  try {
    return JSON.parse(cleaned);
  } catch (e: any) {
    const m = e?.message || String(e);
    const detail =
      m.includes('Unexpected end of JSON input') || m.includes('end of JSON')
        ? '返回可能被截断或为空，请重试'
        : m;
    throw new Error(`${stepLabel}：${detail}`);
  }
}

function normalizeDim(raw: any): { score: number; reason: string } {
  if (raw && typeof raw === 'object' && typeof raw.score === 'number') {
    return { score: raw.score, reason: raw.reason || '' };
  }
  return { score: 0, reason: '数据缺失' };
}

/** 模型偶发把 industries/coreSkills 打成单个字符串，统一为数组 */
function coerceStringArray(raw: unknown, max: number): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map(x => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
      .filter(Boolean)
      .slice(0, max);
  }
  if (typeof raw === 'string') {
    const t = raw.trim();
    if (!t) return [];
    const parts = t.split(/[,，、;；|｜\/\n]/).map(s => s.trim()).filter(Boolean);
    return (parts.length ? parts : [t]).slice(0, max);
  }
  return [];
}

/** 年限偶发为 "6" / "6年" 字符串 */
function coerceYearsOfExperience(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.max(0, Math.round(raw));
  }
  if (typeof raw === 'string') {
    const m = raw.match(/(\d+(?:\.\d+)?)/);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n)) return Math.max(0, Math.round(n));
    }
  }
  return null;
}

/** 去掉电话/邮箱等噪声，避免进入「画像摘要」展示 */
function redactContactLike(s: string): string {
  return s
    .replace(/\b1[3-9]\d{9}\b/g, '')
    .replace(/[+＋]?[\d\s-]{11,18}\d/g, '')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * 从简历中取适合「画像摘要」的正文：优先工作/实习/项目小节之后的内容，
 * 避免默认截取前 150 字导致全是姓名、学校、联系方式。
 */
function pickResumeBodyExcerpt(resumeText: string, maxLen: number): string {
  const normalized = (resumeText || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  /** 优先工作/实习/项目；若无则再匹配教育（应届生简历常见仅有教育块） */
  const workHeadingRe =
    /(?:^|\s)#{1,3}\s*(?:工作(?:经历|经验)?|实习(?:经历|经验)?|项目(?:经历|经验)?|任职|职业经历|实践经历)\b/i;
  const workColonRe =
    /\b(?:工作(?:经历|经验)?|实习(?:经历|经验)?|项目(?:经历|经验)?)\s*[：:]/i;
  const eduHeadingRe =
    /(?:^|\s)#{1,3}\s*(?:教育(?:背景|经历)?|在校经历|学业背景)\b/i;
  const eduColonRe = /\b(?:教育(?:背景|经历)?|在校经历|学业背景)\s*[：:]/i;

  let start = 0;
  const mWork = workHeadingRe.exec(normalized);
  const mWork2 = !mWork ? workColonRe.exec(normalized) : null;
  let sm = mWork || mWork2;
  if (!sm) {
    const mEdu = eduHeadingRe.exec(normalized);
    const mEdu2 = !mEdu ? eduColonRe.exec(normalized) : null;
    sm = mEdu || mEdu2;
  }
  if (sm) {
    start = sm.index + sm[0].length;
    while (start < normalized.length && /^[\s：:、\-—]/.test(normalized[start])) start++;
  } else {
    const workVerb = /(?:负责|参与|协助|独立|完成|主导|实现|搭建|设计|分析|调研|支持)(?:[^。；]{6,}?)/.exec(
      normalized.slice(80),
    );
    if (workVerb && workVerb.index !== undefined) {
      start = 80 + workVerb.index;
    } else if (normalized.length > 120) {
      const head = normalized.slice(0, 400);
      if (/@|1[3-9]\d{9}/.test(head)) {
        start = Math.min(220, Math.floor(normalized.length * 0.15));
      }
    }
  }

  let out = normalized.slice(start, start + maxLen + 40).trim();
  out = redactContactLike(out);
  out = out.replace(/\s{2,}/g, ' ');
  if (out.length < 35 && start > 0) {
    out = redactContactLike(normalized.slice(0, maxLen + 40));
    out = out.replace(/\s{2,}/g, ' ').trim();
  }
  if (out.length < 35) {
    const alt = /(?:实习|项目|课题)[：:\s][^。]{25,180}/.exec(normalized);
    if (alt) {
      out = redactContactLike(alt[0].trim());
      if (out.length > maxLen) out = `${out.slice(0, maxLen - 1)}…`;
    }
  }
  if (out.length > maxLen) out = `${out.slice(0, maxLen - 1)}…`;
  return out;
}

/** 检测模型是否把 summary 写成「标题行 + 行业标签」的复读（与 UI 上已有字段重复） */
function isEchoSummary(
  summary: string,
  role: string,
  yoeNum: number | null,
  industries: string[],
): boolean {
  const t = summary.trim();
  if (t.length < 12 || t.length > 140) return false;

  const roleNorm = role.replace(/\s/g, '');
  const sumNorm = summary.replace(/\s/g, '');
  if (roleNorm.length >= 2 && !sumNorm.includes(roleNorm)) return false;

  const indHit = industries.filter((i) => i.trim().length >= 2 && summary.includes(i.trim()));
  if (industries.filter(Boolean).length >= 2 && indHit.length < Math.min(2, industries.filter(Boolean).length)) {
    return false;
  }

  const hasIndustryLine = /行业[：:]/.test(summary);
  const yoeEcho =
    yoeNum != null &&
    (summary.includes(String(yoeNum)) || /年经验|\d+\s*年/.test(summary));

  if (hasIndustryLine && indHit.length >= 1 && (yoeEcho || t.length < 95)) return true;
  if (yoeEcho && indHit.length >= industries.filter(Boolean).length && industries.filter(Boolean).length <= 4 && t.length < 100) {
    return true;
  }
  return false;
}

/** 摘要被判定为复读时，用亮点/技能/简历摘录拼出非重复叙述 */
function buildDistinctSummary(
  highlights: string[],
  coreSkills: string[],
  resumeText: string,
): string {
  if (highlights.length >= 1) {
    const h = highlights.slice(0, 3).join('；');
    if (coreSkills.length >= 1 && h.length < 100) {
      return `${h}；可迁移能力包括 ${coreSkills.slice(0, 4).join('、')}。`.slice(0, 200);
    }
    return h.slice(0, 200);
  }
  if (coreSkills.length >= 2) {
    return `侧重 ${coreSkills.slice(0, 4).join('、')} 等能力；建议结合简历中的实习/项目经历具体展开职责与成果。`.slice(0, 200);
  }
  const excerpt = pickResumeBodyExcerpt(resumeText, 200);
  if (excerpt.length >= 30) {
    return `经历侧重：${excerpt}`.slice(0, 220);
  }
  return '建议补充实习/项目职责、量化成果与业务场景，便于生成更有信息量的画像摘要。';
}

function buildProfilePrompt(preferences: UserPreferences, resumeText: string): string {
  const prefLines = [
    `核心诉求（按优先级排序）：${preferences.coreNeedsPriority.join(' > ')}`,
    preferences.salaryMin ? `期望最低月薪：${preferences.salaryMin}K` : '',
    `是否愿意换行业：${preferences.openToIndustryChange}`,
    `是否愿意换城市：${preferences.openToCityChange}`,
    preferences.targetCities.length > 0 ? `目标城市：${preferences.targetCities.join('、')}` : '',
    preferences.targetIndustries.length > 0 ? `目标行业：${preferences.targetIndustries.join('、')}` : '',
  ].filter(Boolean).join('\n');

  return `你是一位资深职业规划顾问。请根据以下信息，提取并生成用户的结构化职业画像。

## 用户填写的求职偏好

${prefLines}

## 用户简历原文

${resumeText}

## 任务

基于简历内容，提取用户的真实背景信息。必须忠实于简历原文，不要编造或推测简历中不存在的技能和经历。

若简历以学业/教育经历为主（尚无正式全职工作），currentRole 可写「应届」或「×× 专业在读/应届」等可核对表述；yearsOfExperience 可为 null 或 0；highlights 须从课题、奖学金、学生工作、实习等经历中选取可核对事实。

## 输出格式约束（必须严格遵循）

- currentRole: 只填**职位职能名称**，格式为"[层级] + [职能]"，如"高级产品经理""策略产品运营""大模型应用工程师"。**禁止**把公司名、产品名（如腾讯、元宝、字节等）写入 currentRole；公司/产品背景放在 summary 中体现
- industries: 数组，固定 3 个行业标签，如 ["人工智能","互联网","SaaS"]。优先选取简历中明确出现的行业，不足则选最相关的，禁止超过 3 个
- coreSkills: 数组，固定 5 个核心技能，如 ["产品规划","数据分析","用户研究",...]。从简历中提取最核心的 5 个，禁止少于 3 个或超过 5 个
- highlights: 数组，2-4 个职业亮点，**必须**从实习/项目/工作/课题等经历中提取可核对的事实（职责、方法、结果）；禁止空泛套话；若当前以学业为主须写课程项目、课题或学生工作中的具体产出
- summary: 字符串，**必填**，约 60–90 字。**禁止与将单独展示的字段做字面复读**：不要写成「职位名，X 年经验。行业：A、B、C」这类仅拼接 currentRole / 年限 / industries 的句子（页面上方已有标题行与行业标签，复读会被视为无效摘要）。summary 必须提供**增量信息**：1–2 句，写代表项目/业务场景、可量化成果、方法论或工具链、与偏好相关的求职动机等；可含公司/产品名。**禁止**在简历已有足够正文时输出「信息有限」「建议补充」等套话；仅当简历几乎无字时可提示补充材料

输出以下 JSON 对象（不要包含 markdown 代码块标记）：

{
  "currentRole": "职位职能，如 高级产品经理、策略产品运营",
  "yearsOfExperience": 工作年限数字或null,
  "industries": ["行业1","行业2","行业3"],
  "coreSkills": ["技能1","技能2","技能3","技能4","技能5"],
  "highlights": ["亮点1","亮点2"],
  "educationLevel": "最高学历",
  "summary": "60-90字，增量叙述，禁止复述职位+年限+行业标签"
}`;
}

/** 方向推荐需对照原文核对 gaps，过长时截断并注明（避免超出模型上下文） */
const MAX_RESUME_CHARS_FOR_DIRECTIONS = 56000;

function buildDirectionPrompt(
  preferences: UserPreferences,
  profile: UserProfile,
  resumeText: string,
): string {
  const raw = (resumeText || '').trim();
  const truncated =
    raw.length > MAX_RESUME_CHARS_FOR_DIRECTIONS
      ? `${raw.slice(0, MAX_RESUME_CHARS_FOR_DIRECTIONS)}\n\n[… 简历后续已截断，共 ${raw.length} 字；核对 gaps 时优先依据以上可见部分]`
      : raw;

  const prefLines = [
    `核心诉求（按优先级排序）：${preferences.coreNeedsPriority.join(' > ')}`,
    preferences.salaryMin ? `期望最低月薪：${preferences.salaryMin}K` : '',
    `是否愿意换行业：${preferences.openToIndustryChange}`,
    `是否愿意换城市：${preferences.openToCityChange}`,
    preferences.targetCities.length > 0 ? `目标城市：${preferences.targetCities.join('、')}` : '',
    preferences.targetIndustries.length > 0 ? `目标行业：${preferences.targetIndustries.join('、')}` : '',
  ].filter(Boolean).join('\n');

  const profileLines = [
    `当前角色：${profile.currentRole}`,
    profile.yearsOfExperience !== null ? `工作年限：${profile.yearsOfExperience} 年` : '',
    profile.industries.length > 0 ? `行业背景：${profile.industries.join('、')}` : '',
    profile.coreSkills.length > 0 ? `核心技能：${profile.coreSkills.join('、')}` : '',
    profile.highlights.length > 0 ? `职业亮点：${profile.highlights.join('；')}` : '',
    profile.educationLevel ? `学历：${profile.educationLevel}` : '',
    `画像摘要：${profile.summary}`,
  ].filter(Boolean).join('\n');

  return `你是资深职业规划顾问。推荐 5 个方向，按 matchScore 降序，最高与最低差≥15分。

## 用户画像（结构化摘要，可能与原文细节有遗漏，以下方简历原文为准）
${profileLines}

## 用户简历原文（方向匹配、strengths、gaps 必须严格据此核对，禁止凭岗位名称臆造）
${truncated || '（未提供简历正文）'}

## 用户偏好
${prefLines}

## 规则（按优先级执行，后者覆盖前者，避免自相矛盾）
1. **判定顺序**：先估算「简历与该方向核心职责」的重合度（技能+项目+行业语境，非职位名 alone）→ 再决定职级用词与薪资 → **最后才参考总工作年限**。总年限**不得**在低重合时单独把职级抬到资深/负责人。
2. **方向类型分档（与 50% / 30% 规则统一）**：
   - **主路径（5 条中至少 3 条须落在此档）**：与该方向核心职责重合 **≥50%**，或典型**相邻迁移**（如前端→全栈）且迁移后核心栈仍有一半以上可复用。**禁止** PM→算法、运营→算法等需重学主技能的大跨度。
   - **转型/探索（至多 2 条）**：重合 **30%–50%**，仅允许作为「跨行找机会」：directionName **不得**含资深/专家/负责人/总监/VP；abilityMatch 须明显低于主路径；marketSalary 保守并点明转型期。
   - **重合＜30%**：**不得**作为推荐方向（不要硬凑满 5 个；可将第 4、5 条改为另一条主路径或相邻路径，或明确写「需先补足基础再投递」的过渡岗，但过渡岗也须 adjacent、不得大跨度）。
3. **年限→职级表仅在高重合时适用**：当该方向重合 **≥50%** 且非大跨度时，可用：0-3年→初/专员；3-5年→中/高级；5-8年→高/资深；8年+→总监/负责人。**跨职能或重合≤40% 时**，忽略上述年限里的「资深/总监」档，最多用到「高级」或「中高级（转型）」，且须降一级表述。
4. directionName 须像真实招聘平台职位：**细分领域 + 层级 + 职能**，禁止过宽如「产品经理」「运营」。
5. **薪资与职级一致**；marketSalary 为模型估算非实时数据，可注明「仅供参考，以 offer 为准」。低重合方向必须保守区间。
6. 5 条方向须彼此差异明显；**strengths / gaps 每一条都必须在「用户简历原文」中有据可查**：strengths 对应原文中的经历或技能表述；**gaps 仅写原文中确实未出现、未体现或与该方向核心要求明显不足的项**。若原文已含某类量化成果（如 DAU、留存、ROI、转化率、收入等）或某技术栈实践（如 LLM、Prompt、RAG 等），**不得**再将其列为「缺少」。各维度 reason 须引用具体经历。abilityMatch.reason 写明可复用比例判断。

## 三维度评分
- preferenceMatch（30%）：诉求满足度、薪资覆盖、城市匹配
- abilityMatch（40%）：与该方向核心职责的复用率；主路径重合≥50% 时正常给分；转型档 30–50% 时不超过 60；**重合＜30% 的方向不应出现**，若出现则整批输出视为不合格须自检重写
- marketOutlook（30%）：需求趋势、供需比、薪资增长
- matchScore = pref×0.3 + ability×0.4 + market×0.3（四舍五入）

## 输出 JSON 数组
[{"directionName":"","matchScore":0,"preferenceMatch":{"score":0,"reason":""},"abilityMatch":{"score":0,"reason":""},"marketOutlook":{"score":0,"reason":""},"strengths":[],"gaps":[],"focusPoints":[],"marketSalary":"","salaryTrend":"","demandTrend":"","talentGap":"","careerPath":"","suggestedSearchKeywords":[],"suggestedFilters":{}}]`;
}

function buildPlanPrompt(
  direction: DirectionRecommendation,
  planMode: 'ai_suggested' | 'user_deadline',
  targetDate?: string,
  currentDate?: string,
): string {
  const today = currentDate || new Date().toISOString().split('T')[0];

  const modeInstruction = planMode === 'user_deadline' && targetDate
    ? `用户设定目标：在 ${targetDate} 前拿到 offer。今天是 ${today}。
请倒推各阶段时间，分配如下：
- 投递期（从开始投递到拿到 offer）最低 6-8 周：对应 5 轮面试（每轮 1-1.5 周 = 5-7.5 周），再加 1-2 周 buffer（谈薪、背景调查、流程意外）
- 准备期约占总时间 30-40%，投递期约占 60-70%，预留 1-2 周 buffer
- 若距目标日期不足约 10 周（准备期至少 2 周 + 投递期 6 周 + buffer 2 周），在计划中提示用户「时间可能过于紧张，建议调整目标日期或降低预期」；投递期仍至少保留 6 周`
    : `AI 自动规划模式。今天是 ${today}。
根据用户差距清单估算总周期（上限 14 周）。投递期（从开始投递到拿到 offer）至少 6-8 周，对应 5 轮面试、每轮约 1-1.5 周、再加 1-2 周 buffer，与模拟面试逻辑对齐：
- gap 小（1-2项小技能）→ 总周期 8-10 周（准备期 2-3 周 + 投递期 6-7 周）
- gap 中（3-5项或含中等学习曲线）→ 总周期 10-12 周（准备期 3-4 周 + 投递期 6-8 周）
- gap 大（跨领域、需系统学习）→ 总周期 12-14 周（准备期 4-5 周 + 投递期 6-9 周）
投递期最低 6 周，建议 7-8 周以上更保险。`;

  return `你是一位资深职业规划顾问，擅长制定可执行的求职计划。

## 目标方向

- 方向：${direction.directionName}
- 匹配度：${direction.matchScore} 分
- 已具备：${direction.strengths.join('、') || '暂无'}
- 缺少：${direction.gaps.join('、') || '暂无'}
- 准备重点：${direction.focusPoints.join('、') || '暂无'}

## 时间规划

${modeInstruction}

## 任务

生成一份按周拆解的求职计划。

计划结构要求：
1. phases: 阶段数组，每个阶段包含 name（"准备期"/"投递期"/"Buffer"）、weekStart、weekEnd、startDate、endDate
2. tasks: 任务数组，每个任务包含：
   - weekNumber: 第几周
   - phase: 所属阶段
   - title: 任务标题
   - description: 任务描述
   - completionCriteria: 明确的完成标准（可量化、可验证）
   - priority: "high" / "medium" / "low"

准备期任务应包括：技能学习、项目整理、简历打磨、模拟面试。
投递期任务应包括：持续投递、真实面试准备、面后复盘、技能查漏补缺。
两阶段不硬切割，投递期仍可安排学习任务。每周 3-4 个任务，保持精简。

涉及模拟面试的任务时，description 和 completionCriteria 须体现：
- 优先推荐使用 Offerin 模拟面试功能进行练习
- 在此基础上，建议找相关行业/岗位朋友深度聊聊，或约定一次模拟实际面试谈话

## 输出格式

严格输出 JSON 对象，不要包含 markdown 代码块标记：

{
  "title": "DevOps/SRE 求职计划",
  "totalWeeks": 8,
  "phases": [...],
  "tasks": [...]
}`;
}

export async function generateUserProfile(
  preferences: UserPreferences,
  resumeText: string,
  streamOptions?: CareerExploreStreamOptions,
): Promise<UserProfile> {
  const client = createAIClient('career_explore', 'profile');
  const prompt = buildProfilePrompt(preferences, resumeText);

  const text = await collectCareerExploreStreamOrFallback(
    client,
    {
      model: MODEL_PRIMARY_CAREER_EXPLORE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.3,
        maxOutputTokens: 8192,
        responseMimeType: 'application/json',
      },
    },
    streamOptions,
  );

  const raw = parseCareerExploreJson(text, '画像') as Record<string, unknown>;

  // 客户端兜底：限制数量；纠正模型非标准 JSON（字符串年限、字符串「数组」）
  const industries = coerceStringArray(raw.industries, 3);
  const coreSkills = coerceStringArray(raw.coreSkills, 5);
  const highlights = coerceStringArray(raw.highlights, 6);

  const role =
    typeof raw.currentRole === 'string' && raw.currentRole.trim() ? raw.currentRole.trim() : '求职者';

  let summary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
  if (summary.length > 90) summary = `${summary.slice(0, 87)}…`;

  const yoeNum = coerceYearsOfExperience(raw.yearsOfExperience);
  const yoeStr = yoeNum != null ? `${yoeNum} 年经验` : '';

  const eduRaw =
    typeof raw.educationLevel === 'string' ? String(raw.educationLevel).trim() : '';
  const edu = eduRaw && eduRaw !== '未提供' ? eduRaw : '';

  // 模型偶发省略 summary：用亮点+技能+行业+学历拼一段，避免页面上只剩标题与标签
  if (summary.length < 24) {
    const hl = highlights.slice(0, 3).join('；');
    const sk = coreSkills.slice(0, 4).join('、');
    const indJoined = industries.join('、');
    const pieces = [
      hl && `亮点：${hl}`,
      sk && `核心能力：${sk}`,
      edu && `学历：${edu}`,
    ].filter(Boolean);
    const ind = indJoined;

    if (pieces.length) {
      const head = [role, yoeStr].filter(Boolean).join('，');
      summary = `${head}。${pieces.join('；')}`.slice(0, 200);
    } else if (ind || yoeStr) {
      summary = [role, yoeStr, ind ? `背景覆盖${ind}` : ''].filter(Boolean).join('，');
    } else if (role && role !== '求职者') {
      summary = '建议补充项目经历与可量化成果，便于生成更完整的画像摘要。';
    }
  }

  // 仍缺摘要时：用结构化字段 + 简历原文摘录兜底，避免「简历有字却提示信息有限」
  if (!summary.trim()) {
    const rt = (resumeText || '').replace(/\s+/g, ' ').trim();
    const resumeIntro =
      rt.length >= 12 ? pickResumeBodyExcerpt(resumeText, 180) : '';

    const bits: string[] = [];
    if (role && role !== '求职者') {
      bits.push(`${role}${yoeNum != null ? `，约 ${yoeNum} 年经验` : ''}`);
    }
    if (industries.length) bits.push(`行业背景：${industries.join('、')}`);
    if (coreSkills.length) bits.push(`技能关键词：${coreSkills.join('、')}`);
    if (highlights.length) bits.push(`经历亮点：${highlights.slice(0, 3).join('；')}`);
    if (edu) bits.push(`学历：${edu}`);

    if (resumeIntro) {
      summary = `经历与能力摘要：${resumeIntro}`.slice(0, 220);
    } else if (bits.length) {
      summary = `${bits.join('；')}。可继续补充项目成果与量化数据，便于方向匹配更精细。`.slice(0, 200);
    } else {
      summary =
        '当前简历可提炼信息有限。建议补充职责范围、项目背景与量化成果，便于生成更完整的画像摘要。';
    }
  }

  // 模型给了标签但摘要仍是「信息有限」类套话：只要简历有可见正文（≥12 字即覆盖），用摘录替换
  const rtFull = (resumeText || '').replace(/\s+/g, ' ').trim();
  const summaryLooksLikeVagueTemplate =
    summary.includes('可提炼信息有限') ||
    (summary.includes('信息有限') && summary.includes('建议补充')) ||
    summary === '建议补充项目经历与可量化成果，便于生成更完整的画像摘要。';

  if (summaryLooksLikeVagueTemplate && rtFull.length >= 12) {
    const excerpt = pickResumeBodyExcerpt(resumeText, 200);
    summary =
      excerpt.length >= 30
        ? `经历与能力摘要：${excerpt}`.slice(0, 220)
        : `经历与能力摘要：${redactContactLike(rtFull.slice(0, 170))}${rtFull.length > 170 ? '…' : ''}`.slice(0, 220);
  }

  // 模型常把 summary 写成「职位+年限+行业：标签」与标题区重复；用亮点/技能/摘录替换
  if (isEchoSummary(summary, role, yoeNum, industries)) {
    summary = buildDistinctSummary(highlights, coreSkills, rtFull);
  }

  return {
    currentRole: role,
    yearsOfExperience: yoeNum,
    industries,
    coreSkills,
    highlights,
    educationLevel: raw.educationLevel || '未提供',
    summary,
    hasResume: true,
  };
}

function buildDemoJdPrompt(direction: DirectionRecommendation, profile: UserProfile): string {
  return `根据下方背景生成一份**虚构但逼真**的招聘 JD（Markdown），供求职者对标简历与面试，非真实在招岗位。

## 内部参考（不要复述给用户，不要写成对话）
### 推荐方向
- 职位名称：${direction.directionName}
- 匹配优势：${direction.strengths.join('；') || '—'}
- 能力差距：${direction.gaps.join('；') || '—'}
- 准备重点：${direction.focusPoints.join('；') || '—'}
- 薪资参考：${direction.marketSalary || '—'}

### 候选人画像
- 当前角色与年限：${profile.currentRole}；${profile.yearsOfExperience != null ? `${profile.yearsOfExperience} 年经验` : '年限未识别'}
- 行业：${profile.industries.join('、') || '—'}
- 核心技能：${profile.coreSkills.join('、') || '—'}
- 画像摘要：${profile.summary || '—'}

## 输出格式（必须严格遵守）
1. **第一个非空字符必须是 Markdown 标题**：以「# 」开头写岗位全称（可与推荐方向名称一致或略规范化为招聘常用写法）。
2. 正文仅包含 JD 结构，依次包含：## 岗位概述、## 岗位职责（5–8 条有序或无序列表）、## 任职要求（分条）、## 加分项（可选）、## 薪资福利（注明仅供参考）。
3. **严禁**：问候语（如「你好」）、自我介绍（如「我是招聘经理」）、与 JD 无关的开场白、单独章节「招聘经理给你的面试准备建议」或面试备考清单、求职辅导话术、JSON。
4. 专业中文为主，可保留必要英文专名。`;
}

/** 去掉模型偶发输出的前言、面试建议段等 */
function stripJdDemoNoise(raw: string): string {
  let s = raw.trim();
  s = s.replace(/招聘经理给你的面试准备建议[\s\S]*?(?=\n#{1,3}\s|$)/gi, '').trim();
  s = s.replace(/\n*#{1,3}\s*[*＊]*\s*面试准备建议[\s\S]*?(?=\n#{1,3}\s|$)/gi, '').trim();
  const lines = s.split('\n');
  const firstHeading = lines.findIndex(l => /^#{1,6}\s+\S/.test(l.trim()));
  if (firstHeading > 0) {
    s = lines.slice(firstHeading).join('\n').trim();
  }
  return s;
}

/** 参考 JD（Demo），与画像/方向/计划共用职业探索配额 */
export async function generateDemoJd(
  direction: DirectionRecommendation,
  profile: UserProfile,
): Promise<string> {
  const client = createAIClient('career_explore', 'jd_demo');
  const result = await generateContentWithRetry(client, {
    model: MODEL_PRIMARY_CAREER_EXPLORE,
    contents: [{ role: 'user', parts: [{ text: buildDemoJdPrompt(direction, profile) }] }],
    config: {
      temperature: 0.55,
      maxOutputTokens: 4096,
    },
  });
  const text = extractTextFromResult(result).trim();
  if (!text) throw new Error('JD 生成结果为空，请重试');
  const cleaned = stripJdDemoNoise(text);
  if (cleaned.length < 60) throw new Error('JD 内容异常，请重试');
  return cleaned;
}

export async function getDirectionRecommendations(
  preferences: UserPreferences,
  profile: UserProfile,
  resumeText: string,
  streamOptions?: CareerExploreStreamOptions,
): Promise<DirectionRecommendation[]> {
  const client = createAIClient('career_explore', 'directions');
  const prompt = buildDirectionPrompt(preferences, profile, resumeText);

  const text = await collectCareerExploreStreamOrFallback(
    client,
    {
      model: MODEL_PRIMARY_CAREER_EXPLORE,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        temperature: 0.6,
        maxOutputTokens: 16384, // 5 个方向约 1.2k tokens，预留充足避免截断
        responseMimeType: 'application/json',
      },
    },
    streamOptions,
  );

  const raw = parseCareerExploreJson(text, '方向') as any[];

  return raw.map((d: any) => {
    const pref = normalizeDim(d.preferenceMatch);
    const ability = normalizeDim(d.abilityMatch);
    const market = normalizeDim(d.marketOutlook);
    const computed = Math.round(pref.score * 0.3 + ability.score * 0.4 + market.score * 0.3);

    return {
      directionName: d.directionName || '未知方向',
      matchScore: computed,
      preferenceMatch: pref,
      abilityMatch: ability,
      marketOutlook: market,
      strengths: d.strengths || [],
      gaps: d.gaps || [],
      focusPoints: d.focusPoints || [],
      marketSalary: d.marketSalary || '未知',
      salaryTrend: d.salaryTrend || '',
      demandTrend: d.demandTrend || '',
      talentGap: d.talentGap || '',
      careerPath: d.careerPath || '',
      suggestedSearchKeywords: d.suggestedSearchKeywords || [],
      suggestedFilters: d.suggestedFilters || {},
    } as DirectionRecommendation;
  });
}

export async function generateCareerPlan(
  direction: DirectionRecommendation,
  planMode: 'ai_suggested' | 'user_deadline',
  targetDate?: string,
): Promise<CareerPlan> {
  const client = createAIClient('career_explore', 'plan');
  const today = new Date().toISOString().split('T')[0];
  const prompt = buildPlanPrompt(direction, planMode, targetDate, today);

  const result = await generateContentWithRetry(client, {
    model: MODEL_PRIMARY_CAREER_EXPLORE,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.7,
      maxOutputTokens: 16384,
      responseMimeType: 'application/json',
    },
  });

  const text = extractTextFromResult(result);
  const raw = parseCareerExploreJson(text, '计划') as Record<string, unknown>;

  const plan: CareerPlan = {
    id: crypto.randomUUID(),
    title: raw.title || `${direction.directionName} 求职计划`,
    totalWeeks: raw.totalWeeks,
    planMode,
    targetDate,
    startDate: today,
    phases: (raw.phases || []) as Phase[],
    tasks: (raw.tasks || []).map((t: any) => ({
      id: crypto.randomUUID(),
      weekNumber: t.weekNumber,
      phase: t.phase,
      title: t.title,
      description: t.description || '',
      completionCriteria: t.completionCriteria || '',
      priority: t.priority || 'medium',
      resources: (t.resources || []).map((r: any) =>
        typeof r === 'string' ? { name: r, url: '', type: 'docs' as const } : r
      ),
      isCompleted: false,
    })) as PlanTask[],
    status: 'active',
  };

  return plan;
}
