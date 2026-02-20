
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
