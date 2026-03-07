
import React from 'react';

export type ResumeTemplate = 'classic' | 'tech' | 'academic';

interface Props {
  content: string;
  isResumePreview?: boolean;
  densityMultiplier?: number;
  mode?: 'resume' | 'diagnosis';
  template?: ResumeTemplate;
}

const MarkdownRenderer: React.FC<Props> = ({ 
  content, 
  isResumePreview = false,
  densityMultiplier = 1.0,
  mode = 'resume',
  template = 'classic'
}) => {
  
  // 使用固定的 px 值而不是 rem，确保 html2canvas 渲染一致性
  const lineHeightValue = 1.4 + (0.1 * densityMultiplier);
  
  const s = {
    fontFamily: mode === 'resume' 
      ? (template === 'tech' 
          ? '"PingFang SC", "Microsoft YaHei", "微软雅黑", "SimHei", "黑体", system-ui, sans-serif'
          : template === 'academic'
            ? '"Songti SC", "STSong", "SimSun", "宋体", serif'
            : '"Times New Roman", Times, "SimSun", "宋体", serif')
      : '"Inter", system-ui, sans-serif',
    // 学术版标题字体（苹方粗体，字重区分度最好）
    academicHeadingFont: '"PingFang SC", "Microsoft YaHei", "SimHei", "黑体", sans-serif',
    // 学术版主题色（深蓝）
    academicAccent: '#1a3764',
    
    baseTextSize: isResumePreview ? '10.5pt' : '15px',
    lineHeight: lineHeightValue,
    lineHeightPx: isResumePreview ? `${Math.round(10.5 * lineHeightValue * 1.333)}px` : `${Math.round(15 * lineHeightValue)}px`,
    
    h1Mb: `${Math.round(6 * densityMultiplier)}px`, 
    nameMb: `${Math.round(8 * densityMultiplier)}px`, 
    h2Top: `${Math.round(12 * densityMultiplier)}px`, 
    h2Bottom: `${Math.round(5 * densityMultiplier)}px`,
    h2PaddingBottom: `${Math.round(6 * densityMultiplier)}px`,
    h3Top: `${Math.round(10 * densityMultiplier)}px`,
    h3Bottom: `${Math.round(3 * densityMultiplier)}px`,
    listMb: `${Math.round(2 * densityMultiplier)}px`, 
    pSpacing: `${Math.round(8 * densityMultiplier)}px`,
    eduMargin: `${Math.round(2 * densityMultiplier)}px`,
    borderBottom: '1px solid #000', 
    // 模板2 专用颜色（深色，与字体统一）
    accentColor: '#18181b', // zinc-900
    accentLight: '#e4e4e7', // zinc-200
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

    // === 第一步：全局提取照片 URL（不管在哪一行），然后从原文移除 ===
    // 支持: ![photo](url)、![ ](url)、] 和 ( 之间有换行、URL内部有换行
    let imgUrl = '';
    // 匹配 ![photo](url)，URL 内部允许换行但不含 )
    const photoRegex = /!\[(?:photo|avatar|头像|照片)?\]\s*\(\s*([^)]*?)\s*\)/;
    const photoMatch = html.match(photoRegex);
    if (photoMatch) {
      const rawUrl = photoMatch[1].replace(/\s+/g, '');
      // 只有有效的 http/https URL 才使用，否则丢弃
      if (/^https?:\/\/.+/i.test(rawUrl)) {
        // 加时间戳 bust 缓存（照片固定路径 upsert 覆盖，需避免浏览器缓存旧图）
        const separator = rawUrl.includes('?') ? '&' : '?';
        imgUrl = `${rawUrl}${separator}t=${Math.floor(Date.now() / 60000)}`;
      }
      // 不管URL是否有效，都从原文移除照片markdown（包括前后空行）
      html = html.replace(/\n*!\[(?:photo|avatar|头像|照片)?\]\s*\(\s*[^)]*?\s*\)\n*/g, '\n');
      html = html.replace(/\n{3,}/g, '\n\n');
    }

    // === 第二步：收集头部区域的所有 > 行（# 姓名之后、第一个 ## 之前的所有 > 行）===
    // 先找到 # 姓名
    const nameMatch = html.match(/^# (.*?)$/m);
    let headerName = '';
    let contactLines: string[] = [];
    let headerMatchStr = '';

    let summaryLines: string[] = [];

    if (nameMatch) {
      headerName = nameMatch[1];
      // 获取从 # 姓名行到第一个 ## 或 ### 之间的所有文本
      const nameIdx = nameMatch.index ?? 0;
      const afterName = html.slice(nameIdx + nameMatch[0].length);
      // 找到下一个 ## 标题的位置
      const nextSectionMatch = afterName.match(/\n(?=##\s)/);
      const headerArea = nextSectionMatch ? afterName.slice(0, nextSectionMatch.index) : afterName;
      
      // 从 headerArea 中提取 > 行（联系方式）和非空普通文本行（个人简介/摘要）
      const areaLines = headerArea.split('\n');
      for (const line of areaLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('> ')) {
          contactLines.push(trimmed.replace(/^> /, ''));
        } else if (!trimmed.startsWith('#')) {
          // 非标题、非引用的普通文本行，作为个人简介/摘要
          summaryLines.push(trimmed);
        }
      }
      
      // 构建需要替换的完整 header 区域字符串
      headerMatchStr = html.slice(nameIdx, nameIdx + nameMatch[0].length + (nextSectionMatch ? (nextSectionMatch.index ?? 0) : headerArea.length));
    }

    if (nameMatch && headerMatchStr) {
      // 头部区域：照片在右侧与姓名+联系方式并排
      const headerHtml = `
        <div style="display:flex;align-items:flex-start;gap:12px;margin-top:0;margin-bottom:8px;width:100%;padding-top:2px;">
          <div style="flex:1;min-width:0;">
            <h1 class="font-bold text-slate-900 uppercase" style="font-size: 24pt; margin: 0 0 6px 0; padding: 0; font-family: ${s.fontFamily}; letter-spacing: 0.5px; line-height: 1;">${headerName}</h1>
            ${contactLines.map((line: string) => 
              `<div style="font-size: 10.5pt; line-height: ${s.lineHeightPx}; margin-top: 2px;" class="text-slate-700 break-words font-serif italic">${line}</div>`
            ).join('\n')}
            ${summaryLines.length ? summaryLines.map((line: string) => 
              `<div style="font-size: ${s.baseTextSize}; line-height: ${s.lineHeightPx}; margin-top: 4px; font-family: ${s.fontFamily};" class="text-slate-900 break-words">${processCommonMarkdown(line)}</div>`
            ).join('\n') : ''}
          </div>
          ${imgUrl ? `<div style="flex-shrink:0;width:80px;height:107px;"><img src="${imgUrl}" style="width:80px;height:107px;object-fit:cover;border:1px solid #ddd;border-radius:2px;display:block;" alt="Profile" onerror="this.style.display='none';this.parentElement.style.background='#f1f5f9';this.parentElement.style.border='1px solid #ddd';this.parentElement.style.borderRadius='2px';" /></div>` : ''}
        </div>
      `;
      html = html.replace(headerMatchStr, headerHtml);
    } else {
      html = html
        .replace(/^# (.*$)/gm, `<h1 class="font-bold text-slate-900 uppercase" style="font-size: 24pt; margin-top: 0; margin-bottom: 6px; font-family: ${s.fontFamily}; border-bottom: 2px solid #000; padding-bottom: 8px; line-height: 1.2;">$1</h1>`)
        .replace(/^> (.*$)/gm, `<div style="font-size: 10pt; margin-bottom: 12px; line-height: 1.4;" class="text-slate-700 italic font-serif break-words">$1</div>`);
    }

    html = html
      .replace(/^## (.*$)/gm, `
        <div style="margin-top: ${s.h2Top}; margin-bottom: ${s.h2Bottom}; border-bottom: 1.5px solid #18181b; width: 100%;">
          <h2 class="font-bold text-slate-900 uppercase" style="font-size: 11pt; font-family: ${s.fontFamily}; letter-spacing: 1px; line-height: 1.4; margin: 0;">$1</h2>
          <div style="height: 8px; background: transparent;"></div>
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

  // ==================== 模板2：清晰直观 (Tech) ====================
  const formatResumeTech = (text: string) => {
    let html = text.replace(/^\s+/, '');

    // === 第一步：全局提取照片 URL ===
    let imgUrl = '';
    const photoRegex = /!\[(?:photo|avatar|头像|照片)?\]\s*\(\s*([^)]*?)\s*\)/;
    const photoMatch = html.match(photoRegex);
    if (photoMatch) {
      const rawUrl = photoMatch[1].replace(/\s+/g, '');
      if (/^https?:\/\/.+/i.test(rawUrl)) {
        const separator = rawUrl.includes('?') ? '&' : '?';
        imgUrl = `${rawUrl}${separator}t=${Math.floor(Date.now() / 60000)}`;
      }
      html = html.replace(/\n*!\[(?:photo|avatar|头像|照片)?\]\s*\(\s*[^)]*?\s*\)\n*/g, '\n');
      html = html.replace(/\n{3,}/g, '\n\n');
    }

    // === 第二步：收集头部区域 ===
    const nameMatch = html.match(/^# (.*?)$/m);
    let headerName = '';
    let contactLines: string[] = [];
    let headerMatchStr = '';
    let summaryLines: string[] = [];

    if (nameMatch) {
      headerName = nameMatch[1];
      const nameIdx = nameMatch.index ?? 0;
      const afterName = html.slice(nameIdx + nameMatch[0].length);
      const nextSectionMatch = afterName.match(/\n(?=##\s)/);
      const headerArea = nextSectionMatch ? afterName.slice(0, nextSectionMatch.index) : afterName;
      
      const areaLines = headerArea.split('\n');
      for (const line of areaLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('> ')) {
          contactLines.push(trimmed.replace(/^> /, ''));
        } else if (!trimmed.startsWith('#')) {
          summaryLines.push(trimmed);
        }
      }
      
      headerMatchStr = html.slice(nameIdx, nameIdx + nameMatch[0].length + (nextSectionMatch ? (nextSectionMatch.index ?? 0) : headerArea.length));
    }

    if (nameMatch && headerMatchStr) {
      // 模板2头部：照片在左侧 + 姓名加粗大字 + 联系方式紧凑一行
      const contactHtml = contactLines.length 
        ? `<div style="font-size: 9.5pt; line-height: 1.6; margin-top: 4px; color: #374151; font-family: ${s.fontFamily};">${contactLines.join(' &nbsp;|&nbsp; ')}</div>` 
        : '';
      const summaryHtml = summaryLines.length 
        ? summaryLines.map((line: string) => 
            `<div style="font-size: ${s.baseTextSize}; line-height: ${s.lineHeightPx}; margin-top: 4px; font-family: ${s.fontFamily}; color: #374151;">${processCommonMarkdown(line)}</div>`
          ).join('\n') 
        : '';
      
      const headerHtml = `
        <div style="display:flex;align-items:flex-start;gap:14px;margin-top:0;margin-bottom:10px;width:100%;padding-top:2px;">
          ${imgUrl ? `<div style="flex-shrink:0;width:88px;height:110px;"><img src="${imgUrl}" style="width:88px;height:110px;object-fit:cover;border:2px solid ${s.accentLight};border-radius:6px;display:block;" alt="Profile" onerror="this.style.display='none';this.parentElement.style.background='#f1f5f9';this.parentElement.style.border='2px solid ${s.accentLight}';this.parentElement.style.borderRadius='6px';" /></div>` : ''}
          <div style="flex:1;min-width:0;">
            <h1 style="font-size: 22pt; margin: 0 0 2px 0; padding: 0; font-family: ${s.fontFamily}; font-weight: 900; color: #111827; letter-spacing: 0.3px; line-height: 1.1; -webkit-text-stroke: 0.5px #111827;">${headerName}</h1>
            ${contactHtml}
            ${summaryHtml}
          </div>
        </div>
      `;
      html = html.replace(headerMatchStr, headerHtml);
    } else {
      html = html
        .replace(/^# (.*$)/gm, `<h1 style="font-size: 22pt; margin-top: 0; margin-bottom: 8px; font-family: ${s.fontFamily}; font-weight: 900; color: #111827; line-height: 1.2; -webkit-text-stroke: 0.5px #111827;">$1</h1>`)
        .replace(/^> (.*$)/gm, `<div style="font-size: 9.5pt; margin-bottom: 10px; line-height: 1.5; color: #374151; font-family: ${s.fontFamily};">$1</div>`);
    }

    // === 第三步：## 标题 — 蓝色加粗 + 蓝色下划线 ===
    html = html
      .replace(/^## (.*$)/gm, `
        <div style="margin-top: ${s.h2Top}; margin-bottom: ${s.h2Bottom}; border-bottom: 2px solid ${s.accentColor}; width: 100%;">
          <h2 style="font-size: 11.5pt; font-family: ${s.fontFamily}; font-weight: 900; letter-spacing: 0.5px; line-height: 1.4; margin: 0; color: ${s.accentColor}; -webkit-text-stroke: 0.3px ${s.accentColor};">$1</h2>
          <div style="height: 6px; background: transparent;"></div>
        </div>
      `)
      
      // ### 三栏：公司 | 职位 | 日期
      .replace(/^###\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/gm, `
        <div style="display:flex;justify-content:space-between;align-items:baseline;width:100%;gap:8px;margin-top: ${s.h3Top}; margin-bottom: ${s.h3Bottom};">
          <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;flex:1;min-width:0;">
            <strong style="font-size: 11pt; font-family: ${s.fontFamily}; font-weight: 700; color: #111827;">$1</strong>
            <span style="font-size: 10.5pt; color: #4b5563; font-family: ${s.fontFamily};">$2</span>
          </div>
          <div style="font-size: 10pt; font-family: ${s.fontFamily}; font-weight: 500; color: #6b7280; flex-shrink:0; white-space:nowrap;">$3</div>
        </div>
      `)
      // ### 两栏：标题 | 日期
      .replace(/^###\s*(.*?)\s*\|\s*(.*?)\s*$/gm, `
        <div style="display:flex;justify-content:space-between;align-items:baseline;width:100%;gap:8px;margin-top: ${s.h3Top}; margin-bottom: ${s.h3Bottom};">
          <strong style="font-size: 11pt; font-family: ${s.fontFamily}; font-weight: 700; color: #111827; flex:1;min-width:0;">$1</strong>
          <div style="font-size: 10pt; font-family: ${s.fontFamily}; font-weight: 500; color: #6b7280; flex-shrink:0; white-space:nowrap;">$2</div>
        </div>
      `)
      // ### 单标题
      .replace(/^### (.*$)/gm, `<h3 style="font-size: 11pt; margin-top: ${s.h3Top}; margin-bottom: ${s.h3Bottom}; font-family: ${s.fontFamily}; font-weight: 700; color: #111827;">$1</h3>`)

      // **加粗** | 文本 | 日期（教育经历格式）
      .replace(/^\s*\*\*(.*?)\*\*\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/gm, `
        <div style="display:flex;justify-content:space-between;align-items:baseline;width:100%;gap:8px;margin-top: ${s.eduMargin}; margin-bottom: ${s.eduMargin};">
           <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;flex:1;min-width:0;">
             <strong style="font-size: 11pt; font-family: ${s.fontFamily}; font-weight: 700; color: #111827;">$1</strong>
             <span style="font-size: 10.5pt; color: #4b5563; font-family: ${s.fontFamily};">$2</span>
           </div>
           <div style="font-size: 10pt; font-family: ${s.fontFamily}; font-weight: 500; color: #6b7280; flex-shrink:0; white-space:nowrap;">$3</div>
        </div>
      `);

    html = processCommonMarkdown(html);

    // 列表项 — 蓝色菱形标记
    html = html.replace(/^\s*[\-\*] (.*$)/gm, `
      <div style="display:flex;align-items:flex-start;position:relative;padding-left:14px;margin-bottom: ${s.listMb}; line-height: ${s.lineHeightPx};">
         <span style="position:absolute;left:0;top:0;font-size:9px;line-height:${s.lineHeightPx};color:${s.accentColor};">◆</span>
         <span style="flex:1;text-align:justify;color:#1f2937;line-height:${s.lineHeightPx};">$1</span>
      </div>
    `);
      
    html = html.replace(/\n\n+/g, `<div style="height: ${s.pSpacing};"></div>`)
               .replace(/\n/g, ' ');

    return html;
  };

  // ==================== 模板3：学术简历 (Academic) ====================
  const formatResumeAcademic = (text: string) => {
    let html = text.replace(/^\s+/, '');
    const ac = s.academicAccent;
    const hf = s.academicHeadingFont;
    const bf = s.fontFamily;

    // === 第一步：全局提取照片 URL ===
    let imgUrl = '';
    const photoRegex = /!\[(?:photo|avatar|头像|照片)?\]\s*\(\s*([^)]*?)\s*\)/;
    const photoMatch = html.match(photoRegex);
    if (photoMatch) {
      const rawUrl = photoMatch[1].replace(/\s+/g, '');
      if (/^https?:\/\/.+/i.test(rawUrl)) {
        const separator = rawUrl.includes('?') ? '&' : '?';
        imgUrl = `${rawUrl}${separator}t=${Math.floor(Date.now() / 60000)}`;
      }
      html = html.replace(/\n*!\[(?:photo|avatar|头像|照片)?\]\s*\(\s*[^)]*?\s*\)\n*/g, '\n');
      html = html.replace(/\n{3,}/g, '\n\n');
    }

    // === 第二步：收集头部区域 ===
    const nameMatch = html.match(/^# (.*?)$/m);
    let headerName = '';
    let contactLines: string[] = [];
    let headerMatchStr = '';
    let summaryLines: string[] = [];

    if (nameMatch) {
      headerName = nameMatch[1];
      const nameIdx = nameMatch.index ?? 0;
      const afterName = html.slice(nameIdx + nameMatch[0].length);
      const nextSectionMatch = afterName.match(/\n(?=##\s)/);
      const headerArea = nextSectionMatch ? afterName.slice(0, nextSectionMatch.index) : afterName;
      
      const areaLines = headerArea.split('\n');
      for (const line of areaLines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('> ')) {
          contactLines.push(trimmed.replace(/^> /, ''));
        } else if (!trimmed.startsWith('#')) {
          summaryLines.push(trimmed);
        }
      }
      
      headerMatchStr = html.slice(nameIdx, nameIdx + nameMatch[0].length + (nextSectionMatch ? (nextSectionMatch.index ?? 0) : headerArea.length));
    }

    if (nameMatch && headerMatchStr) {
      const contactHtml = contactLines.length 
        ? `<div style="font-size: 10pt; line-height: 1.6; margin-top: 4px; color: #374151; font-family: ${bf}; text-align: center;">${contactLines.join(' &nbsp;|&nbsp; ')}</div>` 
        : '';
      const summaryHtml = summaryLines.length 
        ? summaryLines.map((line: string) => 
            `<div style="font-size: ${s.baseTextSize}; line-height: ${s.lineHeightPx}; margin-top: 4px; font-family: ${bf}; color: #374151; text-align: center;">${processCommonMarkdown(line)}</div>`
          ).join('\n') 
        : '';
      
      const headerHtml = `
        <div style="position:relative;margin-top:0;margin-bottom:10px;width:100%;padding-top:2px;">
          ${imgUrl ? `<div style="position:absolute;right:0;top:0;width:80px;height:107px;"><img src="${imgUrl}" style="width:80px;height:107px;object-fit:cover;border:1px solid #d1d5db;display:block;" alt="Profile" onerror="this.style.display='none';this.parentElement.style.display='none';" /></div>` : ''}
          <div style="text-align:center;${imgUrl ? 'padding-right:90px;' : ''}">
            <h1 style="font-size: 22pt; margin: 0 0 2px 0; padding: 0; font-family: ${hf}; font-weight: 900; color: #111827; letter-spacing: 1px; line-height: 1.2; -webkit-text-stroke: 0.5px #111827;">${headerName}</h1>
            ${contactHtml}
            ${summaryHtml}
          </div>
        </div>
      `;
      html = html.replace(headerMatchStr, headerHtml);
    } else {
      html = html
        .replace(/^# (.*$)/gm, `<h1 style="font-size: 22pt; margin-top: 0; margin-bottom: 8px; font-family: ${hf}; font-weight: 900; color: #111827; text-align: center; line-height: 1.2; -webkit-text-stroke: 0.5px #111827;">$1</h1>`)
        .replace(/^> (.*$)/gm, `<div style="font-size: 10pt; margin-bottom: 10px; line-height: 1.5; color: #374151; font-family: ${bf}; text-align: center;">$1</div>`);
    }

    // === 第三步：## 标题 — 深蓝色加粗 + 蓝色下划线 ===
    html = html
      .replace(/^## (.*$)/gm, `
        <div style="margin-top: ${s.h2Top}; margin-bottom: ${s.h2Bottom}; border-bottom: 2px solid ${ac}; width: 100%;">
          <h2 style="font-size: 12pt; font-family: ${hf}; font-weight: 900; letter-spacing: 1px; line-height: 1.4; margin: 0; color: ${ac}; -webkit-text-stroke: 0.3px ${ac};">$1</h2>
          <div style="height: 5px; background: transparent;"></div>
        </div>
      `)
      
      // ### 三栏：机构 | 角色 | 日期
      .replace(/^###\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/gm, `
        <div style="display:flex;justify-content:space-between;align-items:baseline;width:100%;gap:8px;margin-top: ${s.h3Top}; margin-bottom: ${s.h3Bottom};">
          <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;flex:1;min-width:0;">
            <strong style="font-size: 11pt; font-family: ${hf}; font-weight: 800; color: #111827;">$1</strong>
            <span style="font-size: 10.5pt; color: #4b5563; font-family: ${bf};">$2</span>
          </div>
          <div style="font-size: 10pt; font-family: ${bf}; font-weight: 500; color: #374151; flex-shrink:0; white-space:nowrap;">$3</div>
        </div>
      `)
      // ### 两栏：标题 | 日期
      .replace(/^###\s*(.*?)\s*\|\s*(.*?)\s*$/gm, `
        <div style="display:flex;justify-content:space-between;align-items:baseline;width:100%;gap:8px;margin-top: ${s.h3Top}; margin-bottom: ${s.h3Bottom};">
          <strong style="font-size: 11pt; font-family: ${hf}; font-weight: 800; color: #111827; flex:1;min-width:0;">$1</strong>
          <div style="font-size: 10pt; font-family: ${bf}; font-weight: 500; color: #374151; flex-shrink:0; white-space:nowrap;">$2</div>
        </div>
      `)
      // ### 单标题
      .replace(/^### (.*$)/gm, `<h3 style="font-size: 11pt; margin-top: ${s.h3Top}; margin-bottom: ${s.h3Bottom}; font-family: ${hf}; font-weight: 800; color: #111827;">$1</h3>`)

      // **加粗** | 文本 | 日期（教育经历格式）
      .replace(/^\s*\*\*(.*?)\*\*\s*\|\s*(.*?)\s*\|\s*(.*?)\s*$/gm, `
        <div style="display:flex;justify-content:space-between;align-items:baseline;width:100%;gap:8px;margin-top: ${s.eduMargin}; margin-bottom: ${s.eduMargin};">
           <div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:0 6px;flex:1;min-width:0;">
             <strong style="font-size: 11pt; font-family: ${hf}; font-weight: 800; color: #111827;">$1</strong>
             <span style="font-size: 10.5pt; color: #4b5563; font-family: ${bf};">$2</span>
           </div>
           <div style="font-size: 10pt; font-family: ${bf}; font-weight: 500; color: #374151; flex-shrink:0; white-space:nowrap;">$3</div>
        </div>
      `);

    html = processCommonMarkdown(html);

    // 列表项 — 圆点标记
    html = html.replace(/^\s*[\-\*] (.*$)/gm, `
      <div style="display:flex;align-items:flex-start;position:relative;padding-left:16px;margin-bottom: ${s.listMb}; line-height: ${s.lineHeightPx};">
         <span style="position:absolute;left:3px;top:0;font-size:10px;line-height:${s.lineHeightPx};color:#374151;">•</span>
         <span style="flex:1;text-align:justify;color:#1f2937;line-height:${s.lineHeightPx};">$1</span>
      </div>
    `);
      
    html = html.replace(/\n\n+/g, `<div style="height: ${s.pSpacing};"></div>`)
               .replace(/\n/g, ' ');

    return html;
  };

  const formatDiagnosisText = (text: string) => {
    let html = text;
    
    const fontSize = '14px';
    const lineHeight = '1.7';
    const textColor = '#27272a';
    const headingColor = '#18181b';

    const getScoreColor = (percent: number) => {
      if (percent >= 85) return { bar: 'linear-gradient(90deg, #6ee7b7, #059669)', bg: '#ecfdf5', text: '#047857' };
      if (percent >= 70) return { bar: 'linear-gradient(90deg, #93c5fd, #3b82f6)', bg: '#eff6ff', text: '#1d4ed8' };
      if (percent >= 50) return { bar: 'linear-gradient(90deg, #fcd34d, #f59e0b)', bg: '#fffbeb', text: '#b45309' };
      return { bar: 'linear-gradient(90deg, #fca5a5, #ef4444)', bg: '#fef2f2', text: '#dc2626' };
    };

    // === 1. 清理 ===
    html = html.replace(/^#{1,2}\s*(诊断报告|Diagnosis Report|简历诊断).*$/gm, '');
    html = html.replace(/^.*(?:以下是基于|基于|截止).*(?:时间节点|日期).*(?:诊断报告|分析).*[:：]?\s*$/gm, '');
    html = html.replace(/\*{2,4}(?:\s*\*{2,4})*/g, '');
    html = html.replace(/匹配评分[:：]\s*$/gm, '');
    // 清理旧版"评分明细"标题
    html = html.replace(/^#{1,3}\s*评分明细.*$/gm, '');
    html = html.replace(/^评分明细[:：]?\s*$/gm, '');

    // === 2. 候选人画像整合卡片（总分 + 画像文本 + 维度进度条） ===
    let totalScore = 0;
    let profileText = '';
    let dimensionScores: { label: string; score: number; max: number }[] = [];

    // 提取总分
    const scoreMatch = html.match(/(?:匹配评分[:：]\s*)?(\d+)\/100/);
    if (scoreMatch) {
      totalScore = parseInt(scoreMatch[1]);
      html = html.replace(/(?:匹配评分[:：]\s*)?\d+\/100/, '{{SCORE_CARD}}');
    }

    // 提取维度得分 — 新格式（一行 | 分隔）
    const dimMatch = html.match(/(?:维度得分[:：]\s*)(.+?)(?=\n|$)/m);
    if (dimMatch) {
      const scoresLine = dimMatch[1];
      const dims = [
        { label: '技能匹配', key: '技能匹配', max: 25 },
        { label: '经验匹配', key: '经验匹配', max: 25 },
        { label: '项目贴合', key: '项目贴合', max: 25 },
        { label: '内容规范', key: '内容规范', max: 25 },
      ];
      dimensionScores = dims.map(dim => {
        const regex = new RegExp(dim.key + '\\s*(\\d+)\\/' + dim.max);
        const m = scoresLine.match(regex);
        return { label: dim.label, score: m ? parseInt(m[1]) : 0, max: dim.max };
      });
      html = html.replace(/(?:维度得分[:：]\s*).+?(?=\n|$)/m, '{{DIM_BARS}}');
    } else {
      // 旧格式兼容：从列表行中提取维度得分（如 "- 硬技能匹配：18/30（...）"）
      const oldDims = [
        { label: '技能匹配', pattern: /硬技能匹配/, max: 30 },
        { label: '经验匹配', pattern: /经验匹配/, max: 25 },
        { label: '项目贴合', pattern: /项目相关性/, max: 15 },
        { label: '内容规范', pattern: /(?:量化成果|简历规范性)/, max: 20 },
      ];
      const oldScoreLines = html.match(/^[-*•]\s*.+?[:：]\s*\d+\/\d+.*/gm);
      if (oldScoreLines && oldScoreLines.length >= 3) {
        dimensionScores = [];
        for (const line of oldScoreLines) {
          const numMatch = line.match(/(\d+)\/(\d+)/);
          if (!numMatch) continue;
          const score = parseInt(numMatch[1]);
          const max = parseInt(numMatch[2]);
          let label = '其他';
          for (const dim of oldDims) {
            if (dim.pattern.test(line)) { label = dim.label; break; }
          }
          // 合并量化成果和简历规范性为"内容规范"
          const existing = dimensionScores.find(d => d.label === label);
          if (existing) {
            existing.score += score;
            existing.max += max;
          } else {
            dimensionScores.push({ label, score, max });
          }
        }
        // 移除旧的维度得分列表行
        html = html.replace(/^[-*•]\s*(?:硬技能匹配|经验匹配|量化成果|项目相关性|简历规范性)\s*[:：]\s*\d+\/\d+.*$/gm, '');
      }
    }

    // 提取候选人画像文本
    const profileMatch = html.match(/(?:候选人画像[:：]\s*)(.+?)(?=\n|$)/m);
    if (profileMatch) {
      profileText = profileMatch[1].trim();
      html = html.replace(/(?:候选人画像[:：]\s*).+?(?=\n|$)/m, '{{PROFILE}}');
    }

    // 构建整合卡片
    const scoreColors = getScoreColor(totalScore);
    const barsHtml = dimensionScores.map(dim => {
      const pct = Math.round((dim.score / dim.max) * 100);
      const c = getScoreColor(pct);
      return `<div style="display:flex;align-items:center;gap:8px;"><span style="font-size:12px;color:#71717a;white-space:nowrap;width:56px;text-align:right;flex-shrink:0;letter-spacing:0.02em;">${dim.label}</span><div style="flex:1;height:6px;background:#f4f4f5;border-radius:3px;overflow:hidden;"><div style="height:100%;background:${c.bar};width:${pct}%;border-radius:3px;transition:width 0.6s ease;"></div></div><span style="font-size:11px;font-weight:600;color:${c.text};white-space:nowrap;width:32px;flex-shrink:0;text-align:right;">${pct}%</span></div>`;
    }).join('');

    const integratedCard = `
      <div style="margin:12px 0;padding:14px 16px;background:#fafafa;border:1px solid #e4e4e7;border-radius:10px;">
        <div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:${dimensionScores.length ? '12px' : '0'};">
          <div style="position:relative;width:52px;height:52px;flex-shrink:0;">
            <svg viewBox="0 0 36 36" style="width:52px;height:52px;transform:rotate(-90deg);">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#e4e4e7" stroke-width="3"></circle>
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="${scoreColors.text}" stroke-width="3" stroke-dasharray="${totalScore} ${100 - totalScore}" stroke-linecap="round"></circle>
            </svg>
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">
              <span style="font-size:15px;font-weight:800;color:${scoreColors.text};">${totalScore}</span>
            </div>
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:11px;color:#a1a1aa;font-weight:500;letter-spacing:0.05em;margin-bottom:2px;">匹配评分 / 100</div>
            ${profileText ? `<div style="font-size:13px;color:${headingColor};line-height:1.5;font-weight:500;">${profileText}</div>` : ''}
          </div>
        </div>
        ${dimensionScores.length ? `<div style="display:flex;flex-direction:column;gap:6px;">${barsHtml}</div>` : ''}
      </div>
    `;

    // 替换占位符
    html = html.replace('{{SCORE_CARD}}', integratedCard);
    html = html.replace('{{DIM_BARS}}', '');
    html = html.replace('{{PROFILE}}', '');

    // === 3. 标题 ===
    html = html.replace(/^##\s+(.+)$/gm, `<div style="margin-top:22px;margin-bottom:12px;padding-bottom:7px;border-bottom:2px solid ${headingColor};"><span style="font-size:15px;font-weight:700;color:${headingColor};letter-spacing:0.02em;">$1</span></div>`);
    html = html.replace(/^###\s+(.+)$/gm, `<div style="margin-top:16px;margin-bottom:8px;"><span style="font-size:${fontSize};font-weight:700;color:${headingColor};">$1</span></div>`);

    // === 4. 列表 ===
    // 不足项：加粗标题 + 问题 + 建议
    html = html.replace(/^[-*]\s+\*\*([^*]+)\*\*\s*[:：]\s*(.+)$/gm, (_m, title: string, desc: string) => {
      const parts = desc.split(/\s*→\s*/);
      if (parts.length >= 2) {
        return `<div style="display:flex;align-items:flex-start;gap:8px;margin:8px 0 2px;font-size:${fontSize};line-height:${lineHeight};color:${textColor};"><span style="color:#ef4444;flex-shrink:0;margin-top:2px;font-size:8px;">●</span><span style="flex:1;"><strong style="font-weight:600;color:${headingColor};">${title}</strong>：${parts[0]}</span></div><div style="margin:2px 0 8px 16px;font-size:13px;line-height:1.6;color:#4338ca;">→ ${parts.slice(1).join(' → ')}</div>`;
      }
      return `<div style="display:flex;align-items:flex-start;gap:8px;margin:8px 0;font-size:${fontSize};line-height:${lineHeight};color:${textColor};"><span style="color:#ef4444;flex-shrink:0;margin-top:2px;font-size:8px;">●</span><span style="flex:1;"><strong style="font-weight:600;color:${headingColor};">${title}</strong>：${desc}</span></div>`;
    });

    // 有序列表：合并后续缩进行（非编号、非标题的续行归入上一个编号项）
    html = html.replace(/^(\d+)\.\s+(.+?)(?=\n\d+\.|\n##|\n###|\n\n|\n*$)/gms, (_m, num: string, content: string) => {
      const merged = content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
      return `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;font-size:${fontSize};line-height:${lineHeight};color:${textColor};"><span style="font-weight:600;color:${headingColor};flex-shrink:0;">${num}.</span><span style="flex:1;">${merged}</span></div>`;
    });
    
    // 无序列表
    html = html.replace(/^[-*]\s+(.+)$/gm, `<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:5px;font-size:${fontSize};line-height:${lineHeight};color:${textColor};"><span style="margin-top:9px;width:4px;height:4px;border-radius:50%;background:#a1a1aa;flex-shrink:0;"></span><span style="flex:1;">$1</span></div>`);

    html = html.replace(/•\s*/g, '<br/><span style="display:inline-block;width:4px;height:4px;border-radius:50%;background:#a1a1aa;margin:0 8px 0 0;vertical-align:middle;"></span>');

    // === 5. 行内格式 ===
    html = html.replace(/`([^`]+)`/g, `<code style="background:#f4f4f5;color:${headingColor};padding:2px 6px;border-radius:3px;font-size:${fontSize};font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">$1</code>`);

    // 简历亮点
    html = html.replace(/\*\*(简历亮点[^*]*)\*\*\s*[:：]?/g, `<div style="color:#b45309;font-size:${fontSize};font-weight:700;margin:12px 0 6px;">✨ $1：</div>`);
    html = html.replace(/(简历亮点\s*\(Highlights\)\s*[:：]?)/g, `<div style="color:#b45309;font-size:${fontSize};font-weight:700;margin:12px 0 6px;">✨ 简历亮点 (Highlights)：</div>`);
    
    // 潜在不足标签
    html = html.replace(/\*\*(潜在不足[^*]*)\*\*\s*[:：]?/g, `<div style="color:#dc2626;font-size:${fontSize};font-weight:700;margin:12px 0 6px;">⚠️ $1：</div>`);
    html = html.replace(/(潜在不足\s*\(Lowlights\)\s*[:：]?)/g, `<div style="color:#dc2626;font-size:${fontSize};font-weight:700;margin:12px 0 6px;">⚠️ 潜在不足 (Lowlights)：</div>`);
    
    // 兼容旧版
    html = html.replace(/\*\*(硬伤[^*]*)\*\*\s*[:：]?/g, `<div style="color:#dc2626;font-size:${fontSize};font-weight:700;margin:12px 0 6px;">⚠️ $1：</div>`);
    html = html.replace(/\*\*(潜在亮点[^*]*)\*\*\s*[:：]?/g, `<div style="color:#b45309;font-size:${fontSize};font-weight:700;margin:12px 0 6px;">✨ $1：</div>`);

    // 普通加粗
    html = html.replace(/\*\*(.+?)\*\*/g, `<strong style="font-weight:700;color:${headingColor};">$1</strong>`);
    html = html.replace(/(^|[\s\p{P}])\*([^*\n]+?)\*(?=[\s\p{P}]|$)/gmu, '$1<em style="font-style:italic;">$2</em>');

    // === 6. 清理 ===
    html = html.replace(/\*{1,2}(?![^<]*>)/g, '');
    html = html.replace(/\n\n+/g, '<div style="height:10px;"></div>');
    html = html.replace(/\n/g, ' ');

    html = `<div style="font-size:${fontSize};line-height:${lineHeight};color:${textColor};">${html}</div>`;

    return html;
  };

  const getResumeHtml = () => {
    if (mode !== 'resume') return formatDiagnosisText(content);
    switch (template) {
      case 'tech': return formatResumeTech(content);
      case 'academic': return formatResumeAcademic(content);
      case 'classic':
      default: return formatResumeText(content);
    }
  };
  const finalHtml = getResumeHtml();

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
