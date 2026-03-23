import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getSavedPlans, deleteSavedPlan } from '../services/planService';
import type { SavedPlan } from '../services/planService';
import PlanNotes from './PlanNotes';
import {
  Plus,
  Trash2,
  Loader2,
  Clock,
  Target,
  CheckCircle2,
  Calendar,
  ArrowRight,
  ArrowLeft,
  BookOpen,
  ClipboardList,
} from 'lucide-react';

interface PlanLibraryProps {
  onBack: () => void;
  onOpenPlan: (plan: SavedPlan) => void;
  onNewPlan: () => void;
  /** 外部触发：切到「我的笔记本」并筛选该计划 */
  notebookFocusPlanId?: string | null;
  onNotebookFocusConsumed?: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function getProgressColor(pct: number): string {
  if (pct >= 80) return 'bg-emerald-500';
  if (pct >= 40) return 'bg-amber-500';
  return 'bg-zinc-400';
}

type LibraryTab = 'plans' | 'notes';

const PlanLibrary: React.FC<PlanLibraryProps> = ({
  onBack,
  onOpenPlan,
  onNewPlan,
  notebookFocusPlanId,
  onNotebookFocusConsumed,
}) => {
  const { user } = useAuth();
  const [tab, setTab] = useState<LibraryTab>('plans');
  const [notesFilterPlanId, setNotesFilterPlanId] = useState<string | null>(null);
  const [plans, setPlans] = useState<SavedPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPlans = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    const { data, error: err } = await getSavedPlans(user.id);
    if (err) setError(err);
    setPlans(data);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (!notebookFocusPlanId) return;
    setTab('notes');
    setNotesFilterPlanId(notebookFocusPlanId);
    onNotebookFocusConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅响应外部传入的计划 id，避免 consume 回调引用变化导致重复执行
  }, [notebookFocusPlanId]);

  const handleDelete = async (planId: string) => {
    setActionLoading(planId);
    setDeleteConfirmId(null);
    await deleteSavedPlan(planId);
    await loadPlans();
    setActionLoading(null);
  };

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Loader2 size={24} className="animate-spin mx-auto text-zinc-400 mb-3" />
        <p className="text-sm text-zinc-500">加载计划库...</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors mb-4"
        >
          <ArrowLeft size={16} />
          返回首页
        </button>

        <div className="flex items-center gap-6 border-b border-zinc-200 mb-6">
          <button
            type="button"
            onClick={() => setTab('plans')}
            className={`flex items-center gap-1.5 pb-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === 'plans'
                ? 'text-zinc-900 border-zinc-900'
                : 'text-zinc-400 border-transparent hover:text-zinc-600'
            }`}
          >
            <ClipboardList size={14} />
            求职计划
          </button>
          <button
            type="button"
            onClick={() => setTab('notes')}
            className={`flex items-center gap-1.5 pb-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === 'notes'
                ? 'text-zinc-900 border-zinc-900'
                : 'text-zinc-400 border-transparent hover:text-zinc-600'
            }`}
          >
            <BookOpen size={14} />
            我的笔记本
          </button>
        </div>
      </div>

      {tab === 'notes' ? (
        <PlanNotes
          userId={user?.id ?? ''}
          savedPlans={plans}
          filterPlanId={notesFilterPlanId}
          onClearFilter={() => setNotesFilterPlanId(null)}
        />
      ) : (
        <>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">求职计划库</h2>
              <p className="text-sm text-zinc-500 mt-0.5">
                {plans.length > 0 ? `共 ${plans.length} 个计划` : '还没有计划，开始探索吧'}
              </p>
            </div>
            <button
              type="button"
              onClick={onNewPlan}
              className="flex items-center gap-1.5 px-4 py-2 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
            >
              <Plus size={14} />
              新建计划
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {error}
            </div>
          )}

          {plans.length === 0 ? (
            <div className="py-16 text-center">
              <Target size={40} className="mx-auto text-zinc-300 mb-4" />
              <p className="text-zinc-500 mb-1">还没有求职计划</p>
              <p className="text-xs text-zinc-400 mb-6">填写偏好、上传简历，AI 帮你规划求职方向和计划</p>
              <button
                type="button"
                onClick={onNewPlan}
                className="px-6 py-2.5 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
              >
                开始探索
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {plans.map(plan => {
                const pct =
                  plan.total_tasks > 0 ? Math.round((plan.completed_tasks / plan.total_tasks) * 100) : 0;

                return (
                  <div
                    key={plan.id}
                    className="border border-zinc-200 rounded-xl bg-white hover:border-zinc-300 hover:shadow-sm transition-all overflow-hidden"
                  >
                    <div
                      className="px-5 py-4 cursor-pointer flex items-center justify-between gap-4"
                      onClick={() => onOpenPlan(plan)}
                    >
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-zinc-900 truncate">{plan.title}</h3>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs text-zinc-500">
                          <span className="flex items-center gap-1">
                            <Target size={10} />
                            {plan.direction_name}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar size={10} />
                            {plan.total_weeks} 周
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {formatDate(plan.updated_at)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 mt-2.5">
                          <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${getProgressColor(pct)}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-zinc-500 shrink-0 flex items-center gap-1">
                            <CheckCircle2 size={10} />
                            {plan.completed_tasks}/{plan.total_tasks}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {deleteConfirmId === plan.id ? (
                          <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => void handleDelete(plan.id)}
                              disabled={actionLoading === plan.id}
                              className="px-2 py-1 text-xs text-red-600 bg-red-50 rounded hover:bg-red-100 transition-colors"
                            >
                              确认删除
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              className="px-2 py-1 text-xs text-zinc-500 bg-zinc-100 rounded hover:bg-zinc-200 transition-colors"
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              setDeleteConfirmId(plan.id);
                            }}
                            className="p-1.5 text-zinc-400 hover:text-red-500 rounded-lg hover:bg-zinc-100 transition-colors"
                            title="删除"
                          >
                            {actionLoading === plan.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Trash2 size={14} />
                            )}
                          </button>
                        )}
                        <ArrowRight size={16} className="text-zinc-300" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default PlanLibrary;
