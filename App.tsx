
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { analyzeResumeStream, rewriteResumeStream, translateResume, FileData, condenseResume, extractTextFromFile, fixTyposStream } from './services/geminiService';
import MarkdownRenderer from './components/MarkdownRenderer';
import type { ResumeTemplate } from './components/MarkdownRenderer';
import InterviewChat from './components/InterviewChat';
import { LoginModal, UserAvatar } from './components/LoginModal';
import { VIPUpgradeModal } from './components/VIPUpgradeModal';
import { DownloadPayModal } from './components/DownloadPayModal';
import ResumeLibrary from './components/ResumeLibrary';
import InterviewLibrary from './components/InterviewLibrary';
import SelectionToolbar from './components/SelectionToolbar';
import PhotoUploadPanel from './components/PhotoUploadPanel';
import ExplorePage from './components/ExplorePage';
import SavedResumePickModal, { type SavedResumePickMode } from './components/SavedResumePickModal';
import PlanLibrary from './components/PlanLibrary';
import PlanDetailPage from './components/PlanDetailPage';
import JdLibrary from './components/JdLibrary';
import SavedJdPickModal from './components/SavedJdPickModal';
import HomeMarketing from './components/HomeMarketing';
import ModelRoutingTestPage from './components/ModelRoutingTestPage';
import type { SavedPlan } from './services/planService';
import { useAuth } from './contexts/AuthContext';
import { checkUsageLimit, checkTranslationLimit } from './services/authService';
import { createSavedResume, updateSavedResume, extractResumeTitle, getSavedResumeBodyMarkdown } from './services/resumeService';
import type { SavedInterviewRecord } from './services/interviewRecordService';
import type { SavedResume, SavedJd } from './types';
import { FileText, Target, Send, Loader2, RefreshCw, ChevronRight, ChevronDown, Upload, X, Paperclip, Image as ImageIcon, File, AlertCircle, PenTool, ArrowLeft, Maximize2, Minimize2, ZoomIn, ZoomOut, CheckCircle2, AlertTriangle, AlignJustify, Languages, Globe, ArrowRight, Sparkles, Mic, Play, Users, Lock, Briefcase, Crown, Save, FolderOpen, MousePointerClick, Layout, BookOpen, ClipboardList, LayoutGrid, MessageSquare } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

type Step = 'INPUT' | 'UPLOAD' | 'ANALYSIS' | 'EDITOR' | 'ENGLISH_VERSION' | 'INTERVIEW' | 'RESUME_LIBRARY' | 'INTERVIEW_LIBRARY' | 'JD_LIBRARY' | 'EXPLORE' | 'PLAN_LIBRARY';

