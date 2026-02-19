
import React from 'react';

interface Props {
  content: string;
  isResumePreview?: boolean;
  densityMultiplier?: number;
  mode?: 'resume' | 'diagnosis'; 
}

const MarkdownRenderer: React.FC<Props> = ({ 
  content, 
  isResumePreview = false,
  densityMultiplier = 1.0,
  mode = 'resume'
}) => {
  
  // 使用固定的 px 值而不是 rem，确保 html2canvas 渲染一致性
  const lineHeightValue = 1.4 + (0.1 * densityMultiplier);
  
  const s = {
    fontFamily: mode === 'resume' 
      ? '"Times New Roman", Times, "SimSun", "宋体", serif' 
      : '"Inter", system-ui, sans-serif',
    
    baseTextSize: isResumePreview ? '10.5pt' : '15px',
    lineHeight: lineHeightValue,
    lineHeightPx: isResumePreview ? `${Math.round(10.5 * lineHeightValue * 1.333)}px` : `${Math.round(15 * lineHeightValue)}px`,
    
    h1Mb: `${Math.round(6 * densityMultiplier)}px`, 
    nameMb: `${Math.round(8 * densityMultiplier)}px`, 
    h2Top: `${Math.round(12 * densityMultiplier)}px`, 
    h2Bottom: `${Math.round(5 * densityMultiplier)}px`,
    h2PaddingBottom: `${Math.round(2 * densityMultiplier)}px`,
    h3Top: `${Math.round(10 * densityMultiplier)}px`,
    h3Bottom: `${Math.round(3 * densityMultiplier)}px`,
    listMb: `${Math.round(2 * densityMultiplier)}px`, 
    pSpacing: `${Math.round(8 * densityMultiplier)}px`,
    eduMargin: `${Math.round(2 * densityMultiplier)}px`,
    borderBottom: '1px solid #000', 
  };

  const processCommonMarkdown = (html: string) => {
    return html
      // 加粗：**text** 
      .replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight: 700; color: #18181b;">$1</strong>')
      // 行内代码：`code`
      .replace(/`([^`]+)`/g, '<code style="background: #f4f4f5; color: #18181b; padding: 1px 5px; border-radius: 3px; font-size: 0.9em; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">$1</code>')
      // 斜体：*text*（前面有空格或行首）
      .replace(/(^|\s)\*(?!\s)([^*]+)\*/g, '$1<em style="font-style: italic; color: #3f3f46;">$2</em>');
  };

  const formatResumeText = (text: string) => {
    let html = text.replace(/^\s+/, '');

    const headerRegex = /^# (.*?)\n+> (.*?)(?:\n!\[.*?\]\((.*?)\))?$/m;
    const match = headerRegex.exec(html);

    if (match) {
      const name = match[1];
      const contact = match[2];
      const imgUrl = match[3];

      const headerHtml = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-top: 0; margin-bottom: 12px; width: 100%; border-bottom: 2px solid #000; padding-bottom: 8px;">
          <div style="flex: 1;">
            <h1 class="font-bold text-slate-900 uppercase" style="font-size: 24pt; margin-top: 0; margin-bottom: 6px; font-family: ${s.fontFamily}; letter-spacing: 0.5px; line-height: 1.2;">${name}</h1>
            <div style="font-size: 10pt; line-height: 1.4;" class="text-slate-700 break-words font-serif italic">${contact}</div>
          </div>
          ${imgUrl ? `
            <div style="margin-left: 2rem; flex-shrink: 0;">
              <img src="${imgUrl}" style="width: 100px; height: 130px; object-fit: cover; border: 1px solid #ddd;" alt="Profile" />
            </div>
          ` : ''}
        </div>
      `;
      html = html.replace(match[0], headerHtml);
    } else {
      html = html
        .replace(/^# (.*$)/gm, `<h1 class="font-bold text-slate-900 uppercase" style="font-size: 24pt; margin-top: 0; margin-bottom: 6px; font-family: ${s.fontFamily}; border-bottom: 2px solid #000; padding-bottom: 8px; line-height: 1.2;">$1</h1>`)
        .replace(/^> (.*$)/gm, `<div style="font-size: 10pt; margin-bottom: 12px; line-height: 1.4;" class="text-slate-700 italic font-serif break-words">$1</div>`);
    }

    html = html
      .replace(/^## (.*$)/gm, `
        <div style="margin-top: ${s.h2Top}; margin-bottom: ${s.h2Bottom}; padding-bottom: 4px; border-bottom: 1.5px solid #18181b; width: 100%;">
          <h2 class="font-bold text-slate-900 uppercase" style="font-size: 11pt; font-family: ${s.fontFamily}; letter-spacing: 1px; line-height: 1.4; margin: 0;">$1</h2>
        </div>
      `)
      
      .replace(/^###\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/gm, `
        <div class="flex justify-between items-baseline w-full gap-4" style="margin-top: ${s.h3Top}; margin-bottom: ${s.h3Bottom};">
          <div class="flex flex-wrap items-baseline gap-x-2 flex-1 min-w-0">
            <strong class="font-bold text-slate-900 leading-snug" style="font-size: 11pt; font-family: ${s.fontFamily};">$1</strong>
            <span class="text-slate-900" style="font-size: 11pt;">,</span>
            <span class="italic text-slate-800 leading-snug" style="font-size: 11pt; font-family: ${s.fontFamily};">$2</span>
          </div>
          <div class="font-bold text-slate-900 shrink-0 whitespace-nowrap" style="font-size: 11pt; font-family: ${s.fontFamily};">$3</div>
        </div>
      `)
      .replace(/^###\s*(.*?)\s*\|\s*(.*?)\s*$/gm, `
        <div class="flex justify-between items-baseline w-full gap-4" style="margin-top: ${s.h3Top}; margin-bottom: ${s.h3Bottom};">
          <strong class="font-bold text-slate-900 flex-1 min-w-0 leading-snug" style="font-size: 11pt; font-family: ${s.fontFamily};">$1</strong>
          <div class="font-bold text-slate-900 shrink-0 whitespace-nowrap" style="font-size: 11pt; font-family: ${s.fontFamily};">$2</div>
        </div>
      `)
      .replace(/^### (.*$)/gm, `<h3 class="font-bold text-slate-900" style="font-size: 11pt; margin-top: ${s.h3Top}; margin-bottom: ${s.h3Bottom}; font-family: ${s.fontFamily};">$1</h3>`)

      .replace(/^\s*\*\*(.*?)\*\*\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/gm, `
        <div class="flex justify-between items-baseline w-full gap-4" style="margin-top: ${s.eduMargin}; margin-bottom: ${s.eduMargin};">
           <div class="flex flex-wrap items-baseline gap-x-2 flex-1 min-w-0">
             <strong style="font-size: 11pt;" class="font-bold text-slate-900" style="font-family: ${s.fontFamily};">$1</strong>
             <span style="font-size: 11pt;" class="text-slate-900">,</span>
             <span style="font-size: 11pt;" class="italic text-slate-800">$2</span>
           </div>
           <div style="font-size: 11pt;" class="font-bold text-slate-900 shrink-0 whitespace-nowrap">$3</div>
        </div>
      `);

    html = processCommonMarkdown(html);

    html = html.replace(/^\s*[\-\*] (.*$)/gm, `
      <div class="flex items-start relative pl-4" style="margin-bottom: ${s.listMb}; line-height: ${s.lineHeightPx};">
         <span class="absolute left-0 top-0 text-slate-900" style="font-size: 12px; line-height: ${s.lineHeightPx};">▪</span>
         <span class="flex-1 text-justify text-slate-900" style="line-height: ${s.lineHeightPx};">$1</span>
      </div>
    `);
      
    html = html.replace(/\n\n+/g, `<div style="height: ${s.pSpacing};"></div>`)
               .replace(/\n/g, ' ');

    return html;
  };

  const formatDiagnosisText = (text: string) => {
    let html = text;
    
    // 统一字体大小常量
    const fontSize = '14px';
    const lineHeight = '1.7';
    const textColor = '#27272a';
    const headingColor = '#18181b';

    // === 1. 清理无效内容 ===
    // 移除重复标题
    html = html.replace(/^#{1,2}\s*(诊断报告|Diagnosis Report|简历诊断).*$/gm, '');
    // 清理时间相关描述
    html = html.replace(/^.*(?:以下是基于|基于|截止).*(?:时间节点|日期).*(?:诊断报告|分析).*[:：]?\s*$/gm, '');
    // 清理空加粗标记
    html = html.replace(/\*{2,4}(?:\s*\*{2,4})*/g, '');
    html = html.replace(/匹配评分[:：]\s*$/gm, '');

    // === 2. 评分卡片（按分数范围显示不同颜色）===
    html = html.replace(/(?:匹配评分[:：]\s*)?(\d+)\/100/g, (match, score) => {
      const numScore = parseInt(score);
      let barColor = '#ef4444';  // 红色 - <70分
      let bgColor = '#fef2f2';   // 浅红背景
      let borderColor = '#fecaca'; // 红色边框
      let scoreColor = '#ef4444'; // 分数红色
      
      if (numScore >= 85) {
        barColor = '#16a34a';    // 绿色
        bgColor = '#f0fdf4';     // 浅绿背景
        borderColor = '#bbf7d0'; // 绿色边框
        scoreColor = '#16a34a';  // 分数绿色
      } else if (numScore >= 70) {
        barColor = '#ca8a04';    // 黄色
        bgColor = '#fefce8';     // 浅黄背景
        borderColor = '#fef08a'; // 黄色边框
        scoreColor = '#ca8a04';  // 分数琥珀色
      }

      return `
        <div style="margin: 16px 0; padding: 16px; background: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 6px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
            <span style="font-size: 12px; font-weight: 500; color: #71717a; text-transform: uppercase; letter-spacing: 0.05em;">匹配评分</span>
            <span style="font-size: 20px; font-weight: 700; color: ${scoreColor};">${score}<span style="font-size: 12px; color: #a1a1aa; font-weight: 400;">/100</span></span>
          </div>
          <div style="width: 100%; height: 4px; background: #e4e4e7; border-radius: 2px; overflow: hidden;">
            <div style="height: 100%; background: ${barColor}; width: ${score}%; transition: width 1s ease-out;"></div>
          </div>
        </div>
      `;
    });

    // === 3. 标题处理 ===
    // H2 标题
    html = html.replace(/^##\s+(.+)$/gm, `<div style="margin-top: 24px; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 2px solid ${headingColor};"><span style="font-size: ${fontSize}; font-weight: 700; color: ${headingColor};">$1</span></div>`);
    
    // H3 标题
    html = html.replace(/^###\s+(.+)$/gm, `<div style="margin-top: 20px; margin-bottom: 8px;"><span style="font-size: ${fontSize}; font-weight: 700; color: ${headingColor};">$1</span></div>`);

    // === 4. 列表处理 ===
    // Gap 标题特殊处理 - 加粗显示 (匹配 "* Gap 1: xxx" 或 "- Gap 1: xxx" 格式)
    html = html.replace(/^[-*]\s+\*\*(Gap\s*\d+)\*\*\s*[:：]\s*(.+)$/gm, `<div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; margin-top: 12px; font-size: ${fontSize}; line-height: ${lineHeight}; color: ${textColor};"><span style="margin-top: 8px; width: 4px; height: 4px; border-radius: 50%; background: #a1a1aa; flex-shrink: 0;"></span><span style="flex: 1;"><strong style="font-weight: 700; color: ${headingColor};">$1：</strong>$2</span></div>`);
    
    // Gap 标题 - 纯文本格式 (匹配 "* Gap 1: xxx" 或 "- Gap 1：xxx" 无加粗)
    html = html.replace(/^[-*]\s+(Gap\s*\d+)\s*[:：]\s*(.+)$/gm, `<div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; margin-top: 12px; font-size: ${fontSize}; line-height: ${lineHeight}; color: ${textColor};"><span style="margin-top: 8px; width: 4px; height: 4px; border-radius: 50%; background: #a1a1aa; flex-shrink: 0;"></span><span style="flex: 1;"><strong style="font-weight: 700; color: ${headingColor};">$1：</strong>$2</span></div>`);

    // 有序列表
    html = html.replace(/^(\d+)\.\s+(.+)$/gm, `<div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; font-size: ${fontSize}; line-height: ${lineHeight}; color: ${textColor};"><span style="font-weight: 700; color: ${headingColor}; flex-shrink: 0;">$1.</span><span style="flex: 1;">$2</span></div>`);
    
    // 无序列表 - 开头
    html = html.replace(/^[-*]\s+(.+)$/gm, `<div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 6px; font-size: ${fontSize}; line-height: ${lineHeight}; color: ${textColor};"><span style="margin-top: 8px; width: 4px; height: 4px; border-radius: 50%; background: #a1a1aa; flex-shrink: 0;"></span><span style="flex: 1;">$1</span></div>`);

    // 段落内的 • 符号
    html = html.replace(/•\s*/g, '<br/><span style="display: inline-block; width: 4px; height: 4px; border-radius: 50%; background: #a1a1aa; margin: 0 8px 0 0; vertical-align: middle;"></span>');

    // === 5. 行内格式处理 ===
    // 行内代码
    html = html.replace(/`([^`]+)`/g, `<code style="background: #f4f4f5; color: ${headingColor}; padding: 2px 6px; border-radius: 3px; font-size: ${fontSize}; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;">$1</code>`);

    // 简历亮点标签 - 支持多种格式（加粗格式）- 独立成行
    html = html.replace(/\*\*(简历亮点[^*]*)\*\*\s*[:：]?/g, `<div style="display: flex; align-items: center; gap: 4px; color: #ca8a04; font-size: ${fontSize}; font-weight: 700; margin: 12px 0 6px 0;">✨ $1：</div>`);
    
    // 简历亮点标签 - 支持纯文本格式（非加粗）
    html = html.replace(/(简历亮点\s*\(Highlights\)\s*[:：]?)/g, `<div style="display: flex; align-items: center; gap: 4px; color: #ca8a04; font-size: ${fontSize}; font-weight: 700; margin: 12px 0 6px 0;">✨ 简历亮点 (Highlights)：</div>`);
    
    // 潜在不足标签 - 支持多种格式（加粗格式）- 独立成行
    html = html.replace(/\*\*(潜在不足[^*]*)\*\*\s*[:：]?/g, `<div style="display: flex; align-items: center; gap: 4px; color: #dc2626; font-size: ${fontSize}; font-weight: 700; margin: 12px 0 6px 0;">⚠️ $1：</div>`);
    
    // 潜在不足标签 - 支持纯文本格式（非加粗）
    html = html.replace(/(潜在不足\s*\(Lowlights\)\s*[:：]?)/g, `<div style="display: flex; align-items: center; gap: 4px; color: #dc2626; font-size: ${fontSize}; font-weight: 700; margin: 12px 0 6px 0;">⚠️ 潜在不足 (Lowlights)：</div>`);
    
    // 兼容旧版：硬伤标签 -> 潜在不足样式
    html = html.replace(/\*\*(硬伤[^*]*)\*\*\s*[:：]?/g, `<div style="display: flex; align-items: center; gap: 4px; color: #dc2626; font-size: ${fontSize}; font-weight: 700; margin: 12px 0 6px 0;">⚠️ $1：</div>`);
    
    // 兼容旧版：潜在亮点标签 -> 简历亮点样式
    html = html.replace(/\*\*(潜在亮点[^*]*)\*\*\s*[:：]?/g, `<div style="display: flex; align-items: center; gap: 4px; color: #ca8a04; font-size: ${fontSize}; font-weight: 700; margin: 12px 0 6px 0;">✨ $1：</div>`);

    // 普通加粗
    html = html.replace(/\*\*(.+?)\*\*/g, `<strong style="font-weight: 700; color: ${headingColor};">$1</strong>`);

    // 斜体
    html = html.replace(/(^|[\s\p{P}])\*([^*\n]+?)\*(?=[\s\p{P}]|$)/gmu, '$1<em style="font-style: italic;">$2</em>');

    // === 6. 最终清理 ===
    // 移除孤立星号
    html = html.replace(/\*{1,2}(?![^<]*>)/g, '');
    
    // 段落间距
    html = html.replace(/\n\n+/g, '<div style="height: 12px;"></div>');
    html = html.replace(/\n/g, ' ');

    // 包裹整体内容，确保统一字体
    html = `<div style="font-size: ${fontSize}; line-height: ${lineHeight}; color: ${textColor};">${html}</div>`;

    return html;
  };

  const finalHtml = mode === 'resume' ? formatResumeText(content) : formatDiagnosisText(content);

  return (
    <div 
      className={`break-words w-full h-full antialiased text-slate-900 ${mode === 'resume' ? '' : 'diagnosis-mode'}`}
      style={{ 
        fontSize: s.baseTextSize,
        fontFamily: s.fontFamily,
        lineHeight: mode === 'resume' ? 1.5 : 1.6,
        fontVariantLigatures: 'none'
      }}
      dangerouslySetInnerHTML={{ __html: finalHtml }}
    />
  );
};

export default MarkdownRenderer;
