
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

export interface InterviewSettings {
  totalRounds: number;
  interviewStyle: 'standard' | 'pressure' | 'friendly';
  mode: InterviewMode;
}

export type InterviewStatus = 'idle' | 'running' | 'completed' | 'stopped' | 'error' | 'waiting_input';