const App: React.FC = () => {
  const { user, profile, loading: authLoading, refreshProfile } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showVIPModal, setShowVIPModal] = useState(false);
  const [membershipModalProduct, setMembershipModalProduct] = useState<'resume_pass_10d' | 'full_monthly'>('full_monthly');
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [usageLimitError, setUsageLimitError] = useState<string | null>(null);
  
  const [step, setStep] = useState<Step>('INPUT');
  const [viewingInterviewRecord, setViewingInterviewRecord] = useState<SavedInterviewRecord | null>(null);
  const [viewingSavedCareerPlan, setViewingSavedCareerPlan] = useState<SavedPlan | null>(null);
  /** 计划库「我的笔记本」打开时按该计划 id 筛选（从计划详情「查看关联笔记」跳转） */
  const [planLibraryNotebookPlanId, setPlanLibraryNotebookPlanId] = useState<string | null>(null);
  const handlePlanLibraryNotebookFocusConsumed = useCallback(() => setPlanLibraryNotebookPlanId(null), []);
  const [uploadLibraryOpen, setUploadLibraryOpen] = useState(false);
  const [uploadJdLibraryOpen, setUploadJdLibraryOpen] = useState(false);
  const [modelTestMode, setModelTestMode] = useState(false);

  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('modeltest') === '1') {
        setModelTestMode(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // 检查登录状态，未登录则弹出登录框
  const requireLogin = (callback: () => void) => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }
    callback();
  };

  const handleUploadLibraryPick = useCallback((r: SavedResume, mode: SavedResumePickMode) => {
    if (mode === 'resume' || mode === 'both') {
      setResume(getSavedResumeBodyMarkdown(r));
      setResumeFile(null);
    }
    if (mode === 'jd' || mode === 'both') {
      setJd(r.job_description || '');
      setJdFile(null);
    }
    if (mode === 'both') {
      setAspiration(r.aspiration || '');
    }
  }, []);

  const openResumeLibrary = useCallback(() => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }
    setUploadLibraryOpen(true);
  }, [user]);

  const handleUploadJdLibraryPick = useCallback((item: SavedJd) => {
    setJd(item.content);
    setJdFile(null);
  }, []);

  const openCareerExplore = useCallback(() => {
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('explore', '1');
      window.history.replaceState({}, '', `${u.pathname}?${u.searchParams.toString()}`);
    } catch {
      window.history.replaceState({}, '', `${window.location.pathname}?explore=1`);
    }
    setStep('EXPLORE');
  }, []);

  const closeCareerExplore = useCallback(() => {
    try {
      window.history.replaceState({}, '', window.location.pathname);
    } catch (_) {}
    setStep('INPUT');
  }, []);

  const openExploreUpgrade = useCallback(() => {
    setMembershipModalProduct('full_monthly');
    setShowVIPModal(true);
  }, []);

  useEffect(() => {
    try {
      if (new URLSearchParams(window.location.search).get('explore') === '1') {
        setStep('EXPLORE');
      }
    } catch (_) {}
  }, []);

  const [jd, setJd] = useState('');
  const [resume, setResume] = useState('');
  const [aspiration, setAspiration] = useState('');
  const [jdFile, setJdFile] = useState<{name: string, data: string, mime: string} | null>(null);
  const [resumeFile, setResumeFile] = useState<{name: string, data: string, mime: string} | null>(null);
  
  const [processingState, setProcessingState] = useState<{jd: boolean, resume: boolean}>({jd: false, resume: false});
  
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingFile, setIsGeneratingFile] = useState(false);
  const [isCondensing, setIsCondensing] = useState(false);
  
  const [isTranslating, setIsTranslating] = useState(false);

  // 简历库相关
  const [currentSavedResumeId, setCurrentSavedResumeId] = useState<string | null>(null);
  const [isSavingResume, setIsSavingResume] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showSaveNameModal, setShowSaveNameModal] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState('');
  
  const [diagnosisContent, setDiagnosisContent] = useState<string>('');
  const [resumeContent, setResumeContent] = useState<string>('');

  const [editableResume, setEditableResume] = useState('');
  const [englishResume, setEnglishResume] = useState('');
  
  
  const [isRewriting, setIsRewriting] = useState(false); // 全局重构 loading
  const [isDirectEditing, setIsDirectEditing] = useState(false); // 进入编辑（纠正错别字）loading
  const [toastMessage, setToastMessage] = useState<string | null>(null); // 轻量 toast 提示
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showPhotoPanel, setShowPhotoPanel] = useState(false);
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [previewScale, setPreviewScale] = useState(0.65);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const [densityMultiplier, setDensityMultiplier] = useState<number>(1.0); 
  const [selectedTemplate, setSelectedTemplate] = useState<ResumeTemplate>('classic');
  const [editorWidthPercent, setEditorWidthPercent] = useState<number>(42);
  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [resumeHeight, setResumeHeight] = useState<number>(0);
  // 预览分页点（CSS像素级别），与 PDF 导出使用完全相同的像素扫描逻辑计算
  const [previewPageBreaks, setPreviewPageBreaks] = useState<number[]>([0]);
  
  const jdFileInputRef = useRef<HTMLInputElement>(null);
  const resumeFileInputRef = useRef<HTMLInputElement>(null);
  const inputSectionRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  /** 本次「开始分析」使用的简历正文快照；取消分析返回上传页时写回，避免仅编辑器有字时被清空 */
  const lastAnalysisResumeSnapshotRef = useRef('');
  const prevStepRef = useRef<Step | null>(null);

  const A4_WIDTH_PX = 794;
  const A4_HEIGHT_PX = 1123; 
  
  const PAGE_PADDING_TOP = 40;  // 页面上边距
  const PAGE_PADDING_BOTTOM = 40; // 页面下边距
  const PAGE_PADDING_LEFT = 40;
  const PAGE_PADDING_RIGHT = 40; 

  // 从编辑器回到「简历输入」时，以编辑器正文为准同步到上传页文本框，避免双缓冲不一致
  useEffect(() => {
    const was = prevStepRef.current;
    prevStepRef.current = step;
    if (was === null) return;
    if (step === 'UPLOAD' && was === 'EDITOR') {
      const t = editableResume.trim();
      if (t) setResume(t);
    }
  }, [step, editableResume]);

  useEffect(() => {
    if (step !== 'EDITOR' && step !== 'ENGLISH_VERSION') return;

    let cancelled = false;
    
    // 计算分页点：使用和 PDF 导出完全相同的像素扫描逻辑
    const computePageBreaks = async () => {
      const measureContainer = document.getElementById('resume-measure-container');
      if (!measureContainer) return;
      
      const height = measureContainer.scrollHeight;
      if (cancelled) return;
      setResumeHeight(height);
      
      const contentWidth = A4_WIDTH_PX - PAGE_PADDING_LEFT - PAGE_PADDING_RIGHT;
      
      // 始终使用 html2canvas 像素扫描来判断分页，与 PDF 导出完全一致
      // 不再使用 DOM scrollHeight 做快捷单页判定，因为 scrollHeight 可能不够精确
      try {
        const html2canvas = (await import('html2canvas')).default;
        const contentClone = measureContainer.cloneNode(true) as HTMLElement;
        contentClone.id = '';
        
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.top = '-20000px';
        tempContainer.style.left = '0';
        tempContainer.style.overflow = 'visible';
        
        const wrapper = document.createElement('div');
        wrapper.style.width = `${contentWidth}px`;
        wrapper.style.backgroundColor = '#ffffff';
        wrapper.style.overflow = 'visible';
        wrapper.style.paddingBottom = '60px';
        wrapper.appendChild(contentClone);
        tempContainer.appendChild(wrapper);
        document.body.appendChild(tempContainer);
        
        // 为 html2canvas 的 useCORS 添加 crossorigin 属性
        wrapper.querySelectorAll('img').forEach(img => {
          img.setAttribute('crossorigin', 'anonymous');
        });
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const wrapperHeight = wrapper.scrollHeight;
        const canvas = await html2canvas(wrapper, {
          scale: 3, // 与 PDF 导出使用完全相同的 scale，确保分页点一致
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          width: contentWidth,
          height: wrapperHeight,
          windowWidth: contentWidth,
          windowHeight: wrapperHeight,
        });
        
        document.body.removeChild(tempContainer);
        if (cancelled) return;
        
        const canvasScale = canvas.width / contentWidth;
        const maxDrawableHeight = A4_HEIGHT_PX - PAGE_PADDING_TOP - PAGE_PADDING_BOTTOM;
        const maxDrawableInCanvas = maxDrawableHeight * canvasScale;
        const toleranceInCanvas = PAGE_TOLERANCE * canvasScale;
        
        // 从 canvas 底部向上扫描找实际内容底部
        const ctx = canvas.getContext('2d');
        let actualContentHeight = canvas.height;
        if (ctx) {
          for (let y = canvas.height - 1; y >= 0; y--) {
            const imageData = ctx.getImageData(0, y, canvas.width, 1);
            const data = imageData.data;
            let hasContent = false;
            for (let x = 0; x < canvas.width * 4; x += 4) {
              if (data[x] < 250 || data[x + 1] < 250 || data[x + 2] < 250) {
                hasContent = true;
                break;
              }
            }
            if (hasContent) {
              actualContentHeight = Math.min(canvas.height, y + Math.ceil(15 * canvasScale));
              break;
            }
          }
        }
        
        // 单页判断（含容差）
        if (actualContentHeight <= maxDrawableInCanvas + toleranceInCanvas) {
          if (!cancelled) setPreviewPageBreaks([0, Math.round(actualContentHeight / canvasScale)]);
          return;
        }
        
        // 像素扫描找安全分页点（与 PDF 导出的 findSafeBreakPoint 完全相同）
        const findSafeBreak = (startY: number, maxY: number): number => {
          if (!ctx) return maxY - 30 * canvasScale;
          const width = canvas.width;
          const searchRange = Math.min(300 * canvasScale, maxY - startY);
          const safetyMargin = 10 * canvasScale;
          const effectiveMaxY = maxY - safetyMargin;
          const minWhiteGap = Math.ceil(10 * canvasScale);
          
          let consecutiveWhiteLines = 0;
          
          for (let y = Math.floor(effectiveMaxY); y > effectiveMaxY - searchRange; y--) {
            const imageData = ctx.getImageData(0, y, width, 1);
            const data = imageData.data;
            let isWhiteLine = true;
            for (let x = 0; x < width * 4; x += 4) {
              if (data[x] < 250 || data[x + 1] < 250 || data[x + 2] < 250) {
                isWhiteLine = false;
                break;
              }
            }
            if (isWhiteLine) {
              consecutiveWhiteLines++;
            } else {
              if (consecutiveWhiteLines >= minWhiteGap) {
                return y + 1;
              }
              consecutiveWhiteLines = 0;
            }
          }
          
          // 没找到足够大的空白，找最大的
          let maxGap = 0;
          let maxGapBreak = -1;
          consecutiveWhiteLines = 0;
          for (let y = Math.floor(effectiveMaxY); y > effectiveMaxY - searchRange; y--) {
            const imageData = ctx.getImageData(0, y, width, 1);
            const data = imageData.data;
            let isWhiteLine = true;
            for (let x = 0; x < width * 4; x += 4) {
              if (data[x] < 250 || data[x + 1] < 250 || data[x + 2] < 250) {
                isWhiteLine = false;
                break;
              }
            }
            if (isWhiteLine) {
              consecutiveWhiteLines++;
            } else {
              if (consecutiveWhiteLines > maxGap) {
                maxGap = consecutiveWhiteLines;
                maxGapBreak = y + 1;
              }
              consecutiveWhiteLines = 0;
            }
          }
          if (maxGap >= 5 * canvasScale && maxGapBreak > 0) return maxGapBreak;
          return Math.max(startY + 50 * canvasScale, effectiveMaxY - 50 * canvasScale);
        };
        
        // 计算分页位置
        const breaks: number[] = [0];
        let currentY = 0;
        while (currentY < actualContentHeight) {
          const remaining = actualContentHeight - currentY;
          if (remaining <= maxDrawableInCanvas + toleranceInCanvas) {
            breaks.push(actualContentHeight);
            break;
          }
          const nextPageEnd = currentY + maxDrawableInCanvas;
          const safeBreak = findSafeBreak(currentY, nextPageEnd);
          breaks.push(safeBreak);
          currentY = safeBreak;
        }
        if (breaks[breaks.length - 1] < actualContentHeight) {
          breaks.push(actualContentHeight);
        }
        
        // 转换回 CSS 像素
        const cssBreaks = breaks.map(b => Math.round(b / canvasScale));
        console.log('预览分页点(CSS px):', cssBreaks);
        if (!cancelled) setPreviewPageBreaks(cssBreaks);
        
      } catch (e) {
        console.warn('预览分页计算失败，回退到固定分页:', e);
        // 回退：简单固定分页
        const maxDrawable = A4_HEIGHT_PX - PAGE_PADDING_TOP - PAGE_PADDING_BOTTOM;
        const breaks = [0];
        let pos = 0;
        while (pos < height) {
          if (height - pos <= maxDrawable + PAGE_TOLERANCE) {
            breaks.push(height);
            break;
          }
          pos += maxDrawable;
          breaks.push(pos);
        }
        if (breaks[breaks.length - 1] < height) breaks.push(height);
        if (!cancelled) setPreviewPageBreaks(breaks);
      }
    };

    // 初次计算
    const timer = setTimeout(computePageBreaks, 300);
    
    // 监听内容变化时重新计算
    // 使用防抖避免频繁渲染 canvas
    let debounceTimer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      const measureContainer = document.getElementById('resume-measure-container');
      if (measureContainer) {
        setResumeHeight(measureContainer.scrollHeight);
      }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(computePageBreaks, 500);
    });

    const target = document.getElementById('resume-measure-container');
    if (target) {
      observer.observe(target);
    }

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, [step, editableResume, englishResume, densityMultiplier, selectedTemplate]);

  const scrollToInput = () => {
    inputSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const compressImage = (file: File): Promise<{data: string, mime: string}> => {
    return new Promise((resolve, reject) => {
      // PDF 文件处理
      if (file.type === 'application/pdf') {
         if (file.size > 3 * 1024 * 1024) { 
           reject(new Error('PDF文件过大，请上传小于3MB的文件'));
           return;
         }
         const reader = new FileReader();
         reader.readAsDataURL(file);
         reader.onload = () => {
           let base64String = (reader.result as string).split(',')[1];
           base64String = base64String.replace(/\s/g, '');
           resolve({ data: base64String, mime: 'application/pdf' });
         };
         reader.onerror = error => reject(error);
         return;
      }

      // Word 文档处理（.doc 和 .docx）
      if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
          file.type === 'application/msword') {
        if (file.size > 3 * 1024 * 1024) { 
          reject(new Error('Word文件过大，请上传小于3MB的文件'));
          return;
        }
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
          let base64String = (reader.result as string).split(',')[1];
          base64String = base64String.replace(/\s/g, '');
          resolve({ data: base64String, mime: file.type });
        };
        reader.onerror = error => reject(error);
        return;
      }

      // 图片文件处理
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          
          const MAX_SIZE = 1024;
          if (width > height) {
            if (width > MAX_SIZE) {
              height *= MAX_SIZE / width;
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width *= MAX_SIZE / height;
              height = MAX_SIZE;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
          }
          
          const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
          const base64String = dataUrl.split(',')[1];
          resolve({ data: base64String, mime: 'image/jpeg' });
        };
        img.onerror = () => reject(new Error('图片加载失败，请重试'));
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, type: 'jd' | 'resume') => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    // 支持更多文件类型
    const supportedTypes = [
      'application/pdf', 
      'image/jpeg', 
      'image/png', 
      'image/webp', 
      'image/heic',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/msword' // .doc
    ];
    
    if (!supportedTypes.includes(file.type)) {
      setError('格式错误：目前支持 PDF、Word（.doc/.docx）、JPG、PNG 或 WebP。');
      return;
    }

    setProcessingState(prev => ({ ...prev, [type]: true }));
    setError(null);

    try {
      const { data, mime } = await compressImage(file);
      // 保存文件信息
      if (type === 'jd') {
        setJdFile({ name: file.name, data, mime });
      } else {
        setResumeFile({ name: file.name, data, mime });
      }
      
      // 异步预提取文本内容，回填到文本框（防止附件过大降级后丢失内容）
      try {
        const extractedText = await extractTextFromFile({ data, mimeType: mime });
        if (extractedText && extractedText.trim()) {
          if (type === 'jd') {
            setJd(prev => prev || extractedText.trim());
          } else {
            setResume(prev => prev || extractedText.trim());
          }
        }
      } catch (extractErr) {
        console.warn('文件文本预提取失败，将依赖附件模式:', extractErr);
      }
    } catch (err: any) {
      setError(err.message || '文件处理失败。');
    } finally {
      setProcessingState(prev => ({ ...prev, [type]: false }));
    }
  };

  const handlePaste = async (e: React.ClipboardEvent, type: 'jd' | 'resume') => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          setProcessingState(prev => ({ ...prev, [type]: true }));
          try {
            setError(null);
            const { data, mime } = await compressImage(file);
            const fileName = `pasted-image-${new Date().getTime()}.jpg`;
            
            // 保存文件信息
            if (type === 'jd') {
              setJdFile({ name: fileName, data, mime });
            } else {
              setResumeFile({ name: fileName, data, mime });
            }
            
            // 异步预提取文本内容，回填到文本框
            try {
              const extractedText = await extractTextFromFile({ data, mimeType: mime });
              if (extractedText && extractedText.trim()) {
                if (type === 'jd') {
                  setJd(prev => prev || extractedText.trim());
                } else {
                  setResume(prev => prev || extractedText.trim());
                }
              }
            } catch (extractErr) {
              console.warn('粘贴图片文本预提取失败:', extractErr);
            }
          } catch (err: any) {
            setError('粘贴图片处理失败：' + err.message);
          } finally {
            setProcessingState(prev => ({ ...prev, [type]: false }));
          }
        }
      }
    }
  };

  // 诊断完成后自动触发重构（后台执行）
  const autoRewriteAfterDiagnosis = async (
    diagContent: string,
    abortController: AbortController,
    /** 与本次诊断一致的正文快照（避免已清空 editableResume 后闭包读到空串） */
    resumeForRewrite: string,
  ) => {
    if (abortController.signal.aborted) return;
    
    setIsRewriting(true);
    setResumeContent('');

    try {
      const jdFileData: FileData | undefined = jdFile ? { data: jdFile.data, mimeType: jdFile.mime } : undefined;
      const resumeFileData: FileData | undefined = resumeFile ? { data: resumeFile.data, mimeType: resumeFile.mime } : undefined;

      await rewriteResumeStream(
        jd, resumeForRewrite, aspiration, diagContent,
        {
          onResumeChunk: (chunk) => {
            if (abortController.signal.aborted) return;
            setResumeContent(prev => prev + chunk);
          },
          onResumeComplete: (content) => {
            setEditableResume(content);
            setIsRewriting(false);
          },
          onError: (errorMsg) => {
            console.error('Auto rewrite error:', errorMsg);
            setIsRewriting(false);
            // 自动重构失败不阻塞用户，静默处理
          }
        },
        jdFileData,
        resumeFileData
      );
    } catch (err: any) {
      console.error('Auto rewrite exception:', err);
      setIsRewriting(false);
    }
  };

  // Toast 提示辅助函数
  const showToast = useCallback((message: string, duration = 3000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => setToastMessage(null), duration);
  }, []);

  // 进入编辑：先纠正错别字+排版整理，完成后再进入编辑器
  const handleDirectEdit = useCallback(async () => {
    const resumeTextSnapshot = resume.trim() || editableResume.trim();
    if (!resumeTextSnapshot && !resumeFile) {
      setError('请先提供简历内容。');
      return;
    }

    // 需要登录
    if (!user) {
      setShowLoginModal(true);
      return;
    }

    setError(null);
    setIsDirectEditing(true);
    showToast('正在整理排版并纠正错别字，请稍候…', 30000); // 长时间显示，完成后会替换

    if (resumeTextSnapshot) {
      try {
        await fixTyposStream(resumeTextSnapshot, {
          onChunk: () => {
            // 流式处理中，等完整结果
          },
          onComplete: (corrected) => {
            const finalText = corrected.trim() || resumeTextSnapshot;
            setEditableResume(finalText);
            setEnglishResume('');
            setDiagnosisContent('');
            setResumeContent('');
            setIsDirectEditing(false);
            setStep('EDITOR');
            showToast('排版整理与错别字纠正完成 ✓', 2500);
          },
          onError: (errMsg) => {
            console.error('Typo fix error:', errMsg);
            // 纠错失败也进编辑器，用原文
            setEditableResume(resumeTextSnapshot);
            setEnglishResume('');
            setDiagnosisContent('');
            setResumeContent('');
            setIsDirectEditing(false);
            setStep('EDITOR');
            showToast('排版处理遇到问题，已用原文进入编辑', 3000);
          },
        });
      } catch {
        // 异常兜底：用原文进编辑器
        setEditableResume(resumeTextSnapshot);
        setEnglishResume('');
        setDiagnosisContent('');
        setResumeContent('');
        setIsDirectEditing(false);
        setStep('EDITOR');
        showToast('排版处理遇到问题，已用原文进入编辑', 3000);
      }
    }
  }, [resume, editableResume, resumeFile, user, showToast]);

  const handleAnalysis = useCallback(async () => {
    // 与「简历输入」页文本框、编辑器双缓冲对齐：从简历库进编辑器时可能只有 editableResume 有字
    const resumeTextSnapshot = resume.trim() || editableResume.trim();
    lastAnalysisResumeSnapshotRef.current = resumeTextSnapshot;
    if (resumeTextSnapshot) {
      setResume(resumeTextSnapshot);
    }

    if (!jd.trim() && !jdFile && !resumeTextSnapshot && !resumeFile) {
      setError('请提供 JD 或 简历内容。');
      return;
    }

    // 检查登录状态
    if (!user) {
      setShowLoginModal(true);
      return;
    }

    // 取消之前的请求（如果有）
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // 创建新的 AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsAnalyzing(true);
    setError(null);
    setDiagnosisContent('');
    setResumeContent('');
    // 新任务开始：清空上一轮的重构/英文版结果，避免显示成「上一次的简历 B」而非本次「简历 A」的结果
    setEditableResume('');
    setEnglishResume('');
    setStep('ANALYSIS'); // 立即切换到分析页面，显示流式内容

    // 配额预检查与 API 调用并行启动（服务端有权威校验兜底，前端预检查仅用于提前提示）
    const limitCheckPromise = checkUsageLimit(user.id, 'diagnosis', user.email || undefined);

    try {
      const jdFileData: FileData | undefined = jdFile ? { data: jdFile.data, mimeType: jdFile.mime } : undefined;
      const resumeFileData: FileData | undefined = resumeFile ? { data: resumeFile.data, mimeType: resumeFile.mime } : undefined;
      
      // 在 API 请求发出前快速检查配额结果（不阻塞太久）
      const limitCheck = await Promise.race([
        limitCheckPromise,
        new Promise<null>(resolve => setTimeout(() => resolve(null), 800)), // 最多等 800ms
      ]);
      
      if (limitCheck && !limitCheck.allowed) {
        setIsAnalyzing(false);
        setStep('INPUT');
        if (limitCheck.isTrialLimit) {
          setUsageLimitError(`简历诊断免费体验次数已用完（共${limitCheck.limit}次）。升级 VIP 享每日50次使用！`);
        } else {
          setUsageLimitError(`今日使用次数已达上限（${limitCheck.limit}次/天）。`);
        }
        return;
      }

      // 使用流式诊断（仅诊断，不自动重写，节省 token）
      await analyzeResumeStream(
        jd, 
        resumeTextSnapshot, 
        aspiration,
        {
          onDiagnosisChunk: (chunk) => {
            if (abortController.signal.aborted) return;
            setDiagnosisContent(prev => prev + chunk);
          },
          onDiagnosisComplete: (content) => {
            // 用量由服务端 proxy 在流式成功结束后写入 usage_logs，此处不再重复记账
            // 诊断完成后自动触发重构（后台执行，不阻塞用户阅读诊断报告）
            if (!abortController.signal.aborted) {
              autoRewriteAfterDiagnosis(content, abortController, resumeTextSnapshot);
            }
          },
          onError: (errorMsg) => {
            console.error('Stream error:', errorMsg);
          }
        },
        jdFileData, 
        resumeFileData
      );
      
    } catch (err: any) {
      // 如果是取消导致的错误，不显示错误信息
      if (abortController.signal.aborted) {
        return;
      }
      
      const msg = err.message || '';
      if (msg === 'PAYLOAD_TOO_LARGE' || msg.includes('PAYLOAD_TOO_LARGE') || msg.includes('413')) {
        setError('上传文件过大，请压缩文件后重试（建议 PDF 小于 3MB），或直接粘贴文本内容。');
      } else if (msg === 'ENTITY_NOT_FOUND') {
        setError('系统配置错误：API Key 无效或未启用计费，请检查服务器环境变量设置。');
      } else if (msg === 'SAFETY_BLOCKED') {
        setError('安全策略限制：内容被系统判定为敏感信息而拦截，请检查输入内容。');
      } else if (msg === 'QUOTA_EXCEEDED' || msg.includes('AI_RATE_LIMIT_EXCEEDED') || msg.includes('RATE_LIMIT_EXCEEDED')) {
        setError('AI 服务当前请求较多，请 1-2 分钟后再试，不要反复点击。');
      } else if (msg === 'EMPTY_RESPONSE') {
        setError('空响应：模型未能生成结果，请重试。');
      } else if (msg.includes('400')) {
        setError('无法处理上传的文件。提示：若使用PDF，请尝试转为图片上传，或者使用更小的文件。');
      } else if (msg.includes('DIAGNOSIS_TRIAL_LIMIT_EXCEEDED')) {
        setError(null);
        setStep('INPUT');
        setUsageLimitError('简历诊断免费体验次数已用完（共3次）。升级 VIP 享无限次使用！');
      } else if (msg.includes('INTERVIEW_TRIAL_LIMIT_EXCEEDED')) {
        setError(null);
        setStep('INPUT');
        setUsageLimitError('模拟面试免费体验次数已用完（共1次）。升级 VIP 享无限次面试！');
      } else if (msg.includes('TRANSLATION_LIMIT_EXCEEDED')) {
        setError(null);
        setStep('INPUT');
        setUsageLimitError('英文翻译免费体验次数已用完（共3次）。升级 VIP 享无限次翻译！');
      } else if (msg.includes('MONTHLY_DIAGNOSIS_LIMIT_EXCEEDED') || msg.includes('MONTHLY_INTERVIEW_LIMIT_EXCEEDED')) {
        setError(null);
        setStep('INPUT');
        setUsageLimitError('本月使用次数已达上限，请下月再试。');
      } else if (msg.includes('DAILY_LIMIT_EXCEEDED')) {
        setError(null);
        setStep('INPUT');
        setUsageLimitError('今日使用次数已达上限，请明天再试。');
      } else {
        let displayMsg = msg;
        if (displayMsg.includes('{"error"')) {
           try {
             const matches = displayMsg.match(/"message":\s*"(.*?)"/);
             if (matches && matches[1]) displayMsg = matches[1];
           } catch (e) {}
        }
        setError(`分析失败：${displayMsg.length > 100 ? displayMsg.substring(0, 100) + '...' : displayMsg}`);
      }
    } finally {
      // 只有当前请求没有被取消时才设置状态
      if (!abortController.signal.aborted) {
        setIsAnalyzing(false);
      }
    }
  }, [jd, resume, editableResume, aspiration, jdFile, resumeFile, user]);

  const generateTranslation = async () => {
    if (!editableResume) return;
    
    // 检查登录状态
    if (!user) {
      setShowLoginModal(true);
      return;
    }

    // 检查翻译次数限制
    const translationCheck = await checkTranslationLimit(user.id, user.email || undefined);
    if (!translationCheck.allowed) {
      setUsageLimitError(`英文翻译体验次数已用完（共${translationCheck.limit}次）。升级 VIP 享无限翻译！`);
      return;
    }

    setIsTranslating(true);
    try {
      const result = await translateResume(editableResume);
      setEnglishResume(result);
      setStep('ENGLISH_VERSION');
      // 翻译次数由服务端 proxy 在请求成功后记账
    } catch (err) {
      alert("翻译服务繁忙，请稍后再试。");
    } finally {
      setIsTranslating(false);
    }
  };

  // === 可拖拽分栏 ===
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const pct = Math.min(Math.max((x / rect.width) * 100, 25), 75);
      setEditorWidthPercent(pct);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, []);

  const resetAll = () => {
    // 取消正在进行的分析请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAnalyzing(false);
    setIsDirectEditing(false);
    setToastMessage(null);
    setJd('');
    setResume('');
    setAspiration('');
    setJdFile(null);
    setResumeFile(null);
    setDiagnosisContent('');
    setResumeContent('');
    setEditableResume('');
    setEnglishResume('');
    setError(null);
    setStep('INPUT');
    setPreviewScale(0.65);
    setIsFullscreen(false);
    setDensityMultiplier(1.0);
    setSelectedTemplate('classic');
    setEditorWidthPercent(42);
    setCurrentSavedResumeId(null);
    setIsSavingResume(false);
    setSaveSuccess(false);
    setIsRewriting(false);
    setShowPhotoPanel(false);
    setIsCondensing(false);
    setIsTranslating(false);
    setIsGeneratingFile(false);
    setUsageLimitError(null);
    setResumeHeight(0);
    setPreviewPageBreaks([0]);
    setProcessingState({jd: false, resume: false});
    setViewingInterviewRecord(null);
    setViewingSavedCareerPlan(null);
    setPlanLibraryNotebookPlanId(null);
    try {
      window.history.replaceState({}, '', window.location.pathname);
    } catch (_) {}
  };

  // 切换账号或登出时清空面试/诊断相关状态与本地缓存，避免看到上一账号数据
  const prevUserIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const currentId = user?.id;
    const prevId = prevUserIdRef.current;
    prevUserIdRef.current = currentId;
    if (prevId === currentId) return;
    if (prevId !== undefined) {
      setJd('');
      setResume('');
      setJdFile(null);
      setResumeFile(null);
      setEditableResume('');
      setViewingInterviewRecord(null);
      try {
        localStorage.removeItem('offer_ing_interview_history');
      } catch (_) {}
    }
  }, [user?.id]);

  // 用于取消分析并返回上传页面（清空本次未完成的重构结果，避免与下次任务混淆）
  const cancelAnalysisAndGoBack = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAnalyzing(false);
    setDiagnosisContent('');
    setResumeContent('');
    const snap = lastAnalysisResumeSnapshotRef.current;
    setResume(snap);
    setEditableResume(snap);
    setEnglishResume('');
    setStep('UPLOAD');
  };

  const handleProceedToEditor = () => {
    // 仅当本次重构已完成且有结果时才跳转，避免极短时间窗口内点到旧结果
    if (isRewriting) return;
    if (!editableResume) return;
    setStep('EDITOR');
  };


  // 划取重写的替换处理
  const handleSelectionReplace = (oldText: string, newText: string) => {
    const current = step === 'ENGLISH_VERSION' ? englishResume : editableResume;
    const updated = current.replace(oldText, newText);
    if (step === 'ENGLISH_VERSION') {
      setEnglishResume(updated);
    } else {
      setEditableResume(updated);
    }
  };

  // 从 Markdown 中提取照片 URL
  const getPhotoUrlFromMarkdown = (md: string): string => {
    const match = md.match(/!\[(?:photo|avatar|头像|照片)?\]\s*\(\s*([^)\s][^)]*?)\s*\)/);
    if (match) {
      return match[1].replace(/\s+/g, '');
    }
    return '';
  };

  // 在 Markdown 头部插入或替换照片 URL
  const handlePhotoChange = (url: string) => {
    const setter = step === 'ENGLISH_VERSION' ? setEnglishResume : setEditableResume;
    const current = step === 'ENGLISH_VERSION' ? englishResume : editableResume;

    // 移除已有的照片行（支持跨行URL和多种位置）
    let updated = current.replace(/\n?!\[(?:photo|avatar|头像|照片)?\]\s*\(\s*[\s\S]*?\s*\)\s*/g, '\n');
    // 清理多余空行
    updated = updated.replace(/\n{3,}/g, '\n\n');

    if (url) {
      // 在 # name 后面所有连续 > 行之后插入图片（空行分隔）
      updated = updated.replace(/^(# .*(?:\n> .*)+)/m, `$1\n\n![photo](${url})`);
    }

    setter(updated);
    setShowPhotoPanel(false);
  };

  const getResumeFileName = (extension: string) => {
    const isEnglish = step === 'ENGLISH_VERSION';
    const content = isEnglish ? englishResume : editableResume;
    const nameMatch = content.match(/^# (.*)/);
    const baseName = nameMatch && nameMatch[1] ? nameMatch[1].trim() : 'resume';
    const suffix = isEnglish ? '_English' : '_优化版';
    return `${baseName}${suffix}.${extension}`;
  };

  const waitForImages = async (container: HTMLElement) => {
    const images = Array.from(container.getElementsByTagName('img'));
    if (images.length === 0) return;

    const promises = images.map(img => {
      if (img.complete && img.naturalHeight > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve(); 
      });
    });

    await Promise.all(promises);
  };

  // 每页可用内容高度（A4高度 - 上下padding）
  const CONTENT_HEIGHT_PER_PAGE = A4_HEIGHT_PX - PAGE_PADDING_TOP - PAGE_PADDING_BOTTOM; // 1043px
  // 与 PDF 导出一致的容差：允许内容侵入底部 padding 最多 50px（更宽松，避免微小溢出导致分页）
  const PAGE_TOLERANCE = 50;

  const handleExportImage = async () => {
    const element = document.getElementById('resume-measure-container');
    if (!element) return;
    
    setIsGeneratingFile(true);

    try {
      // 获取完整的简历内容容器（包括父容器的padding区域）
      const parentDiv = element.parentElement;
      if (!parentDiv) return;
      
      const canvas = await html2canvas(parentDiv, {
        scale: 2.5,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: A4_WIDTH_PX,
        windowWidth: 1024
      });

      // Safari 下 data URL 过大可能失败，改用 Blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = getResumeFileName('png');
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      console.error('Image export failed', e);
      alert('图片导出失败，请重试');
    } finally {
      setIsGeneratingFile(false);
    }
  };

  // 实际执行 PDF 导出的函数（智能分页，避免文字被截断）
  const doExportPDF = async () => {
    const element = document.getElementById('resume-measure-container');
    if (!element) return;

    setIsGeneratingFile(true);

    try {
      const contentWidth = A4_WIDTH_PX - PAGE_PADDING_LEFT - PAGE_PADDING_RIGHT; // 714px
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = 210;
      
      // 创建临时容器
      const tempContainer = document.createElement('div');
      tempContainer.style.position = 'absolute';
      tempContainer.style.top = '-10000px';
      tempContainer.style.left = '0';
      tempContainer.style.overflow = 'visible'; // 确保不裁剪
      document.body.appendChild(tempContainer);
      
      // 克隆内容到临时容器
      const contentContainer = document.createElement('div');
      contentContainer.style.width = `${contentWidth}px`;
      contentContainer.style.backgroundColor = '#ffffff';
      contentContainer.style.overflow = 'visible'; // 确保不裁剪
      
      const contentClone = element.cloneNode(true) as HTMLElement;
      contentClone.id = '';
      contentClone.style.width = `${contentWidth}px`;
      contentClone.style.overflow = 'visible'; // 确保不裁剪
      
      // 关键：在内容底部添加额外的空白区域（paddingBottom）
      // 这确保 html2canvas 能完整捕获最后一行文字（包括文字的下降部分 descender）
      // 没有这个 padding，html2canvas 可能会恰好在文字基线处截断
      contentContainer.style.paddingBottom = '60px';
      
      contentContainer.appendChild(contentClone);
      tempContainer.appendChild(contentContainer);
      
      // 为 html2canvas 的 useCORS 添加 crossorigin 属性
      contentContainer.querySelectorAll('img').forEach(img => {
        img.setAttribute('crossorigin', 'anonymous');
      });
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const totalContentHeight = contentContainer.scrollHeight;
      console.log('PDF导出 - 内容高度:', totalContentHeight);

      // Safari/iOS 下 canvas 尺寸限制更严，用 scale 2 避免超出导致导出失败
      const isSafari = typeof navigator !== 'undefined' && /apple/i.test(navigator.vendor || '') && !/crios|fxios/i.test(navigator.userAgent || '');
      const pdfScale = isSafari ? 2 : 3;

      // 渲染完整内容为canvas - 明确指定高度以确保完整渲染
      const contentCanvas = await html2canvas(contentContainer, {
        scale: pdfScale,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: contentWidth,
        height: totalContentHeight, // 明确指定高度
        windowWidth: contentWidth,
        windowHeight: totalContentHeight // 明确指定窗口高度
      });
      
      const canvasScale = contentCanvas.width / contentWidth;
      const paddingTopInCanvas = PAGE_PADDING_TOP * canvasScale;
      const paddingBottomInCanvas = PAGE_PADDING_BOTTOM * canvasScale;
      const paddingLeftInCanvas = PAGE_PADDING_LEFT * canvasScale;
      const pageWidthInCanvas = A4_WIDTH_PX * canvasScale;
      const pageHeightInCanvas = A4_HEIGHT_PX * canvasScale;
      // 每页实际可用于绘制内容的最大高度（考虑上下边距）
      const maxDrawableHeight = pageHeightInCanvas - paddingTopInCanvas - paddingBottomInCanvas;
      // 从 canvas 底部向上扫描，找到实际内容的最后一个非白色像素行
      // 这比用固定的 extraBottomPadding 更精确，避免裁掉文字的 descender 部分
      const findActualContentBottom = (canvas: HTMLCanvasElement): number => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return canvas.height;
        const width = canvas.width;
        // 从底部向上扫描
        for (let y = canvas.height - 1; y >= 0; y--) {
          const imageData = ctx.getImageData(0, y, width, 1);
          const data = imageData.data;
          for (let x = 0; x < width * 4; x += 4) {
            if (data[x] < 250 || data[x + 1] < 250 || data[x + 2] < 250) {
              // 找到非白色像素，再加一些安全边距（15px 原始像素）确保 descender 完整
              return Math.min(canvas.height, y + Math.ceil(15 * canvasScale));
            }
          }
        }
        return canvas.height;
      };
      const actualContentHeight = findActualContentBottom(contentCanvas);
      
      console.log('Canvas scale:', canvasScale, '内容Canvas尺寸:', contentCanvas.width, 'x', contentCanvas.height);
      console.log('实际内容高度:', Math.round(actualContentHeight / canvasScale), 'px, 可绘制内容高度:', maxDrawableHeight / canvasScale, 'px');
      
      // 在canvas级别检测空白行，找到安全的分页点
      // 关键：返回的分页点应该是"空白区域的顶部"，即上一行内容的正下方
      // 这样第一页包含完整的内容，第二页从空白区域之后的新内容开始
      const findSafeBreakPoint = (canvas: HTMLCanvasElement, startY: number, maxY: number): number => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return maxY - 30 * canvasScale;
        
        const width = canvas.width;
        const searchRange = Math.min(300 * canvasScale, maxY - startY);
        
        // 安全边距
        const safetyMargin = 10 * canvasScale;
        const effectiveMaxY = maxY - safetyMargin;
        
        // 需要至少 10px 原始像素的连续空白才认为是行间空白
        const minWhiteGap = Math.ceil(10 * canvasScale);
        
        let consecutiveWhiteLines = 0;
        let gapBottomY = -1; // 空白区域的底部（最下方的白色行）
        
        // 从 effectiveMaxY 向上搜索
        for (let y = Math.floor(effectiveMaxY); y > effectiveMaxY - searchRange; y--) {
          const imageData = ctx.getImageData(0, y, width, 1);
          const data = imageData.data;
          
          let isWhiteLine = true;
          for (let x = 0; x < width * 4; x += 4) {
            const r = data[x];
            const g = data[x + 1];
            const b = data[x + 2];
            if (r < 250 || g < 250 || b < 250) {
              isWhiteLine = false;
              break;
            }
          }
          
          if (isWhiteLine) {
            consecutiveWhiteLines++;
            if (gapBottomY < 0) {
              gapBottomY = y; // 记录空白区域的底部
            }
          } else {
            // 遇到内容行
            if (consecutiveWhiteLines >= minWhiteGap) {
              // 找到了足够大的空白区域
              // 分页点 = 当前内容行的下方 = y + 1（刚好在内容下面）
              // 这样第一页包含到这行内容，第二页从空白区域之后开始
              const breakPoint = y + 1;
              console.log(`找到安全分页点: ${Math.round(breakPoint / canvasScale)}px，空白大小: ${Math.round(consecutiveWhiteLines / canvasScale)}px`);
              return breakPoint;
            }
            // 重置
            consecutiveWhiteLines = 0;
            gapBottomY = -1;
          }
        }
        
        // 如果没找到足够大的空白，尝试找最大的空白
        let maxGap = 0;
        let maxGapBreakPoint = -1;
        consecutiveWhiteLines = 0;
        
        for (let y = Math.floor(effectiveMaxY); y > effectiveMaxY - searchRange; y--) {
          const imageData = ctx.getImageData(0, y, width, 1);
          const data = imageData.data;
          
          let isWhiteLine = true;
          for (let x = 0; x < width * 4; x += 4) {
            if (data[x] < 250 || data[x + 1] < 250 || data[x + 2] < 250) {
              isWhiteLine = false;
              break;
            }
          }
          
          if (isWhiteLine) {
            consecutiveWhiteLines++;
          } else {
            if (consecutiveWhiteLines > maxGap) {
              maxGap = consecutiveWhiteLines;
              maxGapBreakPoint = y + 1; // 内容行的下方
            }
            consecutiveWhiteLines = 0;
          }
        }
        
        if (maxGap >= 5 * canvasScale && maxGapBreakPoint > 0) {
          console.warn(`使用最大空白: ${Math.round(maxGapBreakPoint / canvasScale)}px，空白: ${Math.round(maxGap / canvasScale)}px`);
          return maxGapBreakPoint;
        }
        
        // 回退
        const fallbackY = Math.max(startY + 50 * canvasScale, effectiveMaxY - 50 * canvasScale);
        console.warn(`未找到分页点，回退: ${Math.round(fallbackY / canvasScale)}px`);
        return fallbackY;
      };
      
      // 计算分页位置（基于canvas像素）- 使用实际可绘制高度
      const pageBreaksInCanvas: number[] = [0];
      let currentY = 0;
      
      console.log(`实际内容高度: ${Math.round(actualContentHeight / canvasScale)}px, 可绘制高度: ${Math.round(maxDrawableHeight / canvasScale)}px`);
      
      // 使用 actualContentHeight（减去额外padding后的真实内容高度）来判断分页
      // 容差：允许内容稍微超出可绘制高度，占用部分底部边距（最多占用50px，更宽松避免微小溢出分页）
      const toleranceInCanvas = 50 * canvasScale;
      if (actualContentHeight <= maxDrawableHeight + toleranceInCanvas) {
        // 内容可以放在一页内，使用实际内容高度作为绘制范围
        pageBreaksInCanvas.push(actualContentHeight);
        console.log(`内容在一页内，实际内容高度: ${Math.round(actualContentHeight / canvasScale)}px, 无需分页`);
      } else {
        // 需要多页
        while (currentY < actualContentHeight) {
          let nextPageEnd = currentY + maxDrawableHeight;
          
          // 计算剩余内容高度
          const remainingHeight = actualContentHeight - currentY;
          
          // 如果剩余内容可以放在一页内（带容差），直接结束
          if (remainingHeight <= maxDrawableHeight + toleranceInCanvas) {
            pageBreaksInCanvas.push(actualContentHeight);
            console.log(`最后一页，剩余内容: ${Math.round(remainingHeight / canvasScale)}px，可容纳`);
            break;
          }
          
          // 剩余内容超过一页，需要找分页点
          const safeBreakPoint = findSafeBreakPoint(contentCanvas, currentY, nextPageEnd);
          pageBreaksInCanvas.push(safeBreakPoint);
          currentY = safeBreakPoint;
        }
      }
      
      const pageCount = pageBreaksInCanvas.length - 1;
      console.log('智能分页结果(canvas像素):', pageBreaksInCanvas.map(p => Math.round(p / canvasScale)), '总页数:', pageCount);
      
      // 收集所有 <a href> 的位置，用于在 PDF 中叠加可点击链接
      const containerRect = contentContainer.getBoundingClientRect();
      const linkRects: { href: string; left: number; top: number; width: number; height: number }[] = [];
      contentClone.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
        const href = a.getAttribute('href') || '';
        if (!href || !/^https?:\/\//i.test(href)) return;
        const r = a.getBoundingClientRect();
        linkRects.push({
          href,
          left: r.left - containerRect.left,
          top: r.top - containerRect.top,
          width: r.width,
          height: r.height,
        });
      });
      
      // 为每一页创建带边距的完整A4页面
      // PDF 页面固定为标准 A4 尺寸（210x297mm），canvas 也必须保持标准 A4 比例
      // 当内容使用容差侵入底部边距时，通过减少底部 padding 来容纳，而非增大 canvas
      const pdfHeight = 297; // A4 标准高度 mm
      
      for (let i = 0; i < pageCount; i++) {
        const srcY = pageBreaksInCanvas[i];
        const srcHeight = pageBreaksInCanvas[i + 1] - pageBreaksInCanvas[i];
        
        // 创建标准 A4 尺寸的 canvas（固定大小，不超出）
        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = pageWidthInCanvas;
        pageCanvas.height = pageHeightInCanvas; // 始终使用标准 A4 高度
        const ctx = pageCanvas.getContext('2d');
        
        if (ctx) {
          // 填充白色背景
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
          
          if (srcHeight > 0) {
            // 计算实际可用的绘制空间：如果内容超出标准可绘制区域，
            // 则压缩底部 padding（最少保留 10px 底部边距）
            const minBottomPadding = 10 * canvasScale;
            const availableForContent = pageHeightInCanvas - paddingTopInCanvas - minBottomPadding;
            
            if (srcHeight > availableForContent) {
              // 内容太高，需要微缩以适应页面
              // 计算缩放比：让内容完整放入可用空间
              const fitScale = availableForContent / srcHeight;
              const scaledWidth = contentCanvas.width * fitScale;
              const scaledHeight = srcHeight * fitScale;
              ctx.drawImage(
                contentCanvas,
                0, srcY, contentCanvas.width, srcHeight,
                paddingLeftInCanvas, paddingTopInCanvas, scaledWidth, scaledHeight
              );
              console.log(`第 ${i + 1} 页内容微缩: ${(fitScale * 100).toFixed(1)}%`);
            } else {
              // 内容可以完整放入，正常绘制
              ctx.drawImage(
                contentCanvas,
                0, srcY, contentCanvas.width, srcHeight,
                paddingLeftInCanvas, paddingTopInCanvas, contentCanvas.width, srcHeight
              );
            }
          }
        }
        
        const imgData = pageCanvas.toDataURL('image/jpeg', 0.95);
        
        if (i > 0) {
          pdf.addPage();
        }
        
        // 固定使用标准 A4 尺寸，确保不超出 PDF 页面边界
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
        
        // 叠加本页的可点击链接
        const minBottomPadding = 10 * canvasScale;
        const availableForContent = pageHeightInCanvas - paddingTopInCanvas - minBottomPadding;
        const fitScale = srcHeight > availableForContent ? availableForContent / srcHeight : 1;
        linkRects.forEach((lr) => {
          const lcLeft = lr.left * canvasScale;
          const lcTop = lr.top * canvasScale;
          const lcW = lr.width * canvasScale;
          const lcH = lr.height * canvasScale;
          const overlapStart = Math.max(lcTop, srcY);
          const overlapEnd = Math.min(lcTop + lcH, srcY + srcHeight);
          if (overlapStart >= overlapEnd) return;
          const relTop = overlapStart - srcY;
          const relH = overlapEnd - overlapStart;
          const pageX = paddingLeftInCanvas + lcLeft * fitScale;
          const pageY = paddingTopInCanvas + relTop * fitScale;
          const pageW = lcW * fitScale;
          const pageH = relH * fitScale;
          const pdfX = (pageX / pageWidthInCanvas) * pdfWidth;
          const pdfY = (pageY / pageHeightInCanvas) * pdfHeight;
          const pdfW = (pageW / pageWidthInCanvas) * pdfWidth;
          const pdfH = (pageH / pageHeightInCanvas) * pdfHeight;
          try {
            pdf.link(pdfX, pdfY, pdfW, pdfH, { url: lr.href });
          } catch (_) {
            // 某些 PDF 阅读器对链接数量或格式有限制，忽略单条失败
          }
        });
        
        console.log(`第 ${i + 1} 页渲染完成, srcHeight=${Math.round(srcHeight/canvasScale)}px, pdfSize=${pdfWidth}x${pdfHeight}mm`);
      }
      
      // 清理
      document.body.removeChild(tempContainer);
      
      console.log('PDF 生成完成，共', pageCount, '页');

      // Safari 下 pdf.save() 会触发页面刷新或失败，改用 blob + link.download（对全浏览器更稳）
      const filename = getResumeFileName('pdf');
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      console.error('PDF export failed', e);
      alert('PDF 生成失败，请重试');
    } finally {
      setIsGeneratingFile(false);
    }
  };

  // 处理 PDF 导出（仅需登录，导出不产生服务端成本，免费）
  const handleExportPDF = async () => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }
    await doExportPDF();
  };

  // 智能精简简历（当超出一页时）
  const handleCondenseResume = async () => {
    if (isCondensing) return;
    
    const currentResume = step === 'ENGLISH_VERSION' ? englishResume : editableResume;
    if (!currentResume) return;

    setIsCondensing(true);
    setError(null);

    try {
      const condensedResume = await condenseResume(
        currentResume,
        capacity.percentage,
        95 // 目标精简到 95%
      );

      if (step === 'ENGLISH_VERSION') {
        setEnglishResume(condensedResume);
      } else {
        setEditableResume(condensedResume);
      }
    } catch (err: any) {
      const msg = err?.message || '精简失败，请重试';
      const isBusyError = /(AI_RATE_LIMIT_EXCEEDED|RATE_LIMIT_EXCEEDED|429)/i.test(msg);
      const isLimitError = /(USAGE_LIMIT_EXCEEDED|DIAGNOSIS_TRIAL_LIMIT_EXCEEDED|TRIAL_LIMIT_EXCEEDED|使用次数|上限|403)/i.test(msg);
      if (isBusyError) {
        setError('AI 服务当前请求较多，请 1-2 分钟后再试，不要反复点击。');
      } else if (isLimitError) {
        setUsageLimitError('精调/精简功能使用次数已达上限。升级 VIP 享更多使用次数！');
      } else {
        setError(msg);
      }
    } finally {
      setIsCondensing(false);
    }
  };

  // 保存/更新简历到简历库（所有登录用户均可使用）
  const handleSaveResume = async () => {
    if (!user || !editableResume) return;

    // 首次保存：弹出命名弹窗
    if (!currentSavedResumeId) {
      const defaultTitle = extractResumeTitle(editableResume, jd);
      setSaveNameInput(defaultTitle);
      setShowSaveNameModal(true);
      return;
    }

    // 更新已有简历
    setIsSavingResume(true);
    setSaveSuccess(false);
    try {
      const { success, error: err } = await updateSavedResume(currentSavedResumeId, {
        resumeMarkdown: editableResume,
        englishResumeMarkdown: englishResume || undefined,
        jobDescription: jd || undefined,
        aspiration: aspiration || undefined,
        densityMultiplier,
        template: selectedTemplate,
      });
      if (!success) throw new Error(err);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      console.error('保存简历失败:', err);
      alert(`保存失败：${err.message || '未知错误，请重试'}`);
    } finally {
      setIsSavingResume(false);
    }
  };

  // 确认命名并保存新简历
  const handleConfirmSaveName = async () => {
    if (!user || !editableResume) return;
    const title = saveNameInput.trim() || extractResumeTitle(editableResume, jd);

    setShowSaveNameModal(false);
    setIsSavingResume(true);
    setSaveSuccess(false);

    try {
      const { data, error: err } = await createSavedResume({
        userId: user.id,
        title,
        resumeMarkdown: editableResume,
        englishResumeMarkdown: englishResume || undefined,
        jobDescription: jd || undefined,
        aspiration: aspiration || undefined,
        densityMultiplier,
        template: selectedTemplate,
        source: 'reconstruction',
      });
      if (err || !data) throw new Error(err || '保存失败');
      setCurrentSavedResumeId(data.id);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      console.error('保存简历失败:', err);
      alert(`保存失败：${err.message || '未知错误，请重试'}`);
    } finally {
      setIsSavingResume(false);
    }
  };

  // 从简历库打开简历进入编辑器
  const handleOpenSavedResume = (resume: SavedResume) => {
    setCurrentSavedResumeId(resume.id);
    const body = getSavedResumeBodyMarkdown(resume);
    setEditableResume(body);
    // 与「简历输入」页 `resume` 同步，避免从编辑器回到简历输入时正文被清空
    setResume(body);
    setEnglishResume(resume.english_resume_markdown || '');
    setJd(resume.job_description || '');
    setAspiration(resume.aspiration || '');
    setDensityMultiplier(resume.density_multiplier || 1.0);
    setSelectedTemplate((resume.template as ResumeTemplate) || 'classic');
    // 清理旧状态
    setDiagnosisContent('');
    setResumeContent('');
    setError(null);
    setShowPhotoPanel(false);
    setIsFullscreen(false);
    setPreviewScale(0.65);
    setStep('EDITOR');

    // 异步校验照片 URL，如果已失效则清理
    const photoUrl = getPhotoUrlFromMarkdown(body);
    if (photoUrl) {
      const img = new Image();
      img.onload = () => {}; // 照片可用，无需处理
      img.onerror = () => {
        // 照片 URL 已失效，从 markdown 中移除
        setEditableResume(prev => {
          let updated = prev.replace(/\n?!\[(?:photo|avatar|头像|照片)?\]\s*\(\s*[\s\S]*?\s*\)\s*/g, '\n');
          return updated.replace(/\n{3,}/g, '\n\n');
        });
      };
      img.src = photoUrl;
    }
  };

  const zoomIn = () => setPreviewScale(prev => Math.min(prev + 0.1, 1.5));
  const zoomOut = () => setPreviewScale(prev => Math.max(prev - 0.1, 0.4));

  const FileChip = ({ name, mime, onRemove, isLoading }: { name: string, mime: string, onRemove: () => void, isLoading?: boolean }) => {
    const getFileIcon = () => {
      if (mime.includes('image')) return <ImageIcon size={13} className="text-zinc-400" />;
      if (mime.includes('pdf')) return <File size={13} className="text-zinc-400" />;
      if (mime.includes('word') || mime.includes('document')) return <FileText size={13} className="text-zinc-400" />;
      return <Paperclip size={13} className="text-zinc-400" />;
    };

    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-md text-xs text-zinc-600">
        {isLoading ? (
          <Loader2 size={13} className="animate-spin text-zinc-400" />
        ) : (
          getFileIcon()
        )}
        <span className="truncate max-w-[150px]">{isLoading ? '正在识别文件内容...' : name}</span>
        {!isLoading && (
           <>
              <CheckCircle2 size={13} className="text-green-500" />
              <button onClick={onRemove} className="hover:text-zinc-900 transition-colors ml-0.5">
                 <X size={13} />
              </button>
           </>
        )}
      </div>
    );
  };

  const getCapacityStatus = () => {
    // 使用预览分页点计算页数（与预览和PDF一致）
    const pageCount = Math.max(1, previewPageBreaks.length - 1);
    
    if (pageCount === 1) {
      // 单页：用含容差的基准，确保没分页时百分比一定 ≤ 100%
      const withTolerance = CONTENT_HEIGHT_PER_PAGE + PAGE_TOLERANCE;
      const percentage = Math.min(100, Math.round((resumeHeight / withTolerance) * 100));
      return { status: 'optimal', label: '1 页', percentage };
    } else {
      // 多页：用不含容差的基准，确保分页时百分比一定 > 100%
      // 用户看到 "102% · 2 页" 就知道精简 2% 即可回到 1 页
      const percentage = Math.max(101, Math.round((resumeHeight / CONTENT_HEIGHT_PER_PAGE) * 100));
      return { 
        status: 'danger', 
        label: `${pageCount} 页`, 
        percentage,
        pageCount 
      };
    }
  };
  const capacity = getCapacityStatus();

  const goHome = () => {
    try {
      window.history.replaceState({}, '', window.location.pathname);
    } catch (_) {}
    setStep('INPUT');
  };

  const openPlanLibrary = () => {
    setViewingSavedCareerPlan(null);
    setPlanLibraryNotebookPlanId(null);
    setStep('PLAN_LIBRARY');
  };

  const resumeOptimizeActive =
    step === 'UPLOAD' || step === 'ANALYSIS' || step === 'EDITOR' || step === 'ENGLISH_VERSION';
  const contentMgmtActive =
    step === 'JD_LIBRARY' || step === 'PLAN_LIBRARY' || step === 'RESUME_LIBRARY' || step === 'INTERVIEW_LIBRARY';

  const navDropdownPanel =
    'absolute left-1/2 -translate-x-1/2 top-full pt-1.5 z-[60] opacity-0 invisible pointer-events-none group-hover:opacity-100 group-hover:visible group-hover:pointer-events-auto transition-all duration-150';
  const navDropdownInner = 'bg-white border border-zinc-200 rounded-lg shadow-xl py-1 min-w-[156px]';

  if (modelTestMode) {
    return (
      <ModelRoutingTestPage
        onClose={() => {
          setModelTestMode(false);
          try {
            const u = new URL(window.location.href);
            u.searchParams.delete('modeltest');
            window.history.replaceState({}, '', `${u.pathname}${u.search}${u.hash}`);
          } catch {
            /* ignore */
          }
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans text-zinc-900 selection:bg-zinc-900 selection:text-white">
      
      {/* --- HEADER --- */}
      {step !== 'EXPLORE' && (
      <header className={`fixed top-0 w-full z-50 transition-all duration-300 ${step === 'INPUT' ? 'bg-white/90 backdrop-blur-sm py-5' : 'bg-white border-b border-zinc-200 py-3'}`}>
        <div className="container mx-auto px-6 flex items-center justify-between gap-4 max-w-6xl">
          <button type="button" onClick={resetAll} className="flex items-center hover:opacity-70 transition-opacity shrink-0">
             <span className="text-[18px] font-medium tracking-wide text-zinc-700" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
               Offerin
             </span>
          </button>

          <nav className="hidden md:flex flex-1 min-w-0 justify-center flex-wrap items-center gap-x-0.5 gap-y-1 text-[12px] lg:text-[13px] text-zinc-400">
            {step !== 'INPUT' && (
              <>
                <button type="button" onClick={goHome} className="px-1.5 py-1 rounded transition-colors hover:text-zinc-600">
                  首页
                </button>
                <span className="text-zinc-300">|</span>
              </>
            )}
            <button
              type="button"
              onClick={openCareerExplore}
              className={`px-1.5 py-1 rounded transition-colors flex items-center gap-1 ${step === 'EXPLORE' ? 'text-zinc-900 font-medium' : 'hover:text-zinc-600'}`}
            >
              <Target size={11} className="shrink-0" />
              职业探索
            </button>
            <span className="text-zinc-300">|</span>
            <div className="relative group">
              <button
                type="button"
                className={`px-1.5 py-1 rounded transition-colors flex items-center gap-0.5 ${resumeOptimizeActive ? 'text-zinc-900 font-medium' : 'hover:text-zinc-600'}`}
              >
                <FileText size={11} className="shrink-0" />
                简历优化
                <ChevronDown size={12} className="text-zinc-400 opacity-70" />
              </button>
              <div className={navDropdownPanel}>
                <div className={navDropdownInner}>
                  <button
                    type="button"
                    onClick={() => setStep('UPLOAD')}
                    className={`w-full text-left px-3 py-2 text-[12px] rounded-md transition-colors ${step === 'UPLOAD' ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    简历输入
                  </button>
                  <button
                    type="button"
                    onClick={() => diagnosisContent && setStep('ANALYSIS')}
                    className={`w-full text-left px-3 py-2 text-[12px] rounded-md transition-colors ${step === 'ANALYSIS' ? 'bg-zinc-100 text-zinc-900 font-medium' : diagnosisContent ? 'text-zinc-600 hover:bg-zinc-50' : 'text-zinc-300 cursor-not-allowed'}`}
                  >
                    诊断
                  </button>
                  <button
                    type="button"
                    onClick={() => !isRewriting && editableResume && setStep('EDITOR')}
                    className={`w-full text-left px-3 py-2 text-[12px] rounded-md transition-colors ${step === 'EDITOR' ? 'bg-zinc-100 text-zinc-900 font-medium' : !isRewriting && editableResume ? 'text-zinc-600 hover:bg-zinc-50' : 'text-zinc-300 cursor-not-allowed'}`}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => englishResume && setStep('ENGLISH_VERSION')}
                    className={`w-full text-left px-3 py-2 text-[12px] rounded-md transition-colors ${step === 'ENGLISH_VERSION' ? 'bg-zinc-100 text-zinc-900 font-medium' : englishResume ? 'text-zinc-600 hover:bg-zinc-50' : 'text-zinc-300 cursor-not-allowed'}`}
                  >
                    英文版
                  </button>
                </div>
              </div>
            </div>
            <span className="text-zinc-300">|</span>
            <button
              type="button"
              onClick={() => setStep('INTERVIEW')}
              className={`px-1.5 py-1 rounded transition-colors flex items-center gap-1 ${step === 'INTERVIEW' ? 'text-zinc-900 font-medium' : 'hover:text-zinc-600'}`}
            >
              <Mic size={11} className="shrink-0" />
              模拟面试
            </button>
            <span className="text-zinc-300">|</span>
            <div className="relative group">
              <button
                type="button"
                className={`px-1.5 py-1 rounded transition-colors flex items-center gap-0.5 ${contentMgmtActive ? 'text-zinc-900 font-medium' : 'hover:text-zinc-600'}`}
              >
                <LayoutGrid size={11} className="shrink-0" />
                内容管理
                <ChevronDown size={12} className="text-zinc-400 opacity-70" />
              </button>
              <div className={navDropdownPanel}>
                <div className={navDropdownInner}>
                  <button
                    type="button"
                    onClick={() => requireLogin(() => setStep('JD_LIBRARY'))}
                    className={`w-full text-left px-3 py-2 text-[12px] rounded-md transition-colors flex items-center gap-2 ${step === 'JD_LIBRARY' ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    <Briefcase size={12} className="shrink-0 opacity-70" />
                    JD 库
                  </button>
                  <button
                    type="button"
                    onClick={() => requireLogin(openPlanLibrary)}
                    className={`w-full text-left px-3 py-2 text-[12px] rounded-md transition-colors flex items-center gap-2 ${step === 'PLAN_LIBRARY' ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    <ClipboardList size={12} className="shrink-0 opacity-70" />
                    计划库
                  </button>
                  <button
                    type="button"
                    onClick={() => requireLogin(() => setStep('RESUME_LIBRARY'))}
                    className={`w-full text-left px-3 py-2 text-[12px] rounded-md transition-colors flex items-center gap-2 ${step === 'RESUME_LIBRARY' ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    <FolderOpen size={12} className="shrink-0 opacity-70" />
                    简历库
                  </button>
                  <button
                    type="button"
                    onClick={() => requireLogin(() => setStep('INTERVIEW_LIBRARY'))}
                    className={`w-full text-left px-3 py-2 text-[12px] rounded-md transition-colors flex items-center gap-2 ${step === 'INTERVIEW_LIBRARY' ? 'bg-zinc-100 text-zinc-900 font-medium' : 'text-zinc-600 hover:bg-zinc-50'}`}
                  >
                    <MessageSquare size={12} className="shrink-0 opacity-70" />
                    面试记录
                  </button>
                </div>
              </div>
            </div>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {step !== 'INPUT' && (
              <button onClick={resetAll} className="text-[13px] text-zinc-400 hover:text-zinc-900 transition-colors flex items-center gap-1.5">
                <RefreshCw size={13} />
                <span className="hidden sm:inline">重置</span>
              </button>
            )}

            <UserAvatar 
              onLoginClick={() => setShowLoginModal(true)} 
              onUpgradeClick={() => {
                setMembershipModalProduct('full_monthly');
                setShowVIPModal(true);
              }}
              onJdLibrary={() => requireLogin(() => setStep('JD_LIBRARY'))}
              onPlanLibrary={() => requireLogin(openPlanLibrary)}
              onResumeLibrary={() => requireLogin(() => setStep('RESUME_LIBRARY'))}
              onInterviewLibrary={() => requireLogin(() => setStep('INTERVIEW_LIBRARY'))}
            />
          </div>
        </div>
      </header>
      )}

      {/* 登录弹窗 */}
      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />

      {user?.id && (
        <SavedResumePickModal
          isOpen={uploadLibraryOpen}
          onClose={() => setUploadLibraryOpen(false)}
          userId={user.id}
          modes={['resume']}
          title="从简历库载入简历"
          onPick={handleUploadLibraryPick}
        />
      )}

      {user?.id && (
        <SavedJdPickModal
          isOpen={uploadJdLibraryOpen}
          onClose={() => setUploadJdLibraryOpen(false)}
          userId={user.id}
          title="从 JD 库载入"
          onPick={handleUploadJdLibraryPick}
        />
      )}

      {/* VIP 升级弹窗 */}
      <VIPUpgradeModal 
        isOpen={showVIPModal} 
        defaultProductId={membershipModalProduct}
        onClose={() => setShowVIPModal(false)}
        onSuccess={() => setUsageLimitError(null)}
      />

      {/* 单次下载付费弹窗 */}
      <DownloadPayModal
        isOpen={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
        onSuccess={() => {
          setShowDownloadModal(false);
          doExportPDF();
        }}
        onUpgradeVIP={() => {
          setMembershipModalProduct('full_monthly');
          setShowVIPModal(true);
        }}
      />

      {/* 简历命名弹窗（首次保存时） */}
      {showSaveNameModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setShowSaveNameModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5">
            <button onClick={() => setShowSaveNameModal(false)} className="absolute top-3 right-3 text-zinc-400 hover:text-zinc-600 transition-colors">
              <X size={16} />
            </button>
            <div className="mb-4">
              <h3 className="font-semibold text-zinc-900 text-[15px]">保存简历</h3>
              <p className="text-xs text-zinc-400 mt-1">为简历命名，方便后续查找</p>
            </div>
            <input
              type="text"
              value={saveNameInput}
              onChange={e => setSaveNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmSaveName(); if (e.key === 'Escape') setShowSaveNameModal(false); }}
              placeholder="例：张三 - 产品经理"
              autoFocus
              className="w-full px-3 py-2.5 border border-zinc-200 rounded-lg text-sm text-zinc-900 placeholder-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 transition-colors"
            />
            <div className="flex gap-2.5 mt-4">
              <button
                onClick={() => setShowSaveNameModal(false)}
                className="flex-1 px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-500 hover:bg-zinc-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmSaveName}
                className="flex-1 px-3 py-2 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-800 transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 使用限制提示弹窗 */}
      {usageLimitError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setUsageLimitError(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <Lock className="text-amber-600" size={24} />
              </div>
              <div>
                <h3 className="font-semibold text-zinc-900">使用次数已达上限</h3>
                <p className="text-sm text-zinc-500">升级会员解锁更多功能</p>
              </div>
            </div>
            <p className="text-zinc-600 text-sm mb-6">{usageLimitError}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setUsageLimitError(null)}
                className="flex-1 px-4 py-2.5 border border-zinc-200 rounded-lg text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
              >
                稍后再说
              </button>
              <button
                onClick={() => {
                  setUsageLimitError(null);
                  setMembershipModalProduct('full_monthly');
                  setShowVIPModal(true);
                }}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg text-sm font-medium text-white hover:from-amber-600 hover:to-orange-600 transition-colors"
              >
                开通会员
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'EXPLORE' && (
        <ExplorePage
          initialResumeFromApp={resume.trim() || undefined}
          onBack={closeCareerExplore}
          onOpenPlanLibrary={() =>
            requireLogin(() => {
              setViewingSavedCareerPlan(null);
              setPlanLibraryNotebookPlanId(null);
              setStep('PLAN_LIBRARY');
            })
          }
          onOpenJdLibrary={() => requireLogin(() => setStep('JD_LIBRARY'))}
          onOpenUpgrade={openExploreUpgrade}
        />
      )}

      {step === 'PLAN_LIBRARY' && (
        <div className="min-h-screen bg-white pt-20 pb-12">
          <div className="container mx-auto px-6 max-w-4xl">
            {viewingSavedCareerPlan ? (
              <PlanDetailPage
                savedPlan={viewingSavedCareerPlan}
                onBack={() => setViewingSavedCareerPlan(null)}
                onOpenLinkedNotes={planId => {
                  setViewingSavedCareerPlan(null);
                  setPlanLibraryNotebookPlanId(planId);
                }}
              />
            ) : (
              <PlanLibrary
                notebookFocusPlanId={planLibraryNotebookPlanId}
                onNotebookFocusConsumed={handlePlanLibraryNotebookFocusConsumed}
                onBack={() => {
                  setViewingSavedCareerPlan(null);
                  setPlanLibraryNotebookPlanId(null);
                  try {
                    window.history.replaceState({}, '', window.location.pathname);
                  } catch (_) {}
                  setStep('INPUT');
                }}
                onOpenPlan={p => setViewingSavedCareerPlan(p)}
                onNewPlan={() => {
                  setViewingSavedCareerPlan(null);
                  setPlanLibraryNotebookPlanId(null);
                  openCareerExplore();
                }}
              />
            )}
          </div>
        </div>
      )}

      {(step !== 'EXPLORE' && step !== 'PLAN_LIBRARY') && (
      <>
      {/* --- HERO --- */}
      {step === 'INPUT' && (
        <section className="pt-36 pb-16 px-6">
           <div className="container mx-auto text-center max-w-4xl">
              <h1 className="font-display text-[38px] md:text-[48px] font-semibold tracking-tight text-zinc-900 mb-5 leading-[1.15] animate-fade-in">
                <span className="inline-block animate-slide-up">Offerin</span>
                <span className="inline-block mx-2 text-zinc-300">—</span>
                <span className="inline-block animate-slide-up animation-delay-100">你的 AI 求职专家</span>
              </h1>
              <p className="text-zinc-500 text-[15px] font-normal max-w-xl mx-auto mb-10 leading-relaxed animate-fade-in animation-delay-200">
                求职全链路，和你一起走完。
              </p>
              <a 
                href="https://xhslink.com/m/AhWS7UwBPGZ" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-[13px] text-zinc-400 hover:text-zinc-600 transition-colors mb-12 animate-fade-in animation-delay-300"
              >
                <span>了解更多</span>
                <ArrowRight size={14} />
              </a>

              <HomeMarketing
                requireLogin={requireLogin}
                openCareerExplore={openCareerExplore}
                onShowLogin={() => setShowLoginModal(true)}
                onOpenMembership={(product) => {
                  setMembershipModalProduct(product);
                  setShowVIPModal(true);
                }}
                user={user?.id ? { id: user.id } : null}
                onGoUpload={() => setStep('UPLOAD')}
                onGoInterview={() => setStep('INTERVIEW')}
                onGoJdLibrary={() => setStep('JD_LIBRARY')}
                onGoPlanLibrary={() => {
                  setViewingSavedCareerPlan(null);
                  setPlanLibraryNotebookPlanId(null);
                  setStep('PLAN_LIBRARY');
                }}
                onGoResumeLibrary={() => setStep('RESUME_LIBRARY')}
                onGoInterviewLibrary={() => setStep('INTERVIEW_LIBRARY')}
              />


           </div>
        </section>
      )}

      {/* --- MAIN CONTENT --- */}
      <main className={`flex-grow container mx-auto px-4 md:px-6 flex flex-col gap-6 relative z-10 max-w-6xl ${step === 'INPUT' ? 'pb-24' : 'pt-20 pb-6'}`}>
        
        {/* Step: Upload - 简历上传表单 */}
        {step === 'UPLOAD' && (
          <div ref={inputSectionRef} className="w-full max-w-3xl mx-auto scroll-mt-20">
            
            <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
              <div className="p-6 md:p-8 space-y-8">
                
                {/* JD Input */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <label className="text-[13px] font-medium text-zinc-900 flex items-center gap-1.5">
                      <Target size={13} className="text-zinc-400" />
                      目标岗位 JD
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          if (!user) {
                            setShowLoginModal(true);
                            return;
                          }
                          setUploadJdLibraryOpen(true);
                        }}
                        className="text-[12px] text-zinc-500 hover:text-zinc-900 font-medium flex items-center gap-1 transition-colors"
                      >
                        <Briefcase size={11} /> 从 JD 库
                      </button>
                      <button onClick={() => jdFileInputRef.current?.click()} disabled={processingState.jd} className={`text-[12px] text-zinc-400 hover:text-zinc-900 font-medium flex items-center gap-1 transition-colors ${processingState.jd ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        <Upload size={11} /> 上传文件
                      </button>
                    </div>
                  </div>
                  {/* JD 完整度提示 */}
                  <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
                    <p className="text-[11px] text-amber-700 leading-relaxed">
                      <span className="font-semibold">💡 提示：</span>请提供尽可能<span className="font-semibold">详细、完整</span>的 JD 内容（包括岗位职责、任职要求、团队介绍等），这将帮助 AI 更精准地优化你的简历。
                    </p>
                  </div>
                  <p className="text-[11px] text-zinc-400">支持 PDF、Word（.doc/.docx）、图片，单文件 ≤3MB；建议优先使用 PDF 或 .docx 以获得更好解析。</p>
                  <input type="file" ref={jdFileInputRef} className="hidden" accept=".pdf,.doc,.docx,image/*" onChange={(e) => handleFileChange(e, 'jd')} />
                  <textarea
                    value={jd}
                    onChange={(e) => setJd(e.target.value)}
                    onPaste={(e) => handlePaste(e, 'jd')}
                    placeholder="粘贴目标岗位描述（建议包含：岗位职责、任职要求、团队/业务介绍等）..."
                    className="w-full h-32 p-4 bg-zinc-50 border border-zinc-200 rounded-md focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 outline-none transition-all resize-none text-[13px] text-zinc-800 placeholder:text-zinc-400"
                  />
                  {processingState.jd && <FileChip name="" mime="" onRemove={() => {}} isLoading={true} />}
                  {!processingState.jd && jdFile && <FileChip name={jdFile.name} mime={jdFile.mime} onRemove={() => setJdFile(null)} />}
                </div>

                {/* Resume Input */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <label className="text-[13px] font-medium text-zinc-900 flex items-center gap-1.5">
                      <FileText size={13} className="text-zinc-400" />
                      你的简历
                    </label>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={openResumeLibrary} className="text-[12px] text-zinc-500 hover:text-zinc-900 font-medium flex items-center gap-1 transition-colors">
                        <FolderOpen size={11} /> 从简历库
                      </button>
                      <button onClick={() => resumeFileInputRef.current?.click()} disabled={processingState.resume} className={`text-[12px] text-zinc-400 hover:text-zinc-900 font-medium flex items-center gap-1 transition-colors ${processingState.resume ? 'opacity-50 cursor-not-allowed' : ''}`}>
                        <Upload size={11} /> 上传文件
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-zinc-400">支持 PDF、Word（.doc/.docx）、图片，单文件 ≤3MB；建议优先使用 PDF 或 .docx。</p>
                  <input type="file" ref={resumeFileInputRef} className="hidden" accept=".pdf,.doc,.docx,image/*" onChange={(e) => handleFileChange(e, 'resume')} />
                  <textarea
                    value={resume}
                    onChange={(e) => setResume(e.target.value)}
                    onPaste={(e) => handlePaste(e, 'resume')}
                    placeholder="粘贴简历内容，或直接上传/截图粘贴..."
                    className="w-full h-44 p-4 bg-zinc-50 border border-zinc-200 rounded-md focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 outline-none transition-all resize-none text-[13px] text-zinc-800 placeholder:text-zinc-400"
                  />
                  {processingState.resume && <FileChip name="" mime="" onRemove={() => {}} isLoading={true} />}
                  {!processingState.resume && resumeFile && <FileChip name={resumeFile.name} mime={resumeFile.mime} onRemove={() => setResumeFile(null)} />}
                </div>

                {/* Aspiration */}
                <div className="space-y-2.5">
                  <label className="text-[13px] font-medium text-zinc-900 flex items-center gap-1.5">
                     <Sparkles size={13} className="text-zinc-400" />
                     特别诉求
                     <span className="text-zinc-400 font-normal ml-1">选填</span>
                  </label>
                  <input
                    type="text"
                    value={aspiration}
                    onChange={(e) => setAspiration(e.target.value)}
                    placeholder="如：突出管理能力、转型产品方向、强调数据分析经验..."
                    className="w-full p-3.5 bg-zinc-50 border border-zinc-200 rounded-md focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 outline-none transition-all text-[13px] text-zinc-800 placeholder:text-zinc-400"
                  />
                </div>
              </div>

              {/* Action Bar */}
              <div className="px-6 md:px-8 py-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-end">
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={handleDirectEdit}
                    disabled={isAnalyzing || isDirectEditing || processingState.jd || processingState.resume}
                    className={`px-5 py-2.5 rounded-md flex items-center gap-2 text-[13px] font-medium transition-all border ${isAnalyzing || isDirectEditing || processingState.jd || processingState.resume ? 'border-zinc-200 bg-zinc-100 text-zinc-400 cursor-not-allowed' : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-100 hover:border-zinc-400'}`}
                  >
                    {isDirectEditing ? <Loader2 className="animate-spin" size={15} /> : <PenTool size={15} />}
                    <span>{isDirectEditing ? '进入中...' : '进入编辑'}</span>
                  </button>
                  <button
                    onClick={handleAnalysis}
                    disabled={isAnalyzing || isDirectEditing || processingState.jd || processingState.resume}
                    className={`px-5 py-2.5 rounded-md flex items-center gap-2 text-[13px] font-medium transition-all ${isAnalyzing || isDirectEditing || processingState.jd || processingState.resume ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed' : 'bg-zinc-900 text-white hover:bg-zinc-800'}`}
                  >
                    {isAnalyzing ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                    <span>{isAnalyzing ? '分析中...' : '进入诊断重构'}</span>
                  </button>
                </div>
              </div>
              
               {error && (
                  <div className="mx-6 md:mx-8 mb-6 p-3.5 bg-red-50 border border-red-100 rounded-md flex items-start gap-2.5">
                    <AlertCircle size={15} className="text-red-500 mt-0.5 shrink-0" />
                    <p className="text-[12px] text-red-600 leading-relaxed">{error}</p>
                  </div>
                )}
            </div>
          </div>
        )}
        
        {/* Step 2: Analysis */}
        {step === 'ANALYSIS' && (
          <div className="h-full no-print">
            <div className="bg-white rounded-lg border border-zinc-200 h-full flex flex-col max-w-4xl mx-auto overflow-hidden">
              <div className="px-6 py-4 flex items-center justify-between border-b border-zinc-100 flex-wrap gap-2">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="font-display font-semibold text-[15px] text-zinc-900">诊断报告</h2>
                  {isAnalyzing && (
                    <span className="flex items-center gap-1.5 text-[12px] text-zinc-400">
                      <Loader2 size={12} className="animate-spin" />
                      生成中...
                    </span>
                  )}
                  <span className="text-[11px] text-zinc-400 truncate max-w-[280px]" title={`简历：${resumeFile?.name || (resume?.slice(0, 30) ? '文本' : '—')}；JD：${jdFile?.name || (jd?.slice(0, 30) ? '文本' : '—')}`}>
                    本次：简历 {resumeFile?.name || (resume?.trim() ? '文本' : '—')}，JD {jdFile?.name || (jd?.trim() ? '文本' : '—')}
                  </span>
                </div>
                <button onClick={cancelAnalysisAndGoBack} className="text-[12px] text-zinc-400 hover:text-zinc-900 transition-colors shrink-0">
                  修改输入
                </button>
              </div>
              {error && (
                <div className="mx-6 md:mx-8 mb-4 p-3.5 bg-red-50 border border-red-100 rounded-md flex items-start gap-2.5">
                  <AlertCircle size={15} className="text-red-500 mt-0.5 shrink-0" />
                  <p className="text-[12px] text-red-600 leading-relaxed">{error}</p>
                </div>
              )}
              <div className="p-6 md:p-8 overflow-y-auto max-h-[calc(100vh-260px)] custom-scrollbar">
                {diagnosisContent ? (
                  <div className="prose prose-zinc max-w-none">
                     <MarkdownRenderer content={diagnosisContent} mode="diagnosis" />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
                    <Loader2 size={24} className="animate-spin mb-3" />
                    <span className="text-[13px]">正在分析简历...</span>
                  </div>
                )}
                
                {!isAnalyzing && diagnosisContent && (
                  <div className="mt-12 border-t border-zinc-100 pt-8 pb-6">
                    <p className="text-center text-[13px] text-zinc-500 mb-5">下一步</p>
                    <div className="flex justify-center">
                      <button 
                        onClick={handleProceedToEditor}
                        disabled={isRewriting || !editableResume}
                        className={`group px-6 py-4 rounded-lg text-[13px] font-medium flex flex-col items-center gap-2 transition-all min-w-[200px] ${
                          isRewriting || !editableResume
                            ? 'bg-zinc-700 cursor-wait' 
                            : 'bg-zinc-900 hover:bg-zinc-800'
                        } text-white`}
                      >
                        {isRewriting || !editableResume ? (
                          <Loader2 size={18} className="text-zinc-300 animate-spin" />
                        ) : (
                          <Sparkles size={18} className="text-zinc-300" />
                        )}
                        <span>{!isRewriting && editableResume ? '查看优化结果' : '优化中，请稍候'}</span>
                        <span className="text-[11px] text-zinc-400 font-normal">
                          {!isRewriting && editableResume ? '简历已优化完成，点击查看并精调' : '请稍候，AI 正在后台优化简历'}
                        </span>
                      </button>
                    </div>
                    {isRewriting && resumeContent && (
                      <div className="mt-6 max-w-2xl mx-auto">
                        <div className="text-[11px] text-zinc-400 mb-2 flex items-center gap-1.5">
                          <Loader2 size={10} className="animate-spin" />
                          优化预览
                        </div>
                        <div className="bg-zinc-50 rounded-md p-4 max-h-[200px] overflow-y-auto text-[12px] text-zinc-600 font-mono leading-relaxed border border-zinc-100">
                          {resumeContent.substring(0, 500)}{resumeContent.length > 500 ? '...' : ''}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 3 & 4: Editor + Preview */}
        {(step === 'EDITOR' || step === 'ENGLISH_VERSION') && (
          <div ref={containerRef} className={`flex flex-col lg:flex-row ${isFullscreen ? 'fixed inset-0 z-50 bg-zinc-100 p-4 gap-4' : 'h-[calc(100vh-120px)]'}`}>
            
            {/* 全屏模式下的顶部导航栏 */}
            {isFullscreen && (
              <div className="absolute top-0 left-0 right-0 bg-white border-b border-zinc-200 px-4 py-3 flex items-center justify-between z-10">
                <button 
                  onClick={() => setIsFullscreen(false)}
                  className="flex items-center gap-2 text-[13px] text-zinc-600 hover:text-zinc-900 transition-colors"
                >
                  <ArrowLeft size={16} />
                  返回编辑
                </button>
                <span className="text-[13px] font-medium text-zinc-900">简历预览</span>
                <button 
                  onClick={() => setIsFullscreen(false)}
                  className="p-2 hover:bg-zinc-100 rounded-md transition-colors text-zinc-500 hover:text-zinc-900"
                >
                  <X size={18} />
                </button>
              </div>
            )}
            
            {/* Editor */}
            <div className={`flex flex-col bg-white rounded-lg border border-zinc-200 overflow-hidden no-print transition-all duration-300 ${isFullscreen ? 'hidden' : 'w-full'}`} style={!isFullscreen ? { flex: `0 0 ${editorWidthPercent}%` } : undefined}>
              <div className="bg-zinc-50 px-5 py-2.5 border-b border-zinc-200 flex justify-between items-center gap-2 flex-wrap">
                 <span className="text-[13px] font-medium text-zinc-900 flex items-center gap-1.5">
                   <PenTool size={13} className="text-zinc-400" /> 
                   {step === 'ENGLISH_VERSION' ? '英文编辑器' : '编辑器'}
                   <span className="text-[11px] font-normal text-zinc-400 truncate max-w-[200px]" title={`简历：${resumeFile?.name || '文本'}；JD：${jdFile?.name || '文本'}`}>
                     （本次：{resumeFile?.name || '文本'}）
                   </span>
                 </span>
                 
                 <div className="flex items-center gap-2">
                   {step === 'EDITOR' ? (
                     <>
                       <div className="relative">
                         <button 
                           onClick={() => setShowPhotoPanel(!showPhotoPanel)}
                          className={`flex items-center gap-1 text-[12px] transition-colors ${
                            getPhotoUrlFromMarkdown(editableResume)
                              ? 'text-green-600 hover:text-green-700'
                              : 'text-zinc-500 hover:text-zinc-900'
                          }`}
                           title="添加简历照片"
                         >
                           <ImageIcon size={11} />
                           照片
                         </button>
                         {showPhotoPanel && (
                           <PhotoUploadPanel
                              userId={user?.id}
                              resumeId={currentSavedResumeId || undefined}
                              currentPhotoUrl={getPhotoUrlFromMarkdown(editableResume)}
                              onPhotoChange={handlePhotoChange}
                              onClose={() => setShowPhotoPanel(false)}
                            />
                         )}
                       </div>
                       <span className="text-zinc-200">|</span>
                      <button 
                        onClick={() => englishResume ? setStep('ENGLISH_VERSION') : generateTranslation()}
                        disabled={isTranslating}
                        className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-900 transition-colors"
                      >
                        {isTranslating ? <Loader2 size={11} className="animate-spin" /> : (englishResume ? <Globe size={12} /> : <Languages size={12} />)}
                        {englishResume ? "查看英文版" : "生成英文版"}
                      </button>
                       <span className="text-zinc-200">|</span>
                       <button 
                         onClick={() => setStep('INTERVIEW')}
                         className="flex items-center gap-1.5 text-[12px] text-zinc-500 hover:text-zinc-900 transition-colors"
                       >
                         <Mic size={12} />
                         模拟面试
                       </button>
                       <span className="text-zinc-200">|</span>
                      <button 
                        onClick={handleSaveResume}
                        disabled={isSavingResume}
                        className={`flex items-center gap-1.5 text-[12px] transition-colors ${
                          saveSuccess 
                            ? 'text-green-600' 
                            : 'text-zinc-500 hover:text-zinc-900'
                        }`}
                      >
                         {isSavingResume ? <Loader2 size={11} className="animate-spin" /> : 
                          saveSuccess ? <CheckCircle2 size={11} /> : <Save size={11} />}
                         {isSavingResume ? '保存中...' : saveSuccess ? '已保存' : currentSavedResumeId ? '更新保存' : '保存简历'}
                       </button>
                     </>
                   ) : (
                     <>
                        <div className="relative">
                          <button 
                            onClick={() => setShowPhotoPanel(!showPhotoPanel)}
                            className={`flex items-center gap-1 text-[12px] transition-colors ${
                              getPhotoUrlFromMarkdown(englishResume)
                                ? 'text-green-600 hover:text-green-700'
                                : 'text-zinc-500 hover:text-zinc-900'
                            }`}
                            title="添加简历照片"
                          >
                            <ImageIcon size={11} />
                            照片
                          </button>
                          {showPhotoPanel && (
                            <PhotoUploadPanel
                              userId={user?.id}
                              resumeId={currentSavedResumeId || undefined}
                              currentPhotoUrl={getPhotoUrlFromMarkdown(englishResume)}
                              onPhotoChange={handlePhotoChange}
                              onClose={() => setShowPhotoPanel(false)}
                            />
                          )}
                        </div>
                        <span className="text-zinc-200">|</span>
                        <button onClick={() => setStep('EDITOR')} className="text-[12px] text-zinc-400 hover:text-zinc-900 flex items-center gap-1 transition-colors">
                           <ArrowLeft size={11} /> 中文版
                        </button>
                        <span className="text-zinc-200">|</span>
                        <button 
                           onClick={generateTranslation}
                           disabled={isTranslating}
                           className="flex items-center gap-1 text-[12px] text-zinc-500 hover:text-zinc-900 transition-colors"
                        >
                           {isTranslating ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                           重新翻译
                        </button>
                        <span className="text-zinc-200">|</span>
                        <button 
                           onClick={handleSaveResume}
                           disabled={isSavingResume}
                           className={`flex items-center gap-1.5 text-[12px] transition-colors ${
                             saveSuccess 
                               ? 'text-green-600' 
                               : 'text-zinc-500 hover:text-zinc-900'
                           }`}
                        >
                           {isSavingResume ? <Loader2 size={11} className="animate-spin" /> : 
                            saveSuccess ? <CheckCircle2 size={11} /> : <Save size={11} />}
                           {isSavingResume ? '保存中...' : saveSuccess ? '已保存' : currentSavedResumeId ? '更新保存' : '保存简历'}
                        </button>
                     </>
                   )}
                 </div>
              </div>
              <div className="relative flex-grow flex flex-col overflow-hidden">
                <div className="px-4 py-1.5 bg-blue-50 border-b border-blue-100 flex items-center gap-2">
                  <MousePointerClick size={11} className="text-blue-400" />
                  <span className="text-[11px] text-blue-500">选中任意文本，即可使用 AI 精调</span>
                </div>
                <textarea 
                  ref={editorTextareaRef}
                  className="flex-grow p-5 resize-none focus:outline-none bg-white text-[13px] font-mono leading-relaxed text-zinc-800 selection:bg-blue-100"
                  value={step === 'ENGLISH_VERSION' ? englishResume : editableResume}
                  onChange={(e) => step === 'ENGLISH_VERSION' ? setEnglishResume(e.target.value) : setEditableResume(e.target.value)}
                  placeholder={step === 'ENGLISH_VERSION' ? "在此编辑英文简历..." : "在此编辑 Markdown 简历，选中文本可 AI 精调..."}
                  spellCheck={false}
                />
                <SelectionToolbar
                  editorRef={editorTextareaRef}
                  fullResume={step === 'ENGLISH_VERSION' ? englishResume : editableResume}
                  jd={jd}
                  diagnosis={diagnosisContent}
                  onReplace={handleSelectionReplace}
                  onShowLimitError={setUsageLimitError}
                />
              </div>
            </div>

            {/* Draggable Divider */}
            {!isFullscreen && (
              <div
                onMouseDown={handleDragStart}
                className="hidden lg:flex items-center justify-center w-2 cursor-col-resize group hover:bg-zinc-200/60 active:bg-zinc-300/60 transition-colors shrink-0 rounded"
                title="拖拽调整左右分栏宽度"
              >
                <div className="w-[3px] h-8 rounded-full bg-zinc-300 group-hover:bg-zinc-400 group-active:bg-zinc-500 transition-colors" />
              </div>
            )}

            {/* Preview */}
            <div className={`flex flex-col transition-all duration-300 ${isFullscreen ? 'w-full h-full pt-14' : 'w-full lg:flex-1 lg:min-w-0'}`}>
               
               {/* Toolbar */}
               <div className="bg-white px-3 py-2.5 rounded-t-lg flex flex-wrap gap-y-2 justify-between items-center no-print border border-zinc-200 border-b-0">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                   <span className="text-[13px] font-medium text-zinc-900 flex items-center gap-1 whitespace-nowrap">
                     <FileText size={13} className="text-zinc-400" /> 预览
                   </span>
                   
                   {/* Capacity */}
                   <span className={`text-[11px] px-1.5 py-0.5 rounded-sm font-medium whitespace-nowrap ${
                     capacity.status === 'optimal' ? 'bg-green-50 text-green-600' : 
                     capacity.status === 'overflow' ? 'bg-orange-50 text-orange-600' :
                     'bg-red-50 text-red-600'
                   }`}>
                      {capacity.percentage}% · {capacity.label}
                   </span>

                   {/* Density */}
                   <div className="flex items-center gap-1 flex-1 max-w-[100px] min-w-[60px]">
                     <AlignJustify size={11} className="text-zinc-300" />
                     <input 
                       type="range" 
                       min="0.5" 
                       max="1.5" 
                       step="0.05" 
                       value={densityMultiplier}
                       onChange={(e) => setDensityMultiplier(parseFloat(e.target.value))}
                       className="w-full h-0.5 bg-zinc-200 rounded appearance-none cursor-pointer accent-zinc-900"
                     />
                   </div>

                   {/* Template Switcher */}
                   <div className="flex items-center gap-0.5">
                     <Layout size={11} className="text-zinc-300 mr-0.5" />
                      <button 
                        onClick={() => setSelectedTemplate('classic')}
                        className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${selectedTemplate === 'classic' ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100'}`}
                        title="专业版：适合国际化大厂、专业性/管理性质岗位"
                      >
                        专业版
                      </button>
                      <button 
                        onClick={() => setSelectedTemplate('tech')}
                        className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${selectedTemplate === 'tech' ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100'}`}
                        title="清晰版：适合国内大中小厂、技术岗位"
                      >
                        清晰版
                      </button>
                      <button 
                        onClick={() => setSelectedTemplate('academic')}
                        className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${selectedTemplate === 'academic' ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100'}`}
                        title="学术版：适合高校、研究机构、学术型简历"
                      >
                        学术版
                      </button>
                    </div>
                 </div>

                 <div className="flex items-center gap-1.5 ml-2">
                    <div className="flex items-center gap-0.5 mr-1">
                      <button onClick={zoomOut} className="p-1 hover:text-zinc-900 text-zinc-400 transition-colors"><ZoomOut size={13}/></button>
                      <button onClick={zoomIn} className="p-1 hover:text-zinc-900 text-zinc-400 transition-colors"><ZoomIn size={13}/></button>
                    </div>

                   <button 
                     onClick={() => setIsFullscreen(!isFullscreen)}
                     className="p-1.5 hover:bg-zinc-100 rounded transition-colors text-zinc-400 hover:text-zinc-900 hidden md:block"
                   >
                     {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                   </button>
                   
                   <span className="text-zinc-200 mx-0.5">|</span>

                   <button 
                    onClick={handleExportPDF}
                    disabled={isGeneratingFile}
                    className="bg-zinc-900 hover:bg-zinc-800 text-white text-[12px] px-2.5 py-1 rounded transition-colors flex items-center gap-1 font-medium"
                  >
                     {isGeneratingFile ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                     导出 PDF
                  </button>
                </div>
              </div>
               
              {/* Preview Container */}
              <div className={`flex-grow bg-zinc-100 overflow-auto p-4 md:p-6 relative custom-scrollbar border border-zinc-200 border-t-0 ${isFullscreen ? '' : 'rounded-b-lg'}`}>
                
                {/* 页面容量警告 - 居中显示 */}
                {(capacity.status === 'overflow' || capacity.status === 'danger') && (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-zinc-900 text-white text-[11px] px-3 py-1.5 rounded-md font-medium flex items-center gap-2 whitespace-nowrap">
                       <span className="flex items-center gap-1.5">
                         <AlertTriangle size={12} /> 超出一页，建议精简非核心内容
                       </span>
                       <button
                         onClick={handleCondenseResume}
                         disabled={isCondensing}
                         className="bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-1"
                       >
                         {isCondensing ? (
                           <>
                             <Loader2 size={10} className="animate-spin" />
                            精简中...
                          </>
                        ) : (
                          <>
                            <Sparkles size={10} />
                            帮我精简
                          </>
                        )}
                      </button>
                   </div>
                )}

                 {/* 简历预览 - 分页显示，每页独立A4纸，与PDF下载效果一致 */}
                 <div className="flex flex-col items-center min-w-min relative"> 
                   {/* 占位符提示 - 固定在A4纸右上角，与A4边缘对齐 */}
                   {/X+%/i.test(step === 'ENGLISH_VERSION' ? englishResume : editableResume) && (
                       <div 
                         className="absolute z-30 bg-blue-50 text-blue-700 text-[11px] px-3 py-1.5 rounded-md font-medium border border-blue-200 whitespace-nowrap"
                         style={{
                           top: '8px',
                           right: `calc(50% - ${(A4_WIDTH_PX / 2) * previewScale}px)`,
                         }}
                       >
                          <span className="inline-flex items-center gap-1.5">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                            X% 等仅为模拟数据，请按实际情况修改
                          </span>
                       </div>
                   )}
                   
                   {/* 隐藏的测量容器：用于测量内容真实高度 */}
                   <div 
                     style={{
                       position: 'absolute',
                       top: '-10000px',
                       left: '0',
                       width: `${A4_WIDTH_PX - PAGE_PADDING_LEFT - PAGE_PADDING_RIGHT}px`,
                       visibility: 'hidden',
                     }}
                   >
                    <div id="resume-measure-container">
                      <MarkdownRenderer 
                        content={step === 'ENGLISH_VERSION' ? englishResume : editableResume} 
                        isResumePreview={true} 
                        densityMultiplier={densityMultiplier} 
                        mode="resume"
                        template={selectedTemplate}
                       />
                     </div>
                   </div>

                   {/* 分页预览：使用与 PDF 导出完全相同的像素扫描分页点 */}
                   {(() => {
                     const pageCount = Math.max(1, previewPageBreaks.length - 1);
                     const maxVisibleHeight = CONTENT_HEIGHT_PER_PAGE + PAGE_TOLERANCE;
                     
                     return Array.from({ length: pageCount }, (_, pageIndex) => {
                       const contentOffset = previewPageBreaks[pageIndex] || 0;
                       const nextBreak = previewPageBreaks[pageIndex + 1] || contentOffset;
                       const pageContentHeight = nextBreak - contentOffset;
                       const visibleHeight = Math.min(pageContentHeight, maxVisibleHeight);
                       
                       return (
                         <div 
                           key={pageIndex}
                           className="bg-white shadow-sm relative"
                           style={{
                             width: `${A4_WIDTH_PX}px`, 
                             height: `${A4_HEIGHT_PX}px`,
                             overflow: 'hidden',
                             transform: `scale(${previewScale})`,
                             transformOrigin: 'top center',
                             marginBottom: `${-(A4_HEIGHT_PX * (1 - previewScale)) + (pageIndex < pageCount - 1 ? 20 : 0)}px`,
                           }}
                         >
                           <div
                             className="absolute"
                             style={{
                               top: `${PAGE_PADDING_TOP}px`,
                               left: `${PAGE_PADDING_LEFT}px`,
                               right: `${PAGE_PADDING_RIGHT}px`,
                               height: `${visibleHeight}px`,
                               overflow: 'hidden',
                             }}
                           >
                             <div
                               className="text-slate-900"
                               style={{
                                 marginTop: `-${contentOffset}px`,
                               }}
                             >
                              <MarkdownRenderer 
                                content={step === 'ENGLISH_VERSION' ? englishResume : editableResume} 
                                isResumePreview={true} 
                                densityMultiplier={densityMultiplier} 
                                mode="resume"
                                template={selectedTemplate}
                              />
                             </div>
                           </div>

                           {/* 页码标签 */}
                           {pageCount > 1 && (
                             <div className="absolute bottom-2 right-3 text-[10px] text-zinc-300 select-none">
                               {pageIndex + 1} / {pageCount}
                             </div>
                           )}
                         </div>
                       );
                     });
                   })()}
                 </div>
               </div>
            </div>
          </div>
        )}

        {/* Step 5: Interview */}
        {step === 'INTERVIEW' && (
          <InterviewChat 
            onBack={() => { setViewingInterviewRecord(null); setStep('INPUT'); }} 
            initialResume={editableResume || resume}
            initialJd={jd}
            initialJdFile={jdFile ? { name: jdFile.name, data: jdFile.data, mime: jdFile.mime } : null}
            initialResumeFile={resumeFile ? { name: resumeFile.name, data: resumeFile.data, mime: resumeFile.mime } : null}
            onShowVIPModal={() => {
              setMembershipModalProduct('full_monthly');
              setShowVIPModal(true);
            }}
            onRequireLogin={() => setShowLoginModal(true)}
            viewingRecord={viewingInterviewRecord}
          />
        )}

        {/* Step: JD Library */}
        {step === 'JD_LIBRARY' && (
          <JdLibrary onBack={() => setStep('INPUT')} />
        )}

        {/* Step 6: Resume Library */}
        {step === 'RESUME_LIBRARY' && (
          <ResumeLibrary
            onBack={() => setStep('INPUT')}
            onOpenResume={handleOpenSavedResume}
            onNewResume={() => { resetAll(); setStep('UPLOAD'); }}
          />
        )}

        {/* Step 7: Interview Library */}
        {step === 'INTERVIEW_LIBRARY' && (
          <InterviewLibrary
            onBack={() => setStep('INPUT')}
            onNewInterview={() => setStep('INTERVIEW')}
            onOpenRecord={(record: SavedInterviewRecord) => {
              // 打开记录时跳转到面试页面并恢复消息
              setViewingInterviewRecord(record);
              setStep('INTERVIEW');
            }}
          />
        )}
      </main>

      {step === 'INPUT' && (
         <footer className="py-5 text-center text-[11px] tracking-wide bg-white no-print">
            <span className="text-zinc-300">Offerin</span>
            <span className="mx-2 text-zinc-200">|</span>
            <span className="text-zinc-400">反馈与建议：<a href="mailto:offerinplate@gmail.com" className="text-zinc-400 hover:text-zinc-600 transition-colors underline underline-offset-2">offerinplate@gmail.com</a></span>
            <span className="mx-2 text-zinc-200">|</span>
            <span className="text-zinc-400">小红书：<a href="https://xhslink.com/m/2DTebq4fiED" target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-600 transition-colors underline underline-offset-2">Rachels here</a></span>
         </footer>
      )}
      </>
      )}
      {/* 全局 Toast 提示 */}
      {toastMessage && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[9999] animate-fade-in-up">
          <div className="bg-zinc-900 text-white text-[13px] px-5 py-3 rounded-lg shadow-lg flex items-center gap-2 max-w-md">
            <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
