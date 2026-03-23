/**
 * 混合模型路由：主模型 + 失败后依次换池（与 api/gemini/proxy 单次请求内 429/404 fallback 默认链一致）
 * 职业探索 careerService 仍为全链路 gemini-3.1-pro-preview，不经过此处。
 */

export const MODEL_PRIMARY_DIAGNOSIS = 'gemini-3.1-pro-preview';
export const MODEL_PRIMARY_AUTO_REWRITE = 'gemini-3.1-pro-preview';
/** 模拟面试 / 人机对练：与诊断同主模型，切换时改 DIAGNOSIS 即可联动 */
export const MODEL_PRIMARY_INTERVIEW = MODEL_PRIMARY_DIAGNOSIS;
/** 职业探索全链路：与诊断同主模型 */
export const MODEL_PRIMARY_CAREER_EXPLORE = MODEL_PRIMARY_DIAGNOSIS;
/** 音频转写、文件 OCR 等多模态低成本路径 */
export const MODEL_PRIMARY_FILE_MULTIMODAL = 'gemini-2.0-flash';

/**
 * 以 3.1-pro 为主时的降级尾链（不含主模型本身）。
 * 顺序：2.5-pro → 2.5-flash → 2.0 系（含 lite 兜底）。
 * 不再包含 gemini-3-pro-preview（易与 3.1 混淆且部分环境已下线）。
 */
export const FALLBACK_AFTER_3_1_PRO = [
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
] as const;

/** 代理未收到有效 fallbackModels 时，与 FALLBACK_AFTER_3_1_PRO 相同（避免前后端链漂移） */
export const PROXY_DEFAULT_FALLBACK_CHAIN: readonly string[] = FALLBACK_AFTER_3_1_PRO;

/** 翻译：主 2.5-pro → 3.1 → 2.5-flash → 2.0-flash（质量优先再换池） */
export const MODEL_PRIMARY_TRANSLATION = 'gemini-2.5-pro';
export const FALLBACK_TRANSLATION = [
  'gemini-3.1-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
] as const;

/** 局部编辑 / 精简（resume_edit）：主 2.5-flash → 2.5-pro → 3.1 → 2.0-flash */
export const MODEL_PRIMARY_RESUME_EDIT = 'gemini-2.5-flash';
export const FALLBACK_RESUME_EDIT = [
  'gemini-2.5-pro',
  'gemini-3.1-pro-preview',
  'gemini-2.0-flash',
] as const;
