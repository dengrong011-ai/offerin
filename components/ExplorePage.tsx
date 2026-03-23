import React, { useState, useCallback, useEffect, useRef } from 'react';
import { ArrowLeft, Calendar, Sparkles, CheckCircle2, Save, BookOpen, X, Copy, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import ExplorePreferences from './ExplorePreferences';
import DirectionCard from './DirectionCard';
import CareerPlanView from './CareerPlan';
import MarkdownRenderer from './MarkdownRenderer';
import { generateUserProfile, getDirectionRecommendations, generateCareerPlan, generateDemoJd } from '../services/careerService';
import { createSavedPlan, updatePlanData } from '../services/planService';
import { getCareerExploreQuota, type CareerExploreQuota } from '../services/authService';
import {
  createSavedJd,
  parseTagInput,
  stripLeadingMarkdownH1,
  mergeWithSystemJdTags,
  JD_LIBRARY_TAG_GENERATED_DEMO,
} from '../services/savedJdService';
import type { UserPreferences, UserProfile, DirectionRecommendation, CareerPlan } from '../types';

function formatCareerExploreError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg.includes('CAREER_EXPLORE_DAILY_LIMIT_EXCEEDED')) {
    return '今日职业探索 AI 调用已达上限（50 次），请明天再试。';
  }
  if (msg.includes('CAREER_EXPLORE_MONTHLY_LIMIT_EXCEEDED')) {
    return '本月职业探索计费步数已达上限（50 次），下月再试或升级老 VIP 体系（如有）。';
  }
  if (msg.includes('CAREER_EXPLORE_TRIAL_EXCEEDED')) {
    return '免费职业探索体验已用完（画像 / 方向 / 参考 JD（Demo）/ 计划：每次成功调用各计 1 次，共用 3 次计费额度；同一步 24h 内第 2 次成功不扣）。升级会员后可继续使用。';
  }
  if (msg.includes('INVALID_CAREER_EXPLORE_STEP')) return '请刷新页面后重试。';
  if (msg.includes('UNAUTHORIZED')) return '请先登录后再使用职业探索。';
  return msg || '操作失败，请稍后重试';
}

type SubStep = 'preferences' | 'loading' | 'directions' | 'plan_setup';

interface ExplorePageProps {
  onBack: () => void;
  onOpenPlanLibrary?: () => void;
  onOpenJdLibrary?: () => void;
  /** 首页已填写的简历正文：进入职业探索时若本页简历为空则自动带入一次（避免误以为「识别不到」） */
  initialResumeFromApp?: string;
}

