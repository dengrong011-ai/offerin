import React from 'react';
import {
  FileText,
  Target,
  ArrowRight,
  PenTool,
  Globe,
  FolderOpen,
  Mic,
  Play,
  Users,
  Briefcase,
  CheckCircle2,
  Crown,
  Sparkles,
  BookOpen,
  ClipboardList,
  MessageSquare,
  LayoutGrid,
  Compass,
  FileStack,
  StickyNote,
  Zap,
  TrendingUp,
  Award,
  Rocket,
  UserCircle,
  Map,
  CalendarCheck,
} from 'lucide-react';

export interface HomeMarketingProps {
  requireLogin: (cb: () => void) => void;
  openCareerExplore: () => void;
  onShowLogin: () => void;
  /** 开通付费档：简历畅改 / 全局畅享 */
  onOpenMembership: (product: 'resume_pass_10d' | 'full_monthly') => void;
  user: { id: string } | null;
  onGoUpload: () => void;
  onGoInterview: () => void;
  onGoJdLibrary: () => void;
  onGoPlanLibrary: () => void;
  onGoResumeLibrary: () => void;
  onGoInterviewLibrary: () => void;
}

/* ─── 小动画组件 ─── */
const FloatingEmoji: React.FC<{ emoji: string; delay: number; left: string }> = ({ emoji, delay, left }) => (
  <span
    className="absolute text-lg opacity-0 pointer-events-none select-none"
    style={{
      left,
      top: '-8px',
      animation: `floatUp 3s ease-in-out ${delay}s infinite`,
    }}
  >
    {emoji}
  </span>
);

const PulseRing: React.FC<{ color?: string }> = ({ color = 'rgba(0,0,0,0.06)' }) => (
  <span
    className="absolute inset-0 rounded-2xl pointer-events-none"
    style={{
      animation: 'pulseRing 2.5s ease-out infinite',
      boxShadow: `0 0 0 0 ${color}`,
    }}
  />
);

/**
 * 首页：四大板块总览 → 各模块详解 → 会员计划 → 预告
 */
