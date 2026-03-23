import React from 'react';
import { CheckCircle2, XCircle, Lightbulb, ArrowRight, DollarSign, TrendingUp, Users, Route } from 'lucide-react';
import type { DirectionRecommendation, DimensionScore } from '../types';

interface DirectionCardProps {
  direction: DirectionRecommendation;
  rank: number;
  onSelect: (direction: DirectionRecommendation) => void;
  onDismiss: (direction: DirectionRecommendation) => void;
  /** 生成虚构参考 JD（Demo），占用职业探索配额 */
  onDemoJd?: (direction: DirectionRecommendation) => void;
  demoJdLoadingFor?: string | null;
  /** 免费档计费额度已用尽时禁用 */
  demoJdDisabled?: boolean;
  /** 额度用尽时点击「生成参考 JD」改为打开会员（与 ExplorePage 传入同一回调） */
  onDemoJdQuotaBlocked?: () => void;
}

function getScoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-red-500';
}

function getScoreBg(score: number): string {
  if (score >= 75) return 'bg-emerald-50 border-emerald-200';
  if (score >= 50) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

function getBarColor(score: number): string {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-400';
}

function safeDim(dim: DimensionScore | undefined | null): DimensionScore {
  if (dim && typeof dim === 'object' && typeof dim.score === 'number') return dim;
  return { score: 0, reason: '数据缺失' };
}

function DimensionRow({ label, dim }: { label: string; dim: DimensionScore | undefined | null }) {
  const safe = safeDim(dim);
  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="flex items-center gap-1.5 shrink-0 w-24">
        <span className="text-xs font-medium text-zinc-600">{label}</span>
        <span className={`text-xs font-bold ${getScoreColor(safe.score)}`}>{safe.score}</span>
      </div>
      <div className="flex-1 pt-0.5">
        <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden mb-1">
          <div
            className={`h-full rounded-full ${getBarColor(safe.score)}`}
            style={{ width: `${safe.score}%` }}
          />
        </div>
        <p className="text-[11px] text-zinc-500 leading-relaxed">{safe.reason}</p>
      </div>
    </div>
  );
}

