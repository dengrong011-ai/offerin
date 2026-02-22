/**
 * 骨架屏组件
 * 用于在内容加载时显示占位动画
 */

import React from 'react';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: 'none' | 'sm' | 'md' | 'lg' | 'full';
  animate?: boolean;
}

// 基础骨架屏组件
export const Skeleton: React.FC<SkeletonProps> = ({
  className = '',
  width,
  height,
  rounded = 'md',
  animate = true,
}) => {
  const roundedClass = {
    none: '',
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  }[rounded];

  return (
    <div
      className={`bg-zinc-200 ${roundedClass} ${animate ? 'animate-pulse' : ''} ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    />
  );
};

// 文本行骨架屏
export const SkeletonLine: React.FC<{ width?: string; className?: string }> = ({
  width = '100%',
  className = '',
}) => (
  <Skeleton className={`h-4 ${className}`} width={width} />
);

// 段落骨架屏（多行）
export const SkeletonParagraph: React.FC<{
  lines?: number;
  className?: string;
}> = ({ lines = 3, className = '' }) => (
  <div className={`space-y-2 ${className}`}>
    {Array.from({ length: lines }).map((_, i) => (
      <SkeletonLine
        key={i}
        width={i === lines - 1 ? '60%' : '100%'}
      />
    ))}
  </div>
);

// 头像骨架屏
export const SkeletonAvatar: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}> = ({ size = 'md', className = '' }) => {
  const sizeClass = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  }[size];

  return <Skeleton className={`${sizeClass} ${className}`} rounded="full" />;
};

// 按钮骨架屏
export const SkeletonButton: React.FC<{
  width?: string;
  className?: string;
}> = ({ width = '80px', className = '' }) => (
  <Skeleton className={`h-9 ${className}`} width={width} rounded="md" />
);

// 卡片骨架屏
export const SkeletonCard: React.FC<{
  className?: string;
  showAvatar?: boolean;
  lines?: number;
}> = ({ className = '', showAvatar = true, lines = 3 }) => (
  <div className={`p-4 bg-white border border-zinc-200 rounded-lg ${className}`}>
    <div className="flex items-start gap-3">
      {showAvatar && <SkeletonAvatar />}
      <div className="flex-1 space-y-3">
        <Skeleton className="h-5 w-1/3" />
        <SkeletonParagraph lines={lines} />
      </div>
    </div>
  </div>
);

// 面试消息骨架屏
export const InterviewMessageSkeleton: React.FC<{
  type: 'interviewer' | 'interviewee';
}> = ({ type }) => {
  const isInterviewer = type === 'interviewer';
  
  return (
    <div className={`flex items-start gap-3 mb-4 ${!isInterviewer ? 'flex-row-reverse' : ''}`}>
      <Skeleton 
        className={`w-8 h-8 shrink-0 ${isInterviewer ? 'bg-zinc-300' : 'bg-zinc-200'}`} 
        rounded="full" 
      />
      <div className={`flex-1 max-w-[80%] ${!isInterviewer ? 'flex flex-col items-end' : ''}`}>
        <Skeleton className="h-4 w-16 mb-2" />
        <div className={`p-4 rounded-lg ${isInterviewer ? 'bg-white border border-zinc-200' : 'bg-zinc-50 border border-zinc-200'}`}>
          <SkeletonParagraph lines={3} />
        </div>
      </div>
    </div>
  );
};

// 面试聊天骨架屏（完整）
export const InterviewChatSkeleton: React.FC = () => (
  <div className="space-y-4 p-6">
    {/* 轮次标题 */}
    <div className="flex items-center justify-center gap-2 py-3">
      <Skeleton className="h-4 w-32" />
    </div>
    
    {/* 面试官消息 */}
    <InterviewMessageSkeleton type="interviewer" />
    
    {/* 面试者消息 */}
    <InterviewMessageSkeleton type="interviewee" />
    
    {/* 面试官消息 */}
    <InterviewMessageSkeleton type="interviewer" />
  </div>
);

// 简历编辑器骨架屏
export const ResumeEditorSkeleton: React.FC = () => (
  <div className="flex h-full">
    {/* 左侧编辑区 */}
    <div className="flex-1 p-6 space-y-4">
      <Skeleton className="h-6 w-1/4 mb-4" />
      <SkeletonParagraph lines={5} />
      <Skeleton className="h-5 w-1/3 mt-6" />
      <SkeletonParagraph lines={4} />
      <Skeleton className="h-5 w-1/4 mt-6" />
      <SkeletonParagraph lines={3} />
    </div>
    
    {/* 右侧预览区 */}
    <div className="w-1/2 p-6 bg-zinc-50 border-l border-zinc-200">
      <div className="bg-white p-8 rounded-lg shadow-sm">
        <Skeleton className="h-8 w-1/3 mb-4" />
        <Skeleton className="h-4 w-1/2 mb-6" />
        <SkeletonParagraph lines={4} />
        <Skeleton className="h-5 w-1/4 mt-6 mb-3" />
        <SkeletonParagraph lines={3} />
      </div>
    </div>
  </div>
);

// 诊断报告骨架屏
export const DiagnosisReportSkeleton: React.FC = () => (
  <div className="p-6 space-y-6">
    {/* 标题 */}
    <div className="flex items-center gap-3">
      <Skeleton className="w-6 h-6" rounded="sm" />
      <Skeleton className="h-6 w-40" />
    </div>
    
    {/* 评分卡片 */}
    <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-4">
      <div className="flex items-center gap-4 mb-4">
        <Skeleton className="w-16 h-16" rounded="full" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <SkeletonParagraph lines={2} />
    </div>
    
    {/* 详细分析 */}
    <div className="space-y-4">
      <Skeleton className="h-5 w-32" />
      <SkeletonParagraph lines={4} />
    </div>
    
    {/* Gap 分析 */}
    <div className="space-y-4">
      <Skeleton className="h-5 w-28" />
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-start gap-2">
            <Skeleton className="w-4 h-4 mt-0.5" rounded="sm" />
            <SkeletonParagraph lines={2} className="flex-1" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

// 面试评估报告骨架屏
export const InterviewSummarySkeleton: React.FC = () => (
  <div className="my-6 mx-auto max-w-2xl space-y-4">
    {/* 评估报告卡片 */}
    <div className="bg-zinc-50 border border-zinc-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-zinc-100 border-b border-zinc-200 flex items-center gap-2">
        <Skeleton className="w-4 h-4" rounded="sm" />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="p-5 space-y-4">
        {/* 评分概览 */}
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
        
        {/* 详细分析 */}
        <div className="pt-4 border-t border-zinc-200 space-y-3">
          <Skeleton className="h-5 w-28" />
          <SkeletonParagraph lines={4} />
        </div>
        
        {/* 建议 */}
        <div className="pt-4 border-t border-zinc-200 space-y-3">
          <Skeleton className="h-5 w-24" />
          <SkeletonParagraph lines={3} />
        </div>
      </div>
    </div>
    
    {/* 推荐反问卡片 */}
    <div className="bg-amber-50/50 border border-amber-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 bg-amber-100/60 border-b border-amber-200 flex items-center gap-2">
        <Skeleton className="w-4 h-4 bg-amber-200" rounded="sm" />
        <Skeleton className="h-5 w-28 bg-amber-200" />
      </div>
      <div className="p-5 space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-5 w-20 bg-amber-200/50" />
            <Skeleton className="h-4 w-full bg-amber-200/30" />
            <Skeleton className="h-3 w-3/4 bg-amber-200/20" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

// 加载状态包装器
export const LoadingWrapper: React.FC<{
  loading: boolean;
  skeleton: React.ReactNode;
  children: React.ReactNode;
}> = ({ loading, skeleton, children }) => {
  if (loading) {
    return <>{skeleton}</>;
  }
  return <>{children}</>;
};

export default Skeleton;
