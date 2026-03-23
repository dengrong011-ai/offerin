import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { fetchJobs, type JobWithMatch, type JobStatus } from '../services/jobService';
import { ArrowLeft, Search, Loader2, Briefcase, Clock, Target } from 'lucide-react';

interface JobLibraryProps {
  onBack: () => void;
  onOpenJob: (job: JobWithMatch) => void;
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  if (diffHour < 24) return `${diffHour} 小时前`;
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

const statusLabel: Record<JobStatus, string> = {
  new: '待评估',
  pending: '待评估',
  interested: '感兴趣',
  applied: '已投递',
  interviewing: '面试中',
  offered: '已 Offer',
  rejected: '已拒绝',
  dropped: '放弃',
};

export const JobLibrary: React.FC<JobLibraryProps> = ({ onBack, onOpenJob }) => {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<JobWithMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await fetchJobs(user.id);
    if (err) setError(err);
    setJobs(data);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const filteredJobs = searchQuery
    ? jobs.filter(j =>
        (j.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (j.company || '').toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : jobs;

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
          <h2 className="font-display font-semibold text-[18px] text-zinc-900">JD 库</h2>
          <span className="text-[12px] text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded">
            {jobs.length} 条
          </span>
        </div>
      </div>

      {jobs.length > 0 && (
        <div className="relative mb-5">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜索岗位标题或公司..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-lg text-[13px] text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 transition-all"
          />
        </div>
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
          <Loader2 size={24} className="animate-spin mb-3" />
          <span className="text-[13px]">加载中...</span>
        </div>
      )}

      {!loading && error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          {error}
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <div className="border border-dashed border-zinc-300 rounded-xl bg-zinc-50/50 p-16 text-center">
          <div className="w-14 h-14 bg-zinc-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Briefcase size={24} className="text-zinc-400" />
          </div>
          <h3 className="text-[15px] font-medium text-zinc-700 mb-2">还没有保存的 JD</h3>
          <p className="text-[13px] text-zinc-500 mb-2">
            在招聘网站划选 JD 后，通过插件分析并保存，即可在这里管理和跟进。
          </p>
        </div>
      )}

      {!loading && filteredJobs.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredJobs.map(job => (
            <button
              key={job.id}
              onClick={() => onOpenJob(job)}
              className="group text-left border border-zinc-200 rounded-xl bg-white hover:border-zinc-300 hover:shadow-md transition-all duration-200 overflow-hidden p-5 flex flex-col gap-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-zinc-900 truncate">
                    {job.title || '未命名岗位'}
                  </p>
                  <p className="text-[12px] text-zinc-500 truncate flex items-center gap-1 mt-0.5">
                    <Briefcase size={11} className="text-zinc-400" />
                    <span>{job.company || '未知公司'}</span>
                    {job.city && <span className="mx-1">· {job.city}</span>}
                  </p>
                </div>
                {job.match && typeof job.match.overall_score === 'number' && (
                  <div className="shrink-0 px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600 text-[11px] font-medium flex flex-col items-center">
                    <span>{job.match.overall_score}</span>
                    <span className="text-[10px] text-emerald-500">匹配</span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-[11px] text-zinc-400 mt-1">
                <span className="flex items-center gap-1">
                  <Clock size={10} />
                  同步于 {formatTime(job.updated_at)}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
                  {statusLabel[job.status] || '待评估'}
                </span>
              </div>

              {job.salary_range && (
                <p className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1">
                  <Target size={10} className="text-zinc-400" />
                  <span>{job.salary_range}</span>
                </p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default JobLibrary;

