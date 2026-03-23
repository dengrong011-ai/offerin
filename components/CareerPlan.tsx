import React, { useState, useMemo } from 'react';
import { CheckCircle2, Circle, ChevronDown, ChevronRight, ArrowLeft, Calendar, Target, Sparkles } from 'lucide-react';
import type { CareerPlan as CareerPlanType, PlanTask, Phase } from '../types';

const WEEKLY_CHEERS = [
  '这周的目标全部达成，继续保持！',
  '又完成一周，离 offer 更近一步了',
  '稳扎稳打，节奏很棒',
  '一步一个脚印，你很棒！',
  '坚持就是胜利，本周完美收官',
  '本周全部搞定，给自己点个赞吧',
  '这周效率满满，继续加油！',
];

function pickCheer(week: number): string {
  return WEEKLY_CHEERS[week % WEEKLY_CHEERS.length];
}

interface CareerPlanProps {
  plan: CareerPlanType;
  onTaskToggle: (taskId: string) => void;
  onBack: () => void;
  /** 计划库等场景可改为「返回计划列表」 */
  backLabel?: string;
  /** 弹窗内嵌：隐藏顶部返回与主标题，由外层卡片头承载 */
  embedInModal?: boolean;
}

function getPhaseBadgeStyle(phase: string): string {
  if (phase === '准备期') return 'bg-blue-50 text-blue-600 border-blue-200';
  if (phase === '投递期') return 'bg-purple-50 text-purple-600 border-purple-200';
  return 'bg-zinc-50 text-zinc-500 border-zinc-200';
}

