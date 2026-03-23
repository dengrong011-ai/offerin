import React, { useState, useCallback, useMemo } from 'react';
import { BookOpen } from 'lucide-react';
import CareerPlanView from './CareerPlan';
import CelebrationModal from './CelebrationModal';
import { updatePlanData } from '../services/planService';
import type { SavedPlan } from '../services/planService';
import type { CareerPlan } from '../types';

interface PlanDetailPageProps {
  savedPlan: SavedPlan;
  onBack: () => void;
  /** 回到计划库「我的笔记本」并筛选当前计划 */
  onOpenLinkedNotes: (planId: string) => void;
}

const PlanDetailPage: React.FC<PlanDetailPageProps> = ({ savedPlan, onBack, onOpenLinkedNotes }) => {
  const [plan, setPlan] = useState<CareerPlan>(savedPlan.plan_data);
  const [showCelebration, setShowCelebration] = useState(false);

  const stats = useMemo(() => {
    const total = plan.tasks.length;
    const completed = plan.tasks.filter(t => t.isCompleted).length;
    return { total, completed, allDone: total > 0 && completed === total };
  }, [plan.tasks]);

  const handleTaskToggle = useCallback(
    (taskId: string) => {
      setPlan(prev => {
        const updated = {
          ...prev,
          tasks: prev.tasks.map(t =>
            t.id === taskId
              ? { ...t, isCompleted: !t.isCompleted, completedAt: t.isCompleted ? undefined : new Date().toISOString() }
              : t,
          ),
        };

        void updatePlanData(savedPlan.id, updated);

        const allDone = updated.tasks.length > 0 && updated.tasks.every(t => t.isCompleted);
        if (allDone) {
          setTimeout(() => setShowCelebration(true), 400);
        }

        return updated;
      });
    },
    [savedPlan.id],
  );

  return (
    <div className="min-h-screen bg-white">
      <main className="container mx-auto px-6 py-8 max-w-4xl">
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenLinkedNotes(savedPlan.id)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-700 bg-zinc-100 hover:bg-zinc-200 rounded-lg transition-colors"
          >
            <BookOpen size={14} />
            查看关联笔记
          </button>
        </div>

        <CareerPlanView
          plan={plan}
          onTaskToggle={handleTaskToggle}
          onBack={onBack}
          backLabel="返回计划列表"
        />
      </main>

      {showCelebration && (
        <CelebrationModal
          totalWeeks={plan.totalWeeks}
          totalTasks={stats.total}
          onClose={() => setShowCelebration(false)}
        />
      )}
    </div>
  );
};

export default PlanDetailPage;
