
export interface AnalysisResult {
  diagnosis: string;
  reconstruction: string;
  visualAdvice: string;
  fullMarkdown: string;
}

export interface UserInput {
  jd: string;
  resume: string;
  aspiration: string;
}

// 模拟面试相关类型
export interface InterviewMessage {
  type: 'system' | 'user' | 'interviewer' | 'interviewee' | 'round' | 'summary' | 'error' | 'feedback';
  content: string;
  timestamp: string;
  round?: number;
  phase?: string;
  isStreaming?: boolean;
}

// 面试模式：simulation = 纯模拟（AI问+AI答），interactive = 人机交互（AI问+用户答）
export type InterviewMode = 'simulation' | 'interactive';

// 面试官角色（对应不同面试阶段）
export type InterviewerRole = 'ta' | 'peers' | 'leader' | 'director' | 'hrbp';

// 面试补充信息（薪资、到岗时间等敏感信息）
export interface InterviewSupplementInfo {
  currentSalary: string;      // 当前薪资结构
  expectedSalary: string;     // 期望薪资范围
  availableTime: string;      // 最快到岗时间
  otherInfo: string;          // 其他补充信息
}

export interface InterviewSettings {
  totalRounds: number;
  interviewerRole: InterviewerRole;
  mode: InterviewMode;
}

export type InterviewStatus = 'idle' | 'running' | 'completed' | 'stopped' | 'error' | 'waiting_input';

// ============ 简历库相关类型 ============

export interface SavedResume {
  id: string;
  user_id: string;
  title: string;
  resume_markdown: string;
  english_resume_markdown: string | null;
  job_description: string | null;
  aspiration: string | null;
  density_multiplier: number;
  template: string | null;
  source: 'reconstruction' | 'manual' | 'import';
  is_favorited: boolean;
  created_at: string;
  updated_at: string;
}

/** 独立保存的参考 JD（与简历版本无强制关联；标签用于自行与简历/计划等对应） */
export interface SavedJd {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

// ============ 职业探索 ============

export interface UserPreferences {
  coreNeeds: string[];
  coreNeedsPriority: string[];
  salaryMin?: number;
  openToIndustryChange: 'yes' | 'no' | 'maybe';
  openToCityChange: 'yes' | 'no' | 'maybe';
  targetCities: string[];
  targetIndustries: string[];
}

export interface UserProfile {
  currentRole: string;
  yearsOfExperience: number | null;
  industries: string[];
  coreSkills: string[];
  highlights: string[];
  educationLevel: string;
  summary: string;
  hasResume: boolean;
}

export interface DimensionScore {
  score: number;
  reason: string;
}

export interface DirectionRecommendation {
  directionName: string;
  matchScore: number;
  preferenceMatch: DimensionScore;
  abilityMatch: DimensionScore;
  marketOutlook: DimensionScore;
  strengths: string[];
  gaps: string[];
  focusPoints: string[];
  marketSalary: string;
  salaryTrend: string;
  demandTrend: string;
  talentGap: string;
  careerPath: string;
  suggestedSearchKeywords: string[];
  suggestedFilters: Record<string, unknown>;
}

export interface Phase {
  name: string;
  weekStart: number;
  weekEnd: number;
  startDate: string;
  endDate: string;
}

export interface PlanResource {
  name: string;
  url: string;
  type: 'docs' | 'link' | string;
}

export interface PlanTask {
  id: string;
  weekNumber: number;
  phase: string;
  title: string;
  description: string;
  completionCriteria: string;
  priority: 'high' | 'medium' | 'low' | string;
  resources: PlanResource[];
  isCompleted: boolean;
  completedAt?: string;
}

export interface CareerPlan {
  id: string;
  title: string;
  totalWeeks: number;
  planMode: 'ai_suggested' | 'user_deadline';
  targetDate?: string;
  startDate: string;
  phases: Phase[];
  tasks: PlanTask[];
  status: string;
}

export interface PlanNote {
  id: string;
  /** 已废弃：请用 linked_plan_ids；接口仍可能返回以兼容未跑迁移的库 */
  plan_id?: string | null;
  user_id: string;
  content: string;
  /** 关联的 saved_career_plans.id，可多选 */
  linked_plan_ids: string[];
  linked_weeks?: number[];
  linked_task_ids?: string[];
  linked_custom_tags?: string[];
  images?: string[];
  created_at: string;
  updated_at: string;
}