function getPriorityDot(priority: string): string {
  if (priority === 'high') return 'bg-red-400';
  if (priority === 'medium') return 'bg-amber-400';
  return 'bg-zinc-300';
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const CareerPlanView: React.FC<CareerPlanProps> = ({
  plan,
  onTaskToggle,
  onBack,
  backLabel = '返回方向推荐',
  embedInModal = false,
}) => {
  const [expandedWeeks, setExpandedWeeks] = useState<Set<number>>(() => {
    const firstIncompleteWeek = plan.tasks.find(t => !t.isCompleted)?.weekNumber;
    return new Set(firstIncompleteWeek !== undefined ? [firstIncompleteWeek] : [1]);
  });

  const toggleWeek = (week: number) => {
    setExpandedWeeks(prev => {
      const next = new Set(prev);
      if (next.has(week)) next.delete(week);
      else next.add(week);
      return next;
    });
  };

  const tasksByWeek = useMemo(() => {
    const map = new Map<number, PlanTask[]>();
    plan.tasks.forEach(task => {
      const list = map.get(task.weekNumber) || [];
      list.push(task);
      map.set(task.weekNumber, list);
    });
    return map;
  }, [plan.tasks]);

  const completedCount = plan.tasks.filter(t => t.isCompleted).length;
  const totalCount = plan.tasks.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const currentWeek = useMemo(() => {
    if (!plan.startDate) return 1;
    const start = new Date(plan.startDate);
    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    return Math.max(1, Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000)));
  }, [plan.startDate]);

  const getPhaseForWeek = (week: number): Phase | undefined => {
    return plan.phases.find(p => week >= p.weekStart && week <= p.weekEnd);
  };

  return (
    <div className={embedInModal ? '' : 'max-w-2xl mx-auto'}>
      {!embedInModal && (
        <div className="mb-6">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-700 transition-colors mb-3"
          >
            <ArrowLeft size={14} />
            {backLabel}
          </button>
          <h2 className="text-xl font-semibold text-zinc-900 mb-1">{plan.title.replace(/(.*)(求职计划)$/, '$1  求职计划')}</h2>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Calendar size={12} />
              共 {plan.totalWeeks} 周
            </span>
            <span>当前第 {Math.min(currentWeek, plan.totalWeeks)} 周</span>
            {plan.targetDate && (
              <span className="flex items-center gap-1">
                <Target size={12} />
                目标 {plan.targetDate}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mb-6 p-4 bg-zinc-50 rounded-xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-zinc-700">总进度</span>
          <span className="text-sm text-zinc-500">{completedCount}/{totalCount} 完成 ({progressPercent}%)</span>
        </div>
        <div className="w-full h-2 bg-zinc-200 rounded-full overflow-hidden">
          <div className="h-full bg-zinc-900 rounded-full transition-all duration-500" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="flex gap-2 mt-3">
          {plan.phases.map(phase => (
            <div key={phase.name} className="flex items-center gap-1.5">
              <span className={`px-2 py-0.5 text-[10px] font-medium rounded border ${getPhaseBadgeStyle(phase.name)}`}>
                {phase.name}
              </span>
              <span className="text-[10px] text-zinc-400">
                {formatDate(phase.startDate)} – {formatDate(phase.endDate)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {Array.from({ length: plan.totalWeeks }, (_, i) => i + 1).map(week => {
          const tasks = tasksByWeek.get(week) || [];
          const isExpanded = expandedWeeks.has(week);
          const weekCompleted = tasks.filter(t => t.isCompleted).length;
          const weekAllDone = tasks.length > 0 && weekCompleted === tasks.length;
          const phase = getPhaseForWeek(week);
          const isCurrent = week === Math.min(currentWeek, plan.totalWeeks);

          return (
            <div key={week} className={`border rounded-xl overflow-hidden transition-all ${isCurrent ? 'border-zinc-400 shadow-sm' : 'border-zinc-200'}`}>
              <button
                onClick={() => toggleWeek(week)}
                className={`w-full px-4 py-3 flex items-center justify-between text-left ${isCurrent ? 'bg-zinc-50' : 'hover:bg-zinc-50'} transition-colors`}
              >
                <div className="flex items-center gap-2">
                  {isExpanded ? <ChevronDown size={14} className="text-zinc-400" /> : <ChevronRight size={14} className="text-zinc-400" />}
                  <span className={`text-sm font-medium ${isCurrent ? 'text-zinc-900' : 'text-zinc-700'}`}>第 {week} 周</span>
                  {isCurrent && <span className="px-1.5 py-0.5 bg-zinc-900 text-white text-[10px] rounded-md font-medium">当前</span>}
                  {phase && (
                    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${getPhaseBadgeStyle(phase.name)}`}>
                      {phase.name}
                    </span>
                  )}
                  {weekAllDone && <Sparkles size={14} className="text-amber-400" />}
                </div>
                <span className="text-xs text-zinc-400">{weekCompleted}/{tasks.length} 完成</span>
              </button>
              {isExpanded && tasks.length > 0 && (
                <div className="border-t border-zinc-100">
                  {weekAllDone && (
                    <div className="px-4 py-2 bg-amber-50 text-amber-700 text-xs flex items-center gap-1.5">
                      <Sparkles size={12} />
                      {pickCheer(week)}
                    </div>
                  )}
                  <div className="divide-y divide-zinc-50">
                    {tasks.map(task => (
                      <TaskItem key={task.id} task={task} onToggle={onTaskToggle} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const TaskItem: React.FC<{ task: PlanTask; onToggle: (id: string) => void }> = ({ task, onToggle }) => {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <button onClick={() => onToggle(task.id)} className="mt-0.5 shrink-0">
          {task.isCompleted ? (
            <CheckCircle2 size={18} className="text-emerald-500" />
          ) : (
            <Circle size={18} className="text-zinc-300 hover:text-zinc-500 transition-colors" />
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${getPriorityDot(task.priority)}`} />
            <span className={`text-sm ${task.isCompleted ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>{task.title}</span>
          </div>
          {task.description && (
            <p className="text-xs text-zinc-500 mt-1 ml-3.5">
              <span className="font-medium">目标：</span>{task.description}
            </p>
          )}
          {task.completionCriteria && (
            <p className="text-xs text-zinc-500 mt-1 ml-3.5">
              <span className="font-medium">完成标准：</span>{task.completionCriteria}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default CareerPlanView;