const ExplorePage: React.FC<ExplorePageProps> = ({
  onBack,
  onOpenPlanLibrary,
  onOpenJdLibrary,
  initialResumeFromApp,
}) => {
  const { user } = useAuth();
  const [subStep, setSubStep] = useState<SubStep>('preferences');
  const [loadingMessage, setLoadingMessage] = useState('');
  /** 画像/方向 流式输出尾部预览（JSON 片段，仅缓解等待感） */
  const [streamPreview, setStreamPreview] = useState('');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [directions, setDirections] = useState<DirectionRecommendation[]>([]);
  const [dismissedDirections, setDismissedDirections] = useState<Set<string>>(new Set());
  const [selectedDirection, setSelectedDirection] = useState<DirectionRecommendation | null>(null);
  const [planMode, setPlanMode] = useState<'ai_suggested' | 'user_deadline'>('ai_suggested');
  const [targetDate, setTargetDate] = useState('');
  const [plan, setPlan] = useState<CareerPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [savedPlanId, setSavedPlanId] = useState<string | null>(null);
  const [quota, setQuota] = useState<CareerExploreQuota | null>(null);
  const [jdDemo, setJdDemo] = useState<{ direction: DirectionRecommendation; text: string } | null>(null);
  const [demoJdLoadingFor, setDemoJdLoadingFor] = useState<string | null>(null);
  const [jdSaveModalOpen, setJdSaveModalOpen] = useState(false);
  const [jdSaveTitle, setJdSaveTitle] = useState('');
  const [jdSaveTagsInput, setJdSaveTagsInput] = useState('');
  const [jdSaveSubmitting, setJdSaveSubmitting] = useState(false);
  const [jdSaveOkHint, setJdSaveOkHint] = useState<string | null>(null);
  /** 求职计划预览弹窗（与参考 JD demo 一致，关闭后仍停留在计划生成页） */
  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [planSaveLoading, setPlanSaveLoading] = useState(false);
  const [planSaveError, setPlanSaveError] = useState<string | null>(null);
  /** 简历正文与标签必须在父级持有：偏好子组件在 loading 时会卸载，若仅存于子 state 会导致提交时空串或「重新分析」后丢失 */
  const [exploreResumeText, setExploreResumeText] = useState('');
  const [exploreResumeLabel, setExploreResumeLabel] = useState<string | null>(null);
  const seededResumeFromApp = useRef(false);

  /** 与首页简历互通：仅当本页仍为空时从 App 带入一次，避免覆盖用户从简历库载入的内容 */
  useEffect(() => {
    if (seededResumeFromApp.current) return;
    const t = initialResumeFromApp?.trim();
    if (!t) return;
    setExploreResumeText((prev) => {
      if (prev.trim()) return prev;
      seededResumeFromApp.current = true;
      return t;
    });
  }, [initialResumeFromApp]);

  const refreshQuota = useCallback(async () => {
    if (!user?.id) {
      setQuota(null);
      return;
    }
    const q = await getCareerExploreQuota(user.id);
    setQuota(q);
  }, [user?.id]);

  /** 职业探索成功调用后：立即拉取 + 短延迟再拉一次（避免代理记账与读库竞态） */
  const refreshQuotaAfterMutation = useCallback(() => {
    void refreshQuota();
    window.setTimeout(() => void refreshQuota(), 600);
  }, [refreshQuota]);

  /** 发起请求前拉库：免费/resume_pass 共 3 次计费池，避免 UI 仍显示 3/3 时误点第 4 步 */
  const ensureTrialBillableSlots = useCallback(
    async (minNeed: number): Promise<boolean> => {
      if (!user?.id) {
        setError('请先登录后再使用职业探索');
        return false;
      }
      const fresh = await getCareerExploreQuota(user.id);
      setQuota(fresh);
      if (!fresh || fresh.trialBillableRemaining === null) return true;
      if (fresh.trialBillableRemaining < minNeed) {
        if (minNeed >= 2) {
          setError(
            '免费体验计费额度不足：完成「画像 + 方向」需要 2 次（画像、方向、参考 JD、计划共 3 次；同一步 24h 内第 2 次成功不扣）。升级会员后可继续使用。'
          );
        } else {
          setError(
            '免费体验计费额度已用完（画像、方向、参考 JD、计划共 3 次；同一步 24h 内第 2 次成功不扣）。升级会员后可继续使用。'
          );
        }
        return false;
      }
      return true;
    },
    [user?.id],
  );

  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);

  useEffect(() => {
    if (!jdDemo) setJdSaveModalOpen(false);
  }, [jdDemo]);

  const handlePreferencesSubmit = useCallback(
    async (prefs: UserPreferences) => {
      const resumeText = exploreResumeText.trim();
      if (!resumeText) {
        setError('请先上传简历、粘贴文本或从简历库选择');
        return;
      }
      // 画像+方向连续执行需 2 个计费槽位，先校验免费额度是否足够
      const ok = await ensureTrialBillableSlots(2);
      if (!ok) return;
      setLoading(true);
      setError(null);
      setSubStep('loading');
      setStreamPreview('');

      try {
        setLoadingMessage('正在分析你的简历，生成职业画像（流式输出）...');
        setStreamPreview('');
        const userProfile = await generateUserProfile(prefs, resumeText, {
          onStreamChunk: (acc) => setStreamPreview(acc.slice(-800)),
          onStreamFallback: () => {
            setLoadingMessage('网络不稳定，已改为普通请求生成画像，请稍候…');
            setStreamPreview('');
          },
        });
        setProfile(userProfile);

        setLoadingMessage('正在根据你的画像和偏好匹配方向（流式输出）...');
        setStreamPreview('');
        const result = await getDirectionRecommendations(prefs, userProfile, resumeText, {
          onStreamChunk: (acc) => setStreamPreview(acc.slice(-800)),
          onStreamFallback: () => {
            setLoadingMessage('网络不稳定，已改为普通请求匹配方向，请稍候…');
            setStreamPreview('');
          },
        });
        setDirections(result);
        setSubStep('directions');
        refreshQuotaAfterMutation();
      } catch (e: unknown) {
        setError(formatCareerExploreError(e));
        setSubStep('preferences');
      } finally {
        setLoading(false);
        setLoadingMessage('');
        setStreamPreview('');
      }
    },
    [exploreResumeText, ensureTrialBillableSlots, refreshQuotaAfterMutation],
  );

  const handleSelectDirection = useCallback((direction: DirectionRecommendation) => {
    setSelectedDirection(direction);
    setSubStep('plan_setup');
    setPlan(null);
    setPlanModalOpen(false);
    setPlanSaveError(null);
    setSaveStatus('idle');
    setSavedPlanId(null);
  }, []);

  const handleDismissDirection = useCallback((direction: DirectionRecommendation) => {
    setDismissedDirections(prev => new Set(prev).add(direction.directionName));
  }, []);

  const handleDemoJd = useCallback(
    async (direction: DirectionRecommendation) => {
      if (!profile) return;
      // JD Demo 需 1 个计费槽位，先校验免费额度
      const ok = await ensureTrialBillableSlots(1);
      if (!ok) return;
      setDemoJdLoadingFor(direction.directionName);
      setError(null);
      try {
        const text = await generateDemoJd(direction, profile);
        setJdDemo({ direction, text });
        refreshQuotaAfterMutation();
      } catch (e: unknown) {
        setError(formatCareerExploreError(e));
      } finally {
        setDemoJdLoadingFor(null);
      }
    },
    [profile, ensureTrialBillableSlots, refreshQuotaAfterMutation],
  );

  const openJdSaveModal = useCallback(() => {
    if (!user?.id) {
      setError('请先登录后再保存到 JD 库');
      return;
    }
    if (!jdDemo) return;
    setJdSaveTitle(jdDemo.direction.directionName.slice(0, 120));
    setJdSaveTagsInput('');
    setJdSaveOkHint(null);
    setJdSaveModalOpen(true);
  }, [user?.id, jdDemo]);

  const handleConfirmSaveJd = useCallback(async () => {
    if (!user?.id || !jdDemo) return;
    const title = jdSaveTitle.trim();
    if (!title) {
      setError('请填写 JD 标题');
      return;
    }
    setJdSaveSubmitting(true);
    setError(null);
    const tags = mergeWithSystemJdTags(parseTagInput(jdSaveTagsInput), JD_LIBRARY_TAG_GENERATED_DEMO);
    const { data, error: err } = await createSavedJd({
      userId: user.id,
      title,
      content: jdDemo.text,
      tags,
    });
    setJdSaveSubmitting(false);
    if (!data) {
      setError(err || '保存失败');
      return;
    }
    setJdSaveModalOpen(false);
    setJdSaveOkHint('已保存到 JD 库');
    window.setTimeout(() => setJdSaveOkHint(null), 5000);
  }, [user?.id, jdDemo, jdSaveTitle, jdSaveTagsInput]);

  const handleGeneratePlan = useCallback(async () => {
    if (!selectedDirection || !profile) return;
    // 计划生成需 1 个计费槽位，先校验免费额度
    const ok = await ensureTrialBillableSlots(1);
    if (!ok) return;
    setLoading(true);
    setError(null);
    try {
      const result = await generateCareerPlan(
        selectedDirection,
        planMode,
        planMode === 'user_deadline' && targetDate ? targetDate : undefined
      );
      setPlan(result);
      setSaveStatus('idle');
      setSavedPlanId(null);
      setPlanSaveError(null);
      setPlanModalOpen(true);
      refreshQuotaAfterMutation();
    } catch (e: unknown) {
      setError(formatCareerExploreError(e));
    } finally {
      setLoading(false);
    }
  }, [selectedDirection, profile, planMode, targetDate, ensureTrialBillableSlots, refreshQuotaAfterMutation]);

  const handleSavePlan = useCallback(async () => {
    if (!plan || !selectedDirection || !profile || !user) return;
    setPlanSaveLoading(true);
    setPlanSaveError(null);
    const { data, error: saveErr } = await createSavedPlan({
      userId: user.id,
      plan,
      direction: selectedDirection,
      profile,
    });
    setPlanSaveLoading(false);
    if (data) {
      setSavedPlanId(data.id);
      setSaveStatus('saved');
    } else {
      setPlanSaveError(saveErr || '保存失败，请稍后重试');
    }
  }, [plan, selectedDirection, profile, user]);

  const handleTaskToggle = useCallback((taskId: string) => {
    setPlan(prev => {
      if (!prev) return prev;
      const updated = {
        ...prev,
        tasks: prev.tasks.map(t =>
          t.id === taskId
            ? { ...t, isCompleted: !t.isCompleted, completedAt: t.isCompleted ? undefined : new Date().toISOString() }
            : t
        ),
      };
      if (savedPlanId) {
        updatePlanData(savedPlanId, updated);
      }
      return updated;
    });
  }, [savedPlanId]);

  const handleBackToDirections = useCallback(() => {
    setPlanModalOpen(false);
    setPlanSaveError(null);
    setSubStep('directions');
    setSelectedDirection(null);
    setPlan(null);
    setSaveStatus('idle');
    setSavedPlanId(null);
    setPlanMode('ai_suggested');
    setTargetDate('');
  }, []);

  const closePlanModal = useCallback(() => {
    setPlanModalOpen(false);
    setPlanSaveError(null);
  }, []);

  const handleBackToPreferences = useCallback(() => {
    setPlanModalOpen(false);
    setSubStep('preferences');
    setProfile(null);
    setDirections([]);
    setDismissedDirections(new Set());
    setPlan(null);
    setSaveStatus('idle');
    setSavedPlanId(null);
  }, []);

  const visibleDirections = directions.filter(d => !dismissedDirections.has(d.directionName));

  const showQuotaDaily =
    !!quota &&
    quota.dailyRemaining !== null &&
    quota.dailyRemaining < 50;
  const showQuotaMonthly =
    !!quota &&
    quota.monthlyCareerRemaining !== undefined &&
    quota.monthlyCareerRemaining < 50;
  const showQuotaTrial = !!quota && quota.trialBillableRemaining !== null;
  const showCareerQuotaBanner =
    showQuotaDaily || showQuotaMonthly || showQuotaTrial;
  /** 免费档：画像+方向首步需 2 格；JD / 计划各 1 格；四步共用 3 格 */
  const trialQuotaBlocksFirstFlow =
    !!quota && quota.trialBillableRemaining !== null && quota.trialBillableRemaining < 2;
  const trialQuotaBlocksOneStep =
    !!quota && quota.trialBillableRemaining !== null && quota.trialBillableRemaining < 1;

  /** 本地配置了 VITE_GEMINI_API_KEY 且未配 VITE_REMOTE_PROXY_URL 时走直连，请求不经过 /api/gemini/proxy，服务端不会写入 usage_logs，额度条始终满格 */
  const viteEnv = (import.meta as unknown as { env: Record<string, string | boolean | undefined> }).env;
  const localDirectGeminiSkipsServerQuota =
    !!viteEnv?.DEV &&
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    !!viteEnv.VITE_GEMINI_API_KEY &&
    !viteEnv.VITE_REMOTE_PROXY_URL;

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-zinc-200 py-4">
        <div className="container mx-auto px-6 max-w-4xl flex items-center justify-between">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
          >
            <ArrowLeft size={16} />
            返回首页
          </button>
          <h1 className="text-[15px] font-semibold text-zinc-800">探索方向</h1>
          <div className="w-16" />
        </div>
      </header>

      <main className="container mx-auto px-6 py-8 max-w-4xl">
        {localDirectGeminiSkipsServerQuota && (
          <div className="mb-4 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-[12px] text-amber-900">
            开发环境：当前为<strong className="font-medium">本地直连 Gemini</strong>（未走线上代理），用量<strong>不会写入</strong>数据库，下方「免费体验计费额度」不会减少。验证扣减请在{' '}
            <span className="font-medium">offerin.co</span> 测试，或在 <code className="text-[11px] bg-amber-100/80 px-1 rounded">.env.local</code> 中配置{' '}
            <code className="text-[11px] bg-amber-100/80 px-1 rounded">VITE_REMOTE_PROXY_URL</code> 指向线上同源以走代理。
          </div>
        )}
        {showCareerQuotaBanner && quota && (
          <div className="mb-4 px-3 py-2.5 rounded-xl bg-zinc-50 border border-zinc-100 text-[12px] text-zinc-600 flex flex-wrap gap-x-4 gap-y-1">
            {showQuotaDaily && (
              <span>
                今日职业探索剩余 <strong className="text-zinc-800">{quota.dailyRemaining}</strong> / 50 次
              </span>
            )}
            {showQuotaMonthly && (
              <span>
                本月职业探索计费步剩余 <strong className="text-zinc-800">{quota.monthlyCareerRemaining}</strong> / 50
              </span>
            )}
            {showQuotaTrial && (
              <span>
                免费体验计费额度剩余 <strong className="text-zinc-800">{quota.trialBillableRemaining}</strong> / 3
                <span className="text-zinc-400 ml-1">
                  （上限共 3 次计费：画像、方向、JD Demo、计划四步共用；点一次「AI 推荐方向」会先画像再方向共 2 次；同一步 24h 内第 2 次成功不扣）
                </span>
              </span>
            )}
          </div>
        )}
        {saveStatus === 'saved' && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-sm text-emerald-700 flex items-center gap-2">
            <CheckCircle2 size={16} />
            计划已保存到计划库，可随时回来继续打卡。
            {onOpenPlanLibrary && (
              <button onClick={onOpenPlanLibrary} className="ml-2 underline font-medium hover:text-emerald-800">
                前往计划库（含笔记本）
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            {error}
          </div>
        )}

        {subStep === 'preferences' && (
          <ExplorePreferences
            onSubmit={handlePreferencesSubmit}
            isLoading={loading}
            trialQuotaBlocksFirstFlow={trialQuotaBlocksFirstFlow}
            resumeText={exploreResumeText}
            onResumeTextChange={setExploreResumeText}
            resumeLabel={exploreResumeLabel}
            onResumeLabelChange={setExploreResumeLabel}
          />
        )}

        {subStep === 'loading' && (
          <div className="max-w-2xl mx-auto py-16 text-center">
            <div className="w-12 h-12 border-2 border-zinc-200 border-t-zinc-900 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-zinc-600 mb-2">{loadingMessage}</p>
            <p className="text-[11px] text-zinc-400 mb-3">内容将以流式到达，下方为实时输出尾部（JSON 结构，生成完成后会解析为画像与方向卡片）</p>
            {streamPreview ? (
              <pre className="mx-auto max-w-full text-left text-[11px] leading-relaxed text-zinc-500 bg-zinc-50 border border-zinc-100 rounded-xl p-3 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">
                {streamPreview}
              </pre>
            ) : null}
          </div>
        )}

        {subStep === 'directions' && (
          <div className="space-y-6">
            {profile && (
              <div className="mb-4 p-5 bg-zinc-50 rounded-xl border border-zinc-100">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-3">
                    <p className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide">职业画像</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-zinc-800">{profile.currentRole}</p>
                      {profile.yearsOfExperience != null && (
                        <span className="text-xs text-zinc-500">· {profile.yearsOfExperience} 年经验</span>
                      )}
                      {profile.educationLevel && profile.educationLevel !== '未提供' && (
                        <span className="text-xs text-zinc-500">· {profile.educationLevel}</span>
                      )}
                    </div>
                    <div>
                      <p className="text-[11px] font-medium text-zinc-500 mb-1">画像摘要</p>
                      <p className="text-[13px] text-zinc-700 leading-relaxed">{profile.summary}</p>
                    </div>
                    {profile.highlights && profile.highlights.length > 0 && (
                      <div>
                        <p className="text-[11px] font-medium text-zinc-500 mb-1.5">职业亮点</p>
                        <ul className="space-y-1">
                          {profile.highlights.slice(0, 4).map((h, idx) => (
                            <li key={idx} className="text-[12px] text-zinc-600 pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-zinc-400">
                              {h}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {(profile.industries?.length > 0 || profile.coreSkills?.length > 0) && (
                      <div className="space-y-2 pt-1">
                        {profile.industries?.length > 0 && (
                          <div>
                            <p className="text-[11px] font-medium text-zinc-500 mb-1">行业</p>
                            <div className="flex flex-wrap gap-1.5">
                              {profile.industries.map((i, idx) => (
                                <span key={`i-${idx}`} className="px-2 py-0.5 bg-white border border-zinc-200 text-zinc-600 text-[11px] rounded-md">
                                  {i}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {profile.coreSkills?.length > 0 && (
                          <div>
                            <p className="text-[11px] font-medium text-zinc-500 mb-1">核心技能</p>
                            <div className="flex flex-wrap gap-1.5">
                              {profile.coreSkills.map((s, idx) => (
                                <span key={`s-${idx}`} className="px-2 py-0.5 bg-zinc-200/50 text-zinc-700 text-[11px] rounded-md">
                                  {s}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleBackToPreferences}
                    className="text-xs text-zinc-400 hover:text-zinc-600 transition-colors shrink-0"
                  >
                    重新分析
                  </button>
                </div>
              </div>
            )}
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-zinc-900 mb-1">为你推荐的方向</h2>
              <p className="text-sm text-zinc-500">
                基于你的简历画像和偏好推荐，查看各维度匹配详情
              </p>
            </div>
            {visibleDirections.length === 0 ? (
              <div className="py-12 text-center text-zinc-500 text-sm">
                暂无更多推荐，可返回修改偏好后重新推荐
              </div>
            ) : (
              <div className="space-y-4">
                {visibleDirections.map((d, i) => (
                  <DirectionCard
                    key={d.directionName}
                    direction={d}
                    rank={i + 1}
                    onSelect={handleSelectDirection}
                    onDismiss={handleDismissDirection}
                    onDemoJd={handleDemoJd}
                    demoJdLoadingFor={demoJdLoadingFor}
                    demoJdDisabled={trialQuotaBlocksOneStep}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {subStep === 'plan_setup' && selectedDirection && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-8">
              <h2 className="text-xl font-semibold text-zinc-900 mb-2">你希望多长时间内完成求职？</h2>
              <p className="text-sm text-zinc-500">我们将根据你的选择生成按周拆解的计划</p>
            </div>

            {plan && !planModalOpen && (
              <div className="mb-6 p-4 rounded-xl border border-zinc-200 bg-zinc-50/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="text-sm text-zinc-700">
                  <span className="font-medium text-zinc-900">已生成一份求职计划</span>
                  <span className="text-zinc-500"> · {plan.totalWeeks} 周 · 可预览或调整参数后重新生成</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPlanModalOpen(true)}
                  className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium bg-white border border-zinc-300 text-zinc-800 hover:bg-zinc-50 transition-colors"
                >
                  打开计划卡片
                </button>
              </div>
            )}

            <div className="space-y-4 mb-6">
              <label className="flex items-start gap-3 p-4 border border-zinc-200 rounded-xl cursor-pointer hover:border-zinc-300 transition-colors">
                <input
                  type="radio"
                  name="planMode"
                  checked={planMode === 'ai_suggested'}
                  onChange={() => setPlanMode('ai_suggested')}
                  className="mt-1"
                />
                <div>
                  <span className="font-medium text-zinc-900">AI 帮我规划</span>
                  <p className="text-xs text-zinc-500 mt-0.5">根据你的差距分析自动估算周期（建议 8–14 周，含 6-8 周投递期）</p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-4 border border-zinc-200 rounded-xl cursor-pointer hover:border-zinc-300 transition-colors">
                <input
                  type="radio"
                  name="planMode"
                  checked={planMode === 'user_deadline'}
                  onChange={() => setPlanMode('user_deadline')}
                  className="mt-1"
                />
                <div className="flex-1">
                  <span className="font-medium text-zinc-900">我有明确期限</span>
                  <p className="text-xs text-zinc-500 mt-0.5">我希望在以下日期前拿到 offer</p>
                  {planMode === 'user_deadline' && (
                    <div className="mt-3 flex items-center gap-2">
                      <Calendar size={14} className="text-zinc-400" />
                      <input
                        type="date"
                        value={targetDate}
                        onChange={e => setTargetDate(e.target.value)}
                        className="px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                      />
                    </div>
                  )}
                </div>
              </label>
            </div>

            <button
              onClick={handleGeneratePlan}
              disabled={loading || trialQuotaBlocksOneStep}
              className="w-full py-3 rounded-xl text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  正在生成计划...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  生成求职计划
                </>
              )}
            </button>
            {trialQuotaBlocksOneStep && (
              <p className="mt-2 text-center text-xs text-zinc-500">
                免费体验计费额度已用尽（四步共用 3 次），无法生成新计划。可返回查看已生成的画像与方向。
              </p>
            )}

            <button
              onClick={handleBackToDirections}
              className="w-full mt-3 py-2.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
            >
              返回选择其他方向
            </button>
          </div>
        )}

      </main>

      {plan && planModalOpen && selectedDirection && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-label="关闭"
            onClick={closePlanModal}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[88vh] flex flex-col z-[61] border border-zinc-200">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100 shrink-0">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-zinc-500">求职计划预览</p>
                <h3 className="font-semibold text-[15px] text-zinc-900 mt-0.5 pr-2 leading-snug" title={selectedDirection.directionName}>
                  {selectedDirection.directionName}
                </h3>
                <p className="text-[11px] text-zinc-400 mt-1 truncate" title={plan.title}>
                  {plan.title.replace(/(.*)(求职计划)$/, '$1 求职计划')} · 共 {plan.totalWeeks} 周
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                {saveStatus !== 'saved' && (
                  <button
                    type="button"
                    onClick={() => void handleSavePlan()}
                    disabled={planSaveLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 transition-colors shrink-0 disabled:opacity-50"
                  >
                    {planSaveLoading ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                    保存到计划库
                  </button>
                )}
                <button
                  type="button"
                  onClick={closePlanModal}
                  className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                  aria-label="关闭"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            {planSaveError && (
              <div className="px-5 py-2 text-[12px] text-red-700 bg-red-50 border-b border-red-100 shrink-0">{planSaveError}</div>
            )}
            {saveStatus === 'saved' && (
              <div className="px-5 py-2.5 text-[12px] text-emerald-700 bg-emerald-50/80 border-b border-emerald-100 shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1">
                  <CheckCircle2 size={14} />
                  已保存到计划库
                </span>
                {onOpenPlanLibrary && (
                  <button
                    type="button"
                    onClick={onOpenPlanLibrary}
                    className="text-emerald-800 underline font-medium hover:text-emerald-900"
                  >
                    打开计划库
                  </button>
                )}
              </div>
            )}
            <div className="overflow-y-auto flex-1 px-5 py-4 min-h-0">
              <CareerPlanView
                plan={plan}
                onTaskToggle={handleTaskToggle}
                onBack={closePlanModal}
                backLabel="返回继续调整"
                embedInModal
              />
            </div>
            <div className="px-5 py-3 border-t border-zinc-100 shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                关闭后仍可在本页修改期限并重新生成；已保存的计划可在计划库中查看与打卡。
              </p>
              <button
                type="button"
                onClick={() => {
                  closePlanModal();
                  handleBackToDirections();
                }}
                className="text-[12px] text-zinc-500 hover:text-zinc-800 underline shrink-0"
              >
                返回方向列表
              </button>
            </div>
          </div>
        </div>
      )}

      {jdDemo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            aria-label="关闭"
            onClick={() => setJdDemo(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[88vh] flex flex-col z-[61] border border-zinc-200">
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-zinc-100 shrink-0">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-zinc-500">生成参考JD（demo）</p>
                <h3 className="font-semibold text-[15px] text-zinc-900 mt-0.5 pr-2 truncate" title={jdDemo.direction.directionName}>
                  {jdDemo.direction.directionName}
                </h3>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(jdDemo.text);
                    } catch {
                      setError('复制失败，请手动全选复制');
                    }
                  }}
                  className="p-2 rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 transition-colors"
                  title="复制全文"
                >
                  <Copy size={18} />
                </button>
                <button
                  type="button"
                  onClick={openJdSaveModal}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 text-white hover:bg-zinc-800 transition-colors shrink-0"
                  title="保存到 JD 库"
                >
                  <Save size={14} />
                  保存到 JD 库
                </button>
                <button
                  type="button"
                  onClick={() => setJdDemo(null)}
                  className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                  aria-label="关闭"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            {jdSaveOkHint && (
              <p className="px-5 py-2 text-[12px] text-emerald-700 bg-emerald-50/80 border-b border-emerald-100 shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{jdSaveOkHint}</span>
                {onOpenJdLibrary && (
                  <button
                    type="button"
                    onClick={onOpenJdLibrary}
                    className="text-emerald-800 underline font-medium hover:text-emerald-900"
                  >
                    打开 JD 库
                  </button>
                )}
              </p>
            )}
            <div className="overflow-y-auto flex-1 px-5 py-4 min-h-0">
              <div className="prose prose-sm prose-zinc max-w-none">
                <MarkdownRenderer content={stripLeadingMarkdownH1(jdDemo.text)} mode="diagnosis" />
              </div>
            </div>
            <p className="px-5 py-3 text-[11px] text-zinc-400 border-t border-zinc-100 shrink-0 leading-relaxed">
              内容为 AI 生成的虚构 JD，仅供对标与优化简历参考，非真实在招岗位。
            </p>
          </div>
        </div>
      )}

      {jdSaveModalOpen && jdDemo && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="关闭"
            onClick={() => setJdSaveModalOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-xl border border-zinc-200 w-full max-w-md flex flex-col z-[66]">
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
              <h3 className="text-sm font-semibold text-zinc-900">保存到 JD 库</h3>
              <button
                type="button"
                onClick={() => setJdSaveModalOpen(false)}
                className="p-1 rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-[11px] text-zinc-500 leading-relaxed">
                将保存为独立条目，无需关联某份简历。可选填标签，便于你在简历、计划笔记等处用<strong>相同标签</strong>自行对应。
              </p>
              <div>
                <label className="block text-[12px] font-medium text-zinc-700 mb-1">标题</label>
                <input
                  type="text"
                  value={jdSaveTitle}
                  onChange={e => setJdSaveTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                  placeholder="如：方向名称或岗位简称"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-zinc-700 mb-1">标签（选填）</label>
                <p className="text-[10px] text-zinc-400 mb-1 leading-relaxed">
                  保存时将自动附带「<strong className="text-zinc-600">{JD_LIBRARY_TAG_GENERATED_DEMO}</strong>」便于与上传的 JD 区分；下方可再加自定义标签。
                </p>
                <input
                  type="text"
                  value={jdSaveTagsInput}
                  onChange={e => setJdSaveTagsInput(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
                  placeholder="逗号、空格或分号分隔，如：大模型, 暑期投递"
                />
              </div>
              <button
                type="button"
                disabled={jdSaveSubmitting}
                onClick={() => void handleConfirmSaveJd()}
                className="w-full py-2.5 rounded-xl text-sm font-medium bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {jdSaveSubmitting ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    保存中…
                  </>
                ) : (
                  '保存'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ExplorePage;
