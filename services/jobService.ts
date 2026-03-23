import { supabase } from './supabaseClient';

export type JobStatus =
  | 'new'
  | 'pending'
  | 'interested'
  | 'applied'
  | 'interviewing'
  | 'offered'
  | 'rejected'
  | 'dropped';

export interface JobEntry {
  id: string;
  user_id: string;
  source: string;
  source_job_id: string | null;
  source_url: string | null;
  title: string;
  company: string;
  company_size: string | null;
  industry: string | null;
  salary_range: string | null;
  salary_min: number | null;
  salary_max: number | null;
  city: string | null;
  experience: string | null;
  education: string | null;
  description: string | null;
  tags: string[] | null;
  published_at: string | null;
  scraped_at: string | null;
  status: JobStatus;
  applied_at: string | null;
  user_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface JobMatch {
  id: string;
  user_id: string;
  job_id: string;
  overall_score: number | null;
  skill_score: number | null;
  experience_score: number | null;
  project_score: number | null;
  strengths: string[] | null;
  gaps: string[] | null;
  focus_points: string[] | null;
  market_salary: string | null;
  career_path: string | null;
  raw_analysis: string | null;
  created_at: string;
}

export interface JobWithMatch extends JobEntry {
  match?: JobMatch | null;
}

export async function fetchJobs(userId: string): Promise<{ data: JobWithMatch[]; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select(
        `
        *,
        job_matches (*)
      `,
      )
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;

    const jobs: JobWithMatch[] =
      (data || []).map((row: any) => ({
        ...(row as JobEntry),
        match: Array.isArray(row.job_matches) && row.job_matches.length > 0 ? (row.job_matches[0] as JobMatch) : null,
      })) ?? [];

    return { data: jobs };
  } catch (err: any) {
    console.error('获取 JD 列表失败:', err);
    return { data: [], error: err.message };
  }
}

export async function fetchJobById(jobId: string): Promise<{ data: JobWithMatch | null; error?: string }> {
  try {
    const { data, error } = await supabase
      .from('jobs')
      .select(
        `
        *,
        job_matches (*)
      `,
      )
      .eq('id', jobId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return { data: null };

    const job: JobWithMatch = {
      ...(data as JobEntry),
      match: Array.isArray((data as any).job_matches) && (data as any).job_matches.length > 0
        ? ((data as any).job_matches[0] as JobMatch)
        : null,
    };

    return { data: job };
  } catch (err: any) {
    console.error('获取 JD 详情失败:', err);
    return { data: null, error: err.message };
  }
}

export async function updateJobStatus(jobId: string, status: JobStatus): Promise<{ success: boolean; error?: string }> {
  try {
    const payload: Partial<JobEntry> = {
      status,
      updated_at: new Date().toISOString(),
    };
    if (status === 'applied') {
      (payload as any).applied_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('jobs')
      .update(payload)
      .eq('id', jobId);

    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    console.error('更新 JD 状态失败:', err);
    return { success: false, error: err.message };
  }
}