const DirectionCard: React.FC<DirectionCardProps> = ({
  direction,
  rank,
  onSelect,
  onDismiss,
  onDemoJd,
  demoJdLoadingFor,
  demoJdDisabled,
  onDemoJdQuotaBlocked,
}) => {
  return (
    <div className="border border-zinc-200 rounded-xl bg-white overflow-hidden">
      {/* Header: name + score */}
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-medium text-zinc-400">#{rank}</span>
            <h3 className="font-semibold text-[15px] text-zinc-900">{direction.directionName}</h3>
          </div>
          <div className="space-y-1.5 text-xs text-zinc-500">
            <div className="flex items-center gap-1.5">
              <DollarSign size={11} className="text-zinc-400 shrink-0" />
              <span>薪资：{direction.marketSalary}</span>
              <span className="text-emerald-600">{direction.salaryTrend}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendingUp size={11} className="text-zinc-400 shrink-0" />
              <span>需求：{direction.demandTrend}</span>
              <span className="mx-1">·</span>
              <span>{direction.talentGap}</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Route size={11} className="text-zinc-400 shrink-0 mt-0.5" />
              <span>路径：{direction.careerPath}</span>
            </div>
          </div>
        </div>
        <div className={`w-14 h-14 rounded-xl border flex flex-col items-center justify-center shrink-0 ${getScoreBg(direction.matchScore)}`}>
          <span className={`text-lg font-bold ${getScoreColor(direction.matchScore)}`}>{direction.matchScore}</span>
          <span className="text-[10px] text-zinc-400">匹配</span>
        </div>
      </div>

      {/* Dimension scores — always visible */}
      <div className="px-5 py-3 bg-zinc-50/50 border-t border-b border-zinc-100 space-y-0.5">
        <DimensionRow label="偏好契合" dim={direction.preferenceMatch} />
        <DimensionRow label="能力匹配" dim={direction.abilityMatch} />
        <DimensionRow label="市场前景" dim={direction.marketOutlook} />
      </div>

      {/* Strengths & Gaps — always visible */}
      <div className="px-5 py-3 space-y-3">
        {direction.strengths.length > 0 && (
          <div>
            <p className="text-xs font-medium text-emerald-600 mb-1.5 flex items-center gap-1">
              <CheckCircle2 size={12} /> 已具备
            </p>
            <div className="flex flex-wrap gap-1.5">
              {direction.strengths.map((s, i) => (
                <span key={i} className="px-2 py-1 bg-zinc-100 text-zinc-700 text-xs rounded-md">{s}</span>
              ))}
            </div>
          </div>
        )}

        {direction.gaps.length > 0 && (
          <div>
            <p className="text-xs font-medium text-red-500 mb-1.5 flex items-center gap-1">
              <XCircle size={12} /> 缺少
            </p>
            <div className="flex flex-wrap gap-1.5">
              {direction.gaps.map((g, i) => (
                <span key={i} className="px-2 py-1 bg-zinc-100 text-zinc-700 text-xs rounded-md">{g}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Focus points & search keywords — always visible */}
      {(direction.focusPoints.length > 0 || direction.suggestedSearchKeywords.length > 0) && (
        <div className="px-5 py-3 space-y-3 border-t border-zinc-100">
          {direction.focusPoints.length > 0 && (
            <div>
              <p className="text-xs font-medium text-amber-600 mb-1.5 flex items-center gap-1">
                <Lightbulb size={12} /> 准备重点
              </p>
              <ul className="space-y-1">
                {direction.focusPoints.map((f, i) => (
                  <li key={i} className="text-xs text-zinc-600 pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-amber-400">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {direction.suggestedSearchKeywords.length > 0 && (
            <div>
              <p className="text-xs text-zinc-400 mb-1.5">推荐搜索词</p>
              <div className="flex flex-wrap gap-1.5">
                {direction.suggestedSearchKeywords.map((kw, i) => (
                  <span key={i} className="px-2 py-1 bg-zinc-100 text-zinc-600 text-xs rounded-md">{kw}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action buttons：左侧生成参考 JD，右侧生成计划；均为灰色 */}
      <div className="flex flex-col gap-2 px-5 py-3 border-t border-zinc-100">
        <div className="flex flex-wrap gap-2">
          {onDemoJd && (
            <button
              type="button"
              disabled={demoJdLoadingFor === direction.directionName}
              title={demoJdDisabled ? '免费体验计费额度已用完，点击开通会员' : undefined}
              onClick={() => {
                if (demoJdDisabled) {
                  onDemoJdQuotaBlocked?.();
                  return;
                }
                onDemoJd(direction);
              }}
              className={`flex-1 min-w-[140px] py-2.5 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center ${
                demoJdDisabled
                  ? 'bg-amber-50 text-amber-900 border-amber-200 hover:bg-amber-100'
                  : 'bg-zinc-200 text-zinc-800 border-zinc-300 hover:bg-zinc-300 disabled:opacity-50'
              }`}
            >
              {demoJdLoadingFor === direction.directionName
                ? '生成中…'
                : demoJdDisabled
                  ? '额度已用尽 · 开通会员'
                  : '生成参考JD（demo）'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onSelect(direction)}
            className="flex-1 min-w-[160px] py-2.5 rounded-lg text-sm font-medium bg-zinc-200 text-zinc-800 border border-zinc-300 hover:bg-zinc-300 transition-colors flex items-center justify-center gap-1.5"
          >
            我感兴趣 <ArrowRight size={14} /> 生成计划
          </button>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(direction)}
          className="w-full py-2 text-sm text-zinc-400 hover:text-zinc-600 transition-colors"
        >
          不考虑
        </button>
      </div>
    </div>
  );
};

export default DirectionCard;
