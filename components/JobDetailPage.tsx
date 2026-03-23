import React, { useEffect, useState } from 'react';
import { ArrowLeft, ExternalLink, Loader2 } from 'lucide-react';
import { fetchJobById, type JobWithMatch, type JobStatus, updateJobStatus } from '../services/jobService';
import type { SavedResume } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../services/supabaseClient';

interface JobDetailPageProps {
  jobId: string;
  initialJob?: JobWithMatch | null;
  onBack: () => void;
  onOpenPlanFromJob?: (job: JobWithMatch) => void;
}

const statusOptions: { value: JobStatus; label: string }[] = [
  { value: 'pending', label: '待评估' },
  { value: 'interested', label: '感兴趣' },
  { value: 'applied', label: '已投递' },
  { value: 'interviewing', label: '面试中' },
  { value: 'offered', label: '已 Offer' },
  { value: 'rejected', label: '已拒绝' },
  { value: 'dropped', label: '放弃' },
];

const JobDetailPage: React.FC<JobDetailPageProps> = ({ jobId, initialJob, onBack, onOpenPlanFromJob }) => {
  const { user } = useAuth();
  const [job, setJob] = useState<JobWithMatch | null>(initialJob || null);
  const [loading, setLoading] = useState(!initialJob);
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [resumes, setResumes] = useState<SavedResume[]>([]);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await fetchJobById(jobId);
      if (data) setJob(data);
      setLoading(false);
    };
    if (!initialJob) {
      load();
    }
  }, [jobId, initialJob, user]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('saved_resumes')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .then(({ data }) => {
        setResumes((data || []) as SavedResume[]);
      });
  }, [user]);

  const handleStatusChange = async (next: JobStatus) => {
    if (!job) return;
    setSavingStatus(true);
    setStatusError(null);
    const { success, error } = await updateJobStatus(job.id, next);
    if (!success && error) {
      setStatusError(error);
    } else {
      setJob({ ...job, status: next });
    }
    setSavingStatus(false);
  };

  if (loading || !job) {
    return (
      <div className="w-full max-w-4xl mx-auto py-16 text-center text-zinc-400">
        <Loader2 size={24} className="animate-spin mx-auto mb-3" />
        <p className="text-sm">正在加载 JD 详情...</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="p-2 hover:bg-zinc-100 rounded-md transition-colors text-zinc-500"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="font-display font-semibold text-[18px] text-zinc-900">
              {job.title || '未命名岗位'}
            </h2>
            <p className="text-[13px] text-zinc-500 mt-0.5">
              {job.company || '未知公司'}
              {job.city && <> · {job.city}</>}
            </p>
          </div>
        </div>
        {job.source_url && (
          <a
            href={job.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
          >
            在原网站查看
            <ExternalLink size={12} />
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[2fr,1.2fr] gap-6 mb-6">
        <div className="space-y-4">
          <div className="p-4 bg-white border border-zinc-200 rounded-xl">
            <h3 className="text-[13px] font-medium text-zinc-800 mb-2">岗位信息</h3>
            <p className="text-[12px] text-zinc-500 leading-relaxed whitespace-pre-wrap">
              {job.description || '暂无 JD 文本'}
            </p>
          </div>

          {job.match && (
            <div className="p-4 bg-white border border-zinc-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-medium text-zinc-800">匹配分析（当前主简历）</h3>
                {typeof job.match.overall_score === 'number' && (
                  <div className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[11px] font-medium flex flex-col items-center">
                    <span>{job.match.overall_score}</span>
                    <span className="text-[10px] text-emerald-500">综合匹配</span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-[11px] text-zinc-500">
                <div>
                  <p>技能匹配</p>
                  <p className="text-zinc-800 font-semibold">
                    {job.match.skill_score ?? '-'}
                  </p>
                </div>
                <div>
                  <p>经验匹配</p>
                  <p className="text-zinc-800 font-semibold">
                    {job.match.experience_score ?? '-'}
                  </p>
                </div>
                <div>
                  <p>项目/业务</p>
                  <p className="text-zinc-800 font-semibold">
                    {job.match.project_score ?? '-'}
                  </p>
                </div>
              </div>

              {job.match.strengths && job.match.strengths.length > 0 && (
                <div>
                  <p className="text-[12px] font-medium text-emerald-600 mb-1">已具备</p>
                  <ul className="space-y-1">
                    {job.match.strengths.map((s, idx) => (
                      <li key={idx} className="text-[12px] text-zinc-600">
                        · {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {job.match.gaps && job.match.gaps.length > 0 && (
                <div>
                  <p className="text-[12px] font-medium text-red-500 mb-1">差距</p>
                  <ul className="space-y-1">
                    {job.match.gaps.map((g, idx) => (
                      <li key={idx} className="text-[12px] text-zinc-600">
                        · {g}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {job.match.focus_points && job.match.focus_points.length > 0 && (
                <div>
                  <p className="text-[12px] font-medium text-amber-600 mb-1">匹配重点</p>
                  <ul className="space-y-1">
                    {job.match.focus_points.map((f, idx) => (
                      <li key={idx} className="text-[12px] text-zinc-600">
                        · {f}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-white border border-zinc-200 rounded-xl space-y-2">
            <h3 className="text-[13px] font-medium text-zinc-800 mb-1">跟进状态</h3>
            <select
              className="w-full border border-zinc-200 rounded-lg text-[13px] px-2 py-1.5 text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400"
              value={job.status}
              onChange={e => handleStatusChange(e.target.value as JobStatus)}
              disabled={savingStatus}
            >
              {statusOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {statusError && (
              <p className="text-[11px] text-red-500 mt-1">更新状态失败：{statusError}</p>
            )}
          </div>

          <div className="p-4 bg-white border border-zinc-200 rounded-xl space-y-2">
            <h3 className="text-[13px] font-medium text-zinc-800 mb-1">选择简历版本</h3>
            {resumes.length === 0 ? (
              <p className="text-[12px] text-zinc-500">
                还没有保存的简历。先在「准备」阶段完成一次简历优化并保存到简历库。
              </p>
            ) : (
              <select className="w-full border border-zinc-200 rounded-lg text-[13px] px-2 py-1.5 text-zinc-800 focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400">
                {resumes.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            )}
            <button
              disabled={resumes.length === 0}
              className="mt-2 w-full px-3 py-2 text-[13px] rounded-lg border border-zinc-200 text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              用所选简历生成针对该 JD 的优化版（占位）
            </button>
          </div>

          <div className="p-4 bg-white border border-zinc-200 rounded-xl space-y-2">
            <h3 className="text-[13px] font-medium text-zinc-800 mb-1">生成求职计划</h3>
            <p className="text-[12px] text-zinc-500">
              基于该 JD 和你的画像，生成包含准备期与投递期的按周计划。后续将和现有求职计划库打通。
            </p>
            <button
              onClick={() => job && onOpenPlanFromJob && onOpenPlanFromJob(job)}
              className="mt-1 w-full px-3 py-2 text-[13px] rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50"
              disabled={!onOpenPlanFromJob}
            >
              生成针对该 JD 的求职计划（占位）
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default JobDetailPage;