const HomeMarketing: React.FC<HomeMarketingProps> = ({
  requireLogin,
  openCareerExplore,
  onShowLogin,
  onOpenMembership,
  user,
  onGoUpload,
  onGoInterview,
  onGoJdLibrary,
  onGoPlanLibrary,
  onGoResumeLibrary,
  onGoInterviewLibrary,
}) => {
  const scrollToContentMgmt = () => {
    document.getElementById('home-detail-content-mgmt')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      {/* ─── 注入关键帧 ─── */}
      <style>{`
        @keyframes floatUp {
          0%, 100% { opacity: 0; transform: translateY(0) scale(0.8); }
          20% { opacity: 0.8; transform: translateY(-12px) scale(1); }
          80% { opacity: 0.6; transform: translateY(-28px) scale(0.95); }
        }
        @keyframes pulseRing {
          0% { box-shadow: 0 0 0 0 rgba(0,0,0,0.08); }
          70% { box-shadow: 0 0 0 10px rgba(0,0,0,0); }
          100% { box-shadow: 0 0 0 0 rgba(0,0,0,0); }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        @keyframes gentleBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        @keyframes gradientShift {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        .shimmer-btn {
          background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%);
          background-size: 200% 100%;
          animation: shimmer 2.5s ease-in-out infinite;
        }
        .gradient-text {
          background: linear-gradient(135deg, #18181b 0%, #52525b 50%, #18181b 100%);
          background-size: 200% auto;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          animation: gradientShift 4s ease infinite;
        }
        .card-hover-glow:hover {
          box-shadow: 0 8px 30px -8px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04);
        }
      `}</style>

      {/* ─── 四大板块 — 总览卡片 ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 text-left mb-4">
        {/* 职业探索 */}
        <button
          type="button"
          onClick={() => openCareerExplore()}
          className="relative rounded-2xl border border-zinc-200/80 bg-white overflow-hidden text-left hover:border-zinc-300 transition-all duration-300 group flex flex-col h-full hover:-translate-y-1.5 card-hover-glow"
        >
          <div className="px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-200 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
              <Compass size={20} className="text-zinc-600" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-[15px] text-zinc-800 block">职业探索</span>
              <span className="text-[11px] text-zinc-400">找准方向，少走弯路</span>
            </div>
            <ArrowRight size={14} className="text-zinc-300 group-hover:translate-x-1 group-hover:text-zinc-600 transition-all shrink-0" />
          </div>
          <p className="px-5 pb-4 text-[12px] text-zinc-500 leading-relaxed flex-1">
            生成职业画像与方向建议，支持参考 JD、按周求职计划与笔记本。
          </p>
          <div className="mx-5 mb-4 h-1 rounded-full bg-zinc-100 overflow-hidden">
            <div className="h-full w-0 group-hover:w-full bg-zinc-300 transition-all duration-700 rounded-full" />
          </div>
        </button>

        {/* 简历优化 */}
        <button
          type="button"
          onClick={() => requireLogin(onGoUpload)}
          className="relative rounded-2xl border border-zinc-200/80 bg-white overflow-hidden text-left hover:border-zinc-300 transition-all duration-300 group flex flex-col h-full hover:-translate-y-1.5 card-hover-glow"
        >
          <div className="px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-200 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
              <FileText size={20} className="text-zinc-600" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-[15px] text-zinc-800 block">简历优化</span>
              <span className="text-[11px] text-zinc-400">AI 诊断 + 精调</span>
            </div>
            <ArrowRight size={14} className="text-zinc-300 group-hover:translate-x-1 group-hover:text-zinc-600 transition-all shrink-0" />
          </div>
          <p className="px-5 pb-4 text-[12px] text-zinc-500 leading-relaxed flex-1">
            上传 JD 与简历，完成智能诊断、AI 优化与逐句精调。
          </p>
          <div className="mx-5 mb-4 h-1 rounded-full bg-zinc-100 overflow-hidden">
            <div className="h-full w-0 group-hover:w-full bg-zinc-300 transition-all duration-700 rounded-full" />
          </div>
        </button>

        {/* 模拟面试 */}
        <button
          type="button"
          onClick={() => requireLogin(onGoInterview)}
          className="relative rounded-2xl border border-zinc-200/80 bg-white overflow-hidden text-left hover:border-zinc-300 transition-all duration-300 group flex flex-col h-full hover:-translate-y-1.5 card-hover-glow"
        >
          <div className="px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-200 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
              <Mic size={20} className="text-zinc-600" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-[15px] text-zinc-800 block">模拟面试</span>
              <span className="text-[11px] text-zinc-400">真实节奏练习</span>
            </div>
            <ArrowRight size={14} className="text-zinc-300 group-hover:translate-x-1 group-hover:text-zinc-600 transition-all shrink-0" />
          </div>
          <p className="px-5 pb-4 text-[12px] text-zinc-500 leading-relaxed flex-1">
            观摩与交互练习，覆盖多轮流程与谈薪场景。
          </p>
          <div className="mx-5 mb-4 h-1 rounded-full bg-zinc-100 overflow-hidden">
            <div className="h-full w-0 group-hover:w-full bg-zinc-300 transition-all duration-700 rounded-full" />
          </div>
        </button>

        {/* 内容管理 */}
        <button
          type="button"
          onClick={scrollToContentMgmt}
          className="relative rounded-2xl border border-zinc-200/80 bg-white overflow-hidden text-left hover:border-zinc-300 transition-all duration-300 group flex flex-col h-full hover:-translate-y-1.5 card-hover-glow"
        >
          <div className="px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-zinc-100 to-zinc-200 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
              <LayoutGrid size={20} className="text-zinc-600" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="font-semibold text-[15px] text-zinc-800 block">内容管理</span>
              <span className="text-[11px] text-zinc-400">一站式素材库</span>
            </div>
            <ArrowRight size={14} className="text-zinc-300 group-hover:translate-x-1 group-hover:text-zinc-600 transition-all shrink-0" />
          </div>
          <p className="px-5 pb-4 text-[12px] text-zinc-500 leading-relaxed flex-1">
            集中管理 JD、求职计划、简历版本与面试记录。
          </p>
          <div className="mx-5 mb-4 h-1 rounded-full bg-zinc-100 overflow-hidden">
            <div className="h-full w-0 group-hover:w-full bg-zinc-300 transition-all duration-700 rounded-full" />
          </div>
        </button>
      </div>

      {/* ─── 趣味引导语 ─── */}
      <p className="text-center text-zinc-400 text-[12px] mt-2 mb-0">
        👆 可以按顺序来，也可以跳着玩 — 你的求职旅程，你说了算 ✨
      </p>

      {/* ─── 各模块 — 详解 ─── */}
      <div className="mt-20 pt-16 border-t border-zinc-100">
        <div className="flex items-center justify-center gap-2.5 mb-2">
          <span className="text-[18px]">🧩</span>
          <h2 className="font-display text-[22px] md:text-[24px] font-semibold gradient-text">
            功能详解
          </h2>
        </div>
        <p className="text-zinc-400 text-[13px] text-center mb-12 max-w-lg mx-auto leading-relaxed">
          每个模块都为求职关键环节而生，点击即可开始
        </p>

        <div className="space-y-8">
          {/* 职业探索 */}
          <div className="rounded-2xl border border-zinc-100 bg-white overflow-hidden text-left hover:shadow-lg transition-all duration-400 group">
            <div className="px-6 py-5 bg-gradient-to-r from-zinc-50 to-white border-b border-zinc-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center shadow-sm">
                <Compass size={18} className="text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-[16px] text-zinc-800">职业探索</h3>
                <span className="text-[11px] text-zinc-400">偏好 · 画像 · 方向 · JD · 计划 · 复盘</span>
              </div>
              <span className="text-lg">🧭</span>
            </div>

            {/* 流程引导条 */}
            <div className="px-6 pt-5 pb-2">
              <div className="flex items-center justify-between text-[10px] text-zinc-400 max-w-xl mx-auto">
                {[
                  { emoji: '🎯', label: '选择偏好' },
                  { emoji: '👤', label: '生成画像' },
                  { emoji: '🧭', label: '推荐方向' },
                  { emoji: '📄', label: '生成 JD' },
                  { emoji: '📋', label: '输出计划' },
                  { emoji: '📝', label: '笔记复盘' },
                ].map((s, i, arr) => (
                  <React.Fragment key={i}>
                    <div className="flex flex-col items-center gap-1">
                      <span className="text-[14px]">{s.emoji}</span>
                      <span className="whitespace-nowrap">{s.label}</span>
                    </div>
                    {i < arr.length - 1 && (
                      <ArrowRight size={10} className="text-zinc-300 shrink-0 -mt-2" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  icon: <Target size={16} className="text-zinc-600" />,
                  title: '选择偏好',
                  desc: '根据背景、兴趣与发展倾向选择求职偏好，为 AI 提供精准的个性化画像基础',
                  tag: '🎯',
                },
                {
                  icon: <UserCircle size={16} className="text-zinc-600" />,
                  title: '生成画像',
                  desc: 'AI 综合简历与偏好，生成专属职业画像，覆盖能力标签、优势雷达与成长建议',
                  tag: '👤',
                },
                {
                  icon: <Map size={16} className="text-zinc-600" />,
                  title: '推荐方向',
                  desc: '基于画像智能匹配高契合度方向，给出行业 + 岗位推荐及匹配度理由',
                  tag: '🧭',
                },
                {
                  icon: <Briefcase size={16} className="text-zinc-600" />,
                  title: '生成参考 JD',
                  desc: '为每个推荐方向自动生成参考 JD，一键保存至 JD 库，可直接用于简历诊断与面试',
                  tag: '📄',
                },
                {
                  icon: <CalendarCheck size={16} className="text-zinc-600" />,
                  title: '输出求职计划',
                  desc: 'AI 按周拆解求职行动计划，支持打卡追踪进度并关联笔记本形成闭环',
                  tag: '📋',
                },
                {
                  icon: <StickyNote size={16} className="text-zinc-600" />,
                  title: '笔记复盘',
                  desc: '搭配笔记本记录探索心得与面试反思，与计划库双向关联，沉淀求职经验',
                  tag: '📝',
                },
              ].map(row => (
                <div
                  key={row.title}
                  className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50/60 hover:bg-zinc-100/60 transition-all duration-200 hover:scale-[1.01] cursor-default group/item"
                >
                  <div className="w-9 h-9 rounded-lg bg-white border border-zinc-200/80 flex items-center justify-center shrink-0 shadow-sm group-hover/item:shadow-md transition-shadow">
                    {row.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-[13px] text-zinc-800 mb-0.5 flex items-center gap-1.5">
                      {row.title}
                      <span className="text-[12px]">{row.tag}</span>
                    </h4>
                    <p className="text-[12px] text-zinc-500 leading-relaxed">{row.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 pb-6">
              <button
                type="button"
                onClick={() => openCareerExplore()}
                className="relative w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-[13px] font-medium transition-all duration-200 flex items-center justify-center gap-2 overflow-hidden active:scale-[0.98]"
              >
                <span className="shimmer-btn absolute inset-0" />
                <Compass size={14} />
                开始职业探索
              </button>
            </div>
          </div>

          {/* 简历优化 */}
          <div className="rounded-2xl border border-zinc-100 bg-white overflow-hidden text-left hover:shadow-lg transition-all duration-400 group">
            <div className="px-6 py-5 bg-gradient-to-r from-zinc-50 to-white border-b border-zinc-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center shadow-sm">
                <FileText size={18} className="text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-[16px] text-zinc-800">简历优化</h3>
                <span className="text-[11px] text-zinc-400">诊断 · 编辑 · 英文版 · 简历库</span>
              </div>
              <span className="text-lg">📝</span>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                {
                  icon: <Target size={16} className="text-zinc-600" />,
                  title: '智能诊断',
                  desc: '基于目标 JD 进行匹配度分析，评分 + 能力差距 + ATS 关键词',
                  tag: '🎯',
                },
                {
                  icon: <PenTool size={16} className="text-zinc-600" />,
                  title: 'AI 优化 & 精调',
                  desc: '一键优化 + 选中文本逐句精调，实时预览与 PDF 导出',
                  tag: '✨',
                },
                {
                  icon: <Globe size={16} className="text-zinc-600" />,
                  title: '英文版本',
                  desc: '一键生成专业英文简历，遵循硅谷履历结构',
                  tag: '🌍',
                },
                {
                  icon: <FolderOpen size={16} className="text-zinc-600" />,
                  title: '与简历库联动',
                  desc: '云端多版本保存，一键载入历史版本与对应 JD',
                  tag: '📂',
                },
              ].map(row => (
                <div
                  key={row.title}
                  className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50/60 hover:bg-zinc-100/60 transition-all duration-200 hover:scale-[1.01] cursor-default group/item"
                >
                  <div className="w-9 h-9 rounded-lg bg-white border border-zinc-200/80 flex items-center justify-center shrink-0 shadow-sm group-hover/item:shadow-md transition-shadow">
                    {row.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-[13px] text-zinc-800 mb-0.5 flex items-center gap-1.5">
                      {row.title}
                      <span className="text-[12px]">{row.tag}</span>
                    </h4>
                    <p className="text-[12px] text-zinc-500 leading-relaxed">{row.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 pb-6">
              <button
                type="button"
                onClick={() => requireLogin(onGoUpload)}
                className="relative w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-[13px] font-medium transition-all duration-200 flex items-center justify-center gap-2 overflow-hidden active:scale-[0.98]"
              >
                <span className="shimmer-btn absolute inset-0" />
                <FileText size={14} />
                开始简历输入
              </button>
            </div>
          </div>

          {/* 模拟面试 */}
          <div className="rounded-2xl border border-zinc-100 bg-white overflow-hidden text-left hover:shadow-lg transition-all duration-400 group">
            <div className="px-6 py-5 bg-gradient-to-r from-zinc-50 to-white border-b border-zinc-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center shadow-sm">
                <Mic size={18} className="text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-[16px] text-zinc-800">模拟面试</h3>
                <span className="text-[11px] text-zinc-400">观摩 · 交互 · 多轮 · 谈薪</span>
              </div>
              <span className="text-lg">🎤</span>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                {
                  icon: <Play size={16} className="text-zinc-600" />,
                  title: '纯模拟模式',
                  desc: 'AI 双角色自动问答，适合观摩标准回答',
                  tag: '🎬',
                },
                {
                  icon: <Users size={16} className="text-zinc-600" />,
                  title: '人机交互模式',
                  desc: 'AI 提问你来答，每轮即时点评反馈',
                  tag: '🤝',
                },
                {
                  icon: <Briefcase size={16} className="text-zinc-600" />,
                  title: '多轮全流程',
                  desc: 'TA → Peers → 负责人 → HR，贴近真实节奏',
                  tag: '🔄',
                },
                {
                  icon: <Target size={16} className="text-zinc-600" />,
                  title: '谈薪博弈指导',
                  desc: 'HR 轮加入薪资沟通模拟，策略与话术参考',
                  tag: '💰',
                },
              ].map(row => (
                <div
                  key={row.title}
                  className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50/60 hover:bg-zinc-100/60 transition-all duration-200 hover:scale-[1.01] cursor-default group/item"
                >
                  <div className="w-9 h-9 rounded-lg bg-white border border-zinc-200/80 flex items-center justify-center shrink-0 shadow-sm group-hover/item:shadow-md transition-shadow">
                    {row.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-[13px] text-zinc-800 mb-0.5 flex items-center gap-1.5">
                      {row.title}
                      <span className="text-[12px]">{row.tag}</span>
                    </h4>
                    <p className="text-[12px] text-zinc-500 leading-relaxed">{row.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 pb-6">
              <button
                type="button"
                onClick={() => requireLogin(onGoInterview)}
                className="relative w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-[13px] font-medium transition-all duration-200 flex items-center justify-center gap-2 overflow-hidden active:scale-[0.98]"
              >
                <span className="shimmer-btn absolute inset-0" />
                <Mic size={14} />
                进入模拟面试
              </button>
            </div>
          </div>

          {/* 内容管理 */}
          <div
            id="home-detail-content-mgmt"
            className="rounded-2xl border border-zinc-100 bg-white overflow-hidden text-left hover:shadow-lg transition-all duration-400 scroll-mt-28 group"
          >
            <div className="px-6 py-5 bg-gradient-to-r from-zinc-50 to-white border-b border-zinc-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-900 flex items-center justify-center shadow-sm">
                <FileStack size={18} className="text-white" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-[16px] text-zinc-800">内容管理</h3>
                <span className="text-[11px] text-zinc-400">JD · 计划 · 简历 · 面试记录</span>
              </div>
              <span className="text-lg">🗂️</span>
            </div>
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                {
                  icon: <Briefcase size={16} className="text-zinc-600" />,
                  title: 'JD 库',
                  desc: '上传、粘贴或保存参考 JD，简历输入与面试可一键载入',
                  tag: '💼',
                },
                {
                  icon: <ClipboardList size={16} className="text-zinc-600" />,
                  title: '计划库',
                  desc: '管理 AI 生成的求职计划，跳转关联笔记本形成闭环',
                  tag: '📋',
                },
                {
                  icon: <FolderOpen size={16} className="text-zinc-600" />,
                  title: '简历库',
                  desc: '多版本云端保存，与编辑器互通避免反复粘贴',
                  tag: '📁',
                },
                {
                  icon: <MessageSquare size={16} className="text-zinc-600" />,
                  title: '面试记录',
                  desc: '保存模拟面试对话与导出，复盘高频问题调整表述',
                  tag: '💬',
                },
              ].map(row => (
                <div
                  key={row.title}
                  className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50/60 hover:bg-zinc-100/60 transition-all duration-200 hover:scale-[1.01] cursor-default group/item"
                >
                  <div className="w-9 h-9 rounded-lg bg-white border border-zinc-200/80 flex items-center justify-center shrink-0 shadow-sm group-hover/item:shadow-md transition-shadow">
                    {row.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-[13px] text-zinc-800 mb-0.5 flex items-center gap-1.5">
                      {row.title}
                      <span className="text-[12px]">{row.tag}</span>
                    </h4>
                    <p className="text-[12px] text-zinc-500 leading-relaxed">{row.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="px-6 pb-6 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {[
                { label: 'JD 库', action: () => requireLogin(onGoJdLibrary), emoji: '💼' },
                { label: '计划库', action: () => requireLogin(onGoPlanLibrary), emoji: '📋' },
                { label: '简历库', action: () => requireLogin(onGoResumeLibrary), emoji: '📁' },
                { label: '面试记录', action: () => requireLogin(onGoInterviewLibrary), emoji: '💬' },
              ].map(btn => (
                <button
                  key={btn.label}
                  type="button"
                  onClick={btn.action}
                  className="py-2.5 border border-zinc-200 text-zinc-700 rounded-xl text-[12px] font-medium hover:bg-zinc-50 hover:border-zinc-300 transition-all duration-200 flex items-center justify-center gap-1.5 active:scale-[0.97]"
                >
                  <span>{btn.emoji}</span>
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ─── 会员计划 ─── */}
      <div className="mt-24 pt-16 border-t border-zinc-100">
        <div className="flex items-center justify-center gap-2.5 mb-2">
          <span className="text-[20px]" style={{ animation: 'gentleBounce 2s ease-in-out infinite' }}>👑</span>
          <h2 className="font-display text-[22px] font-semibold gradient-text">会员计划</h2>
        </div>
        <p className="text-zinc-400 text-[13px] mb-10 text-center">选择适合你的方案，开启高效求职之旅</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 max-w-5xl mx-auto">
          {/* 免费 */}
          <div className="bg-white border border-zinc-200/80 rounded-2xl p-6 text-left flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 bg-zinc-100 rounded-xl flex items-center justify-center">
                <Users size={20} className="text-zinc-500" />
              </div>
              <div>
                <h3 className="font-semibold text-[16px] text-zinc-800">免费用户</h3>
                <p className="text-[11px] text-zinc-400">体验核心功能</p>
              </div>
            </div>

            <div className="space-y-3 mb-6 flex-grow">
              {[
                { count: '3', text: '简历诊断 + 全局重构 共3次体验' },
                { count: '1', text: '模拟面试 独立1场体验' },
                { count: '3', text: '英文简历翻译 共3次体验' },
                { count: '3', text: '职业探索 共3次成功（无日上限）' },
                { check: true, text: 'PDF 导出', bold: '免费' },
                { check: true, text: '面试记录保存', bold: '免费' },
                { check: true, text: '简历库 云端保存与管理' },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-[13px] text-zinc-600">
                  {'count' in item && item.count ? (
                    <span className="w-6 h-6 rounded-lg bg-zinc-100 flex items-center justify-center text-[10px] font-bold text-zinc-500 shrink-0">
                      {item.count}
                    </span>
                  ) : (
                    <span className="w-6 h-6 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
                      <CheckCircle2 size={12} className="text-zinc-400" />
                    </span>
                  )}
                  <span>
                    {item.text}
                    {'bold' in item && item.bold && (
                      <span className="font-semibold text-zinc-800 ml-1">{item.bold}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>

            <div className="pt-5 border-t border-zinc-100">
              <div className="text-[24px] font-bold text-zinc-800">免费</div>
              <p className="text-[11px] text-zinc-400 mt-0.5">适合初次体验 🌱</p>
            </div>
          </div>

          {/* 简历畅改 */}
          <div className="bg-white border border-zinc-200/80 rounded-2xl p-6 text-left flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 bg-zinc-800 rounded-xl flex items-center justify-center shadow-md">
                <PenTool size={20} className="text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-[16px] text-zinc-800">简历畅改</h3>
                <p className="text-[11px] text-zinc-500">专注简历诊断与迭代</p>
              </div>
            </div>

            <div className="space-y-3 mb-6 flex-grow text-[13px] text-zinc-600">
              {[
                '开通起 10 天内 · 最多 50 次简历诊断',
                '划选局部编辑不计入（不限次）',
                '全局重构随诊断链路，不单独扣次',
                '职业探索权益与免费档相同（共 3 次成功）',
                '模拟面试 / 翻译 与免费体验一致',
                '面试、职业探索、翻译与免费档共用已消耗额度，用尽后开通本档不会额外增加次数',
                'PDF 导出',
              ].map((text) => (
                <div key={text} className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle2 size={12} className="text-zinc-500" />
                  </span>
                  <span>{text}</span>
                </div>
              ))}
            </div>

            <div className="pt-5 border-t border-zinc-100">
              <div className="text-[24px] font-bold text-zinc-800">¥9.9</div>
              <p className="text-[11px] text-zinc-500 mt-0.5">10 天有效 · 单次付费</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">不设自动续费，到期恢复免费用户</p>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!user) onShowLogin();
                else onOpenMembership('resume_pass_10d');
              }}
              className="w-full mt-5 py-3 border border-zinc-900 text-zinc-900 hover:bg-zinc-50 rounded-xl text-[13px] font-medium transition-all active:scale-[0.98]"
            >
              开通简历畅改
            </button>
          </div>

          {/* 全局畅享 */}
          <div className="relative bg-gradient-to-br from-zinc-50 to-zinc-100/50 border border-zinc-200/80 rounded-2xl p-6 text-left flex flex-col hover:shadow-lg hover:-translate-y-1 transition-all duration-300 overflow-hidden">
            <PulseRing />
            <div className="absolute top-4 right-4 px-3 py-1 bg-zinc-900 text-white text-[10px] font-semibold rounded-full flex items-center gap-1">
              <Sparkles size={10} />
              推荐
            </div>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 bg-zinc-900 rounded-xl flex items-center justify-center shadow-md">
                <Crown size={20} className="text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-[16px] text-zinc-800">全局畅享</h3>
                <p className="text-[11px] text-zinc-500">面试 + 职业探索 + 简历全链路</p>
              </div>
            </div>

            <div className="space-y-3 mb-6 flex-grow text-[13px] text-zinc-700">
              {[
                '每月最多开启 30 场模拟面试（按场次计）',
                '职业探索 50 次成功 / 月（分步计）',
                '简历侧 50 次 / 月（诊断 + 划选 + 全局重构）',
                '英文翻译不限',
                'PDF 导出 · 面试记录保存',
              ].map((text) => (
                <div key={text} className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-lg bg-zinc-200/80 flex items-center justify-center shrink-0 mt-0.5">
                    <CheckCircle2 size={12} className="text-zinc-600" />
                  </span>
                  <span>{text}</span>
                </div>
              ))}
            </div>

            <div className="pt-5 border-t border-zinc-200/80">
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="text-[24px] font-bold text-zinc-800">¥39.9</span>
                <span className="text-zinc-500 text-[13px]">· 单次购买 30 天有效</span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-0.5">不设自动续费，到期恢复免费用户</p>
              <p className="text-[11px] text-zinc-400 mt-0.5">若再次购买同一档，权益可从当前到期日顺延（非代扣）</p>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!user) onShowLogin();
                else onOpenMembership('full_monthly');
              }}
              className="relative w-full mt-5 py-3 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-[13px] font-medium transition-all duration-200 flex items-center justify-center gap-2 overflow-hidden active:scale-[0.98]"
            >
              <span className="shimmer-btn absolute inset-0" />
              <Crown size={14} />
              开通全局畅享
            </button>
          </div>
        </div>
      </div>

      {/* ─── 会员专属 · 敬请期待 ─── */}
      <div className="mt-24 pt-16 border-t border-zinc-100">
        <div className="flex items-center justify-center gap-3 mb-3">
          <Sparkles size={20} className="text-amber-400" style={{ animation: 'gentleBounce 2.5s ease-in-out infinite' }} />
          <h2 className="font-display text-[24px] font-semibold gradient-text">会员专属 · 敬请期待</h2>
          <Sparkles size={20} className="text-amber-400" style={{ animation: 'gentleBounce 2.5s ease-in-out 0.3s infinite' }} />
        </div>
        <p className="text-zinc-400 text-[14px] mb-12 max-w-2xl mx-auto text-center">更多智能功能正在紧锣密鼓开发中，VIP 会员将优先体验 🎉</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {/* 简历补料教练 */}
          <div className="relative bg-white border border-zinc-100 rounded-2xl p-6 text-left overflow-hidden group hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
            <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-amber-50 to-transparent rounded-full -mr-20 -mt-20 opacity-60" />

            <div className="absolute top-4 right-4 px-3 py-1 bg-zinc-800 text-white text-[10px] font-semibold rounded-full flex items-center gap-1.5 z-10">
              <Sparkles size={10} />
              即将上线
            </div>

            <div className="relative flex flex-col flex-1">
              <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center mb-5 shadow-md group-hover:scale-105 transition-transform">
                <MessageSquare size={22} className="text-white" />
              </div>

              <h3 className="font-semibold text-[16px] text-zinc-800 mb-2 flex items-center gap-2">
                简历补料教练
                <span className="text-[14px]">🎙️</span>
              </h3>
              <p className="text-zinc-500 text-[12px] leading-relaxed mb-5">
                上传简历后，AI 围绕经历与目标岗位做结构化追问，帮你把口述中的成果、数据与故事线挖出来。
              </p>

              <div className="space-y-2 mb-5">
                {[
                  '先读简历与可选 JD，找出信息薄弱的段落',
                  '一次只深挖一两处，避免填表式疲劳',
                  '输出亮点清单与 bullet 草稿',
                  '可与优化、笔记本衔接',
                ].map((text, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-[11px] text-zinc-500">
                    <CheckCircle2 size={11} className="text-zinc-300 shrink-0" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-zinc-50 border border-zinc-100 rounded-xl mt-auto">
                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  {[
                    { icon: <FileText size={14} className="text-zinc-400" />, label: '上传简历' },
                    { icon: <MessageSquare size={14} className="text-zinc-400" />, label: '引导追问' },
                    { icon: <PenTool size={14} className="text-zinc-400" />, label: '亮点草稿' },
                    { icon: <Sparkles size={14} className="text-amber-400" />, label: '并入简历' },
                  ].map((s, i, arr) => (
                    <React.Fragment key={i}>
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="w-8 h-8 bg-white border border-zinc-200/80 rounded-lg flex items-center justify-center shadow-sm">
                          {s.icon}
                        </div>
                        <span>{s.label}</span>
                      </div>
                      {i < arr.length - 1 && <ArrowRight size={10} className="text-zinc-300 shrink-0" />}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* 工作复盘助手 */}
          <div className="relative bg-white border border-zinc-100 rounded-2xl p-6 text-left overflow-hidden group hover:shadow-lg hover:-translate-y-1 transition-all duration-300 flex flex-col">
            <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-bl from-blue-50 to-transparent rounded-full -mr-20 -mt-20 opacity-60" />

            <div className="absolute top-4 right-4 px-3 py-1 bg-zinc-800 text-white text-[10px] font-semibold rounded-full flex items-center gap-1.5 z-10">
              <Sparkles size={10} />
              即将上线
            </div>

            <div className="relative flex flex-col flex-1">
              <div className="w-12 h-12 bg-zinc-900 rounded-2xl flex items-center justify-center mb-5 shadow-md group-hover:scale-105 transition-transform">
                <BookOpen size={22} className="text-white" />
              </div>

              <h3 className="font-semibold text-[16px] text-zinc-800 mb-2 flex items-center gap-2">
                工作复盘助手
                <span className="text-[14px]">📊</span>
              </h3>
              <p className="text-zinc-500 text-[12px] leading-relaxed mb-5">
                用 GRAI/STAR 等框架做日报周报月报复盘，AI 一键提炼为简历素材
              </p>

              <div className="space-y-2 mb-5">
                {[
                  'GRAI / STAR / PDCA 多种复盘框架',
                  'AI 自动提取可量化成果亮点',
                  '选中复盘记录 → 一键生成简历条目',
                  '时间线视图 · 积累职业成就档案',
                ].map((text, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-[11px] text-zinc-500">
                    <CheckCircle2 size={11} className="text-zinc-300 shrink-0" />
                    <span>{text}</span>
                  </div>
                ))}
              </div>

              <div className="p-4 bg-zinc-50 border border-zinc-100 rounded-xl mt-auto">
                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  {[
                    { emoji: '📝', label: '日常复盘' },
                    { emoji: '🤖', label: 'AI 提炼' },
                    { emoji: '✨', label: '简历素材' },
                    { emoji: '📄', label: '一键填入' },
                  ].map((s, i, arr) => (
                    <React.Fragment key={i}>
                      <div className="flex flex-col items-center gap-1.5">
                        <div className="w-8 h-8 bg-white border border-zinc-200/80 rounded-lg flex items-center justify-center shadow-sm text-[14px]">
                          {s.emoji}
                        </div>
                        <span>{s.label}</span>
                      </div>
                      {i < arr.length - 1 && <ArrowRight size={10} className="text-zinc-300 shrink-0" />}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default HomeMarketing;
