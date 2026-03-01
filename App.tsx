
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { analyzeResumeStream, rewriteResumeStream, translateResume, FileData, condenseResume } from './services/geminiService';
import MarkdownRenderer from './components/MarkdownRenderer';
import InterviewChat from './components/InterviewChat';
import { LoginModal, UserAvatar } from './components/LoginModal';
import { VIPUpgradeModal } from './components/VIPUpgradeModal';
import { DownloadPayModal } from './components/DownloadPayModal';
import ResumeLibrary from './components/ResumeLibrary';
import InterviewLibrary from './components/InterviewLibrary';
import SelectionToolbar from './components/SelectionToolbar';
import PhotoUploadPanel from './components/PhotoUploadPanel';
import { useAuth } from './contexts/AuthContext';
import { checkUsageLimit, logUsage, checkTranslationLimit } from './services/authService';
import { createSavedResume, updateSavedResume, extractResumeTitle } from './services/resumeService';
import type { SavedInterviewRecord } from './services/interviewRecordService';
import type { SavedResume } from './types';
import { FileText, Target, Send, Loader2, RefreshCw, ChevronRight, Upload, X, Paperclip, Image as ImageIcon, File, AlertCircle, PenTool, ArrowLeft, Maximize2, Minimize2, ZoomIn, ZoomOut, CheckCircle2, AlertTriangle, AlignJustify, Languages, Globe, ArrowRight, Sparkles, MessageSquare, Mic, Play, Users, Lock, Briefcase, Crown, Save, FolderOpen, MousePointerClick } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

type Step = 'INPUT' | 'UPLOAD' | 'ANALYSIS' | 'EDITOR' | 'ENGLISH_VERSION' | 'INTERVIEW' | 'RESUME_LIBRARY' | 'INTERVIEW_LIBRARY';

const App: React.FC = () => {
  const { user, profile, loading: authLoading } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showVIPModal, setShowVIPModal] = useState(false);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [usageLimitError, setUsageLimitError] = useState<string | null>(null);
  
  const [step, setStep] = useState<Step>('INPUT');
  const [viewingInterviewRecord, setViewingInterviewRecord] = useState<SavedInterviewRecord | null>(null);

  // 检查登录状态，未登录则弹出登录框
  const requireLogin = (callback: () => void) => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }
    callback();
  };
  
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
  
  const [diagnosisContent, setDiagnosisContent] = useState<string>('');
  const [resumeContent, setResumeContent] = useState<string>('');

  const [editableResume, setEditableResume] = useState('');
  const [englishResume, setEnglishResume] = useState('');
  
  
  const [isRewriting, setIsRewriting] = useState(false); // 全局重构 loading
  const [showPhotoPanel, setShowPhotoPanel] = useState(false);
  const editorTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [previewScale, setPreviewScale] = useState(0.65);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const [densityMultiplier, setDensityMultiplier] = useState<number>(1.0); 
  const [resumeHeight, setResumeHeight] = useState<number>(0);
  // 预览分页点（CSS像素级别），与 PDF 导出使用完全相同的像素扫描逻辑计算
  const [previewPageBreaks, setPreviewPageBreaks] = useState<number[]>([0]);
  
  const jdFileInputRef = useRef<HTMLInputElement>(null);
  const resumeFileInputRef = useRef<HTMLInputElement>(null);
  const inputSectionRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const A4_WIDTH_PX = 794;
  const A4_HEIGHT_PX = 1123; 
  
  const PAGE_PADDING_TOP = 40;  // 页面上边距
  const PAGE_PADDING_BOTTOM = 40; // 页面下边距
  const PAGE_PADDING_LEFT = 40;
  const PAGE_PADDING_RIGHT = 40; 

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
      const maxDrawableHeight = A4_HEIGHT_PX - PAGE_PADDING_TOP - PAGE_PADDING_BOTTOM;
      const tolerancePx = PAGE_TOLERANCE;
      
      // 单页内容（含容差），不需要像素扫描
      if (height <= maxDrawableHeight + tolerancePx) {
        if (!cancelled) setPreviewPageBreaks([0, height]);
        return;
      }
      
      // 多页内容：使用 html2canvas 渲染并像素扫描找安全分页点
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
        
        const canvas = await html2canvas(wrapper, {
          scale: 2, // 预览用较低 scale 提升性能
          useCORS: true,
          backgroundColor: '#ffffff',
          logging: false,
          width: contentWidth,
          height: wrapper.scrollHeight,
        });
        
        document.body.removeChild(tempContainer);
        if (cancelled) return;
        
        const canvasScale = canvas.width / contentWidth;
        const maxDrawableInCanvas = maxDrawableHeight * canvasScale;
        const toleranceInCanvas = tolerancePx * canvasScale;
        
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
        const breaks = [0];
        let pos = 0;
        while (pos < height) {
          if (height - pos <= maxDrawableHeight + tolerancePx) {
            breaks.push(height);
            break;
          }
          pos += maxDrawableHeight;
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
  }, [step, editableResume, englishResume, densityMultiplier]);

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
      
      // 保存文件信息（不回填文本，提交时再提取，加快速度）
      if (type === 'jd') {
        setJdFile({ name: file.name, data, mime });
      } else {
        setResumeFile({ name: file.name, data, mime });
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
            
            // 保存文件信息（不回填文本，提交时再提取，加快速度）
            if (type === 'jd') {
              setJdFile({ name: fileName, data, mime });
            } else {
              setResumeFile({ name: fileName, data, mime });
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
  const autoRewriteAfterDiagnosis = async (diagContent: string, abortController: AbortController) => {
    if (abortController.signal.aborted) return;
    
    setIsRewriting(true);
    setResumeContent('');

    try {
      const jdFileData: FileData | undefined = jdFile ? { data: jdFile.data, mimeType: jdFile.mime } : undefined;
      const resumeFileData: FileData | undefined = resumeFile ? { data: resumeFile.data, mimeType: resumeFile.mime } : undefined;

      await rewriteResumeStream(
        jd, resume, aspiration, diagContent,
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

  const handleAnalysis = useCallback(async () => {
    if (!jd.trim() && !jdFile && !resume.trim() && !resumeFile) {
      setError('请提供 JD 或 简历内容。');
      return;
    }

    // 检查登录状态
    if (!user) {
      setShowLoginModal(true);
      return;
    }

    // 检查使用限制
    const limitCheck = await checkUsageLimit(user.id, 'diagnosis', user.email || undefined);
    if (!limitCheck.allowed) {
      if (limitCheck.isTrialLimit) {
        setUsageLimitError(`简历诊断免费体验次数已用完（共${limitCheck.limit}次）。升级 VIP 享每日50次使用！`);
      } else {
        setUsageLimitError(`今日使用次数已达上限（${limitCheck.limit}次/天）。`);
      }
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
    setStep('ANALYSIS'); // 立即切换到分析页面，显示流式内容

    try {
      const jdFileData: FileData | undefined = jdFile ? { data: jdFile.data, mimeType: jdFile.mime } : undefined;
      const resumeFileData: FileData | undefined = resumeFile ? { data: resumeFile.data, mimeType: resumeFile.mime } : undefined;
      
      // 使用流式诊断（仅诊断，不自动重写，节省 token）
      await analyzeResumeStream(
        jd, 
        resume, 
        aspiration,
        {
          onDiagnosisChunk: (chunk) => {
            if (abortController.signal.aborted) return;
            setDiagnosisContent(prev => prev + chunk);
          },
          onDiagnosisComplete: (content) => {
            // 诊断完成，记录使用
            if (user) {
              logUsage(user.id, 'diagnosis');
            }
            // 诊断完成后自动触发重构（后台执行，不阻塞用户阅读诊断报告）
            if (!abortController.signal.aborted) {
              autoRewriteAfterDiagnosis(content, abortController);
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
      } else if (msg === 'QUOTA_EXCEEDED') {
        setError('配额限制：请求频率过快或已达今日上限，请稍后再试。');
      } else if (msg === 'EMPTY_RESPONSE') {
        setError('空响应：模型未能生成结果，请重试。');
      } else if (msg.includes('400')) {
        setError('无法处理上传的文件。提示：若使用PDF，请尝试转为图片上传，或者使用更小的文件。');
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
  }, [jd, resume, aspiration, jdFile, resumeFile, user]);

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
      // 记录翻译使用
      logUsage(user.id, 'translation');
    } catch (err) {
      alert("翻译服务繁忙，请稍后再试。");
    } finally {
      setIsTranslating(false);
    }
  };

  const resetAll = () => {
    // 取消正在进行的分析请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAnalyzing(false);
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
  };

  // 用于取消分析并返回上传页面
  const cancelAnalysisAndGoBack = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsAnalyzing(false);
    setDiagnosisContent('');
    setResumeContent('');
    setStep('UPLOAD');
  };

  const handleProceedToEditor = () => {
    // 重构已在诊断完成后自动执行，这里直接跳转编辑器
    if (editableResume) {
      // 重构已完成，直接进入编辑器
      setStep('EDITOR');
    }
    // 如果还在重构中（isRewriting=true），按钮会显示"优化中..."且 disabled，不会走到这里
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
  // 与 PDF 导出一致的容差：允许内容侵入底部 padding 最多 30px（保留 10px 底部边距）
  const PAGE_TOLERANCE = 30;

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
      
      const link = document.createElement('a');
      link.download = getResumeFileName('png');
      link.href = canvas.toDataURL('image/png');
      link.click();
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
      
      // 渲染完整内容为canvas - 明确指定高度以确保完整渲染
      const contentCanvas = await html2canvas(contentContainer, {
        scale: 3,
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
      // 容差：允许内容稍微超出可绘制高度，占用部分底部边距（最多占用30px，保留10px底部边距）
      const toleranceInCanvas = 30 * canvasScale;
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
        console.log(`第 ${i + 1} 页渲染完成, srcHeight=${Math.round(srcHeight/canvasScale)}px, pdfSize=${pdfWidth}x${pdfHeight}mm`);
      }
      
      // 清理
      document.body.removeChild(tempContainer);
      
      console.log('PDF 生成完成，共', pageCount, '页');
      pdf.save(getResumeFileName('pdf'));
    } catch (e) {
      console.error('PDF export failed', e);
      alert('PDF 生成失败，请重试');
    } finally {
      setIsGeneratingFile(false);
    }
  };

  // 处理 PDF 导出（带付费检查）
  const handleExportPDF = async () => {
    // 1. 检查登录状态
    if (!user) {
      setShowLoginModal(true);
      return;
    }

    // 2. VIP/Pro 用户直接下载（白名单在服务端处理，profile 已反映真实状态）
    if (profile?.membership_type === 'vip' || profile?.membership_type === 'pro') {
      await doExportPDF();
      return;
    }

    // 3. 免费用户弹出付费弹窗
    setShowDownloadModal(true);
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
      setError(err.message || '精简失败，请重试');
    } finally {
      setIsCondensing(false);
    }
  };

  // 保存/更新简历到简历库（所有登录用户均可使用）
  const handleSaveResume = async () => {
    if (!user || !editableResume) return;

    setIsSavingResume(true);
    setSaveSuccess(false);

    try {
      if (currentSavedResumeId) {
        // 更新已有简历
        const { success, error: err } = await updateSavedResume(currentSavedResumeId, {
          resumeMarkdown: editableResume,
          englishResumeMarkdown: englishResume || undefined,
          jobDescription: jd || undefined,
          aspiration: aspiration || undefined,
          densityMultiplier,
        });
        if (!success) throw new Error(err);
      } else {
        // 新建保存
        const title = extractResumeTitle(editableResume, jd);
        const { data, error: err } = await createSavedResume({
          userId: user.id,
          title,
          resumeMarkdown: editableResume,
          englishResumeMarkdown: englishResume || undefined,
          jobDescription: jd || undefined,
          aspiration: aspiration || undefined,
          densityMultiplier,
          source: 'reconstruction',
        });
        if (err || !data) throw new Error(err || '保存失败');
        setCurrentSavedResumeId(data.id);
      }
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
    setEditableResume(resume.resume_markdown);
    setEnglishResume(resume.english_resume_markdown || '');
    setJd(resume.job_description || '');
    setAspiration(resume.aspiration || '');
    setDensityMultiplier(resume.density_multiplier || 1.0);
    // 清理旧状态
    setDiagnosisContent('');
    setResumeContent('');
    setError(null);
    setShowPhotoPanel(false);
    setIsFullscreen(false);
    setPreviewScale(0.65);
    setStep('EDITOR');
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
    // 单页实际可用高度 = 内容区高度 + 容差（与分页判定逻辑一致）
    const effectivePageHeight = CONTENT_HEIGHT_PER_PAGE + PAGE_TOLERANCE;
    
    if (pageCount === 1) {
      // 单页：百分比 = 内容高度 / 可用高度
      const percentage = Math.round((resumeHeight / effectivePageHeight) * 100);
      if (percentage <= 100) return { status: 'optimal', label: '1 页', percentage };
      return { status: 'overflow', label: '溢出', percentage };
    } else {
      // 多页：百分比 = 内容高度 / (页数 * 可用高度)，表示当前内容占总可用空间的比例
      // 同时也显示超出单页的百分比
      const overflowPercentage = Math.round((resumeHeight / effectivePageHeight) * 100);
      return { 
        status: 'danger', 
        label: `${pageCount} 页`, 
        percentage: overflowPercentage,
        pageCount 
      };
    }
  };
  const capacity = getCapacityStatus();

  return (
    <div className="min-h-screen flex flex-col bg-white font-sans text-zinc-900 selection:bg-zinc-900 selection:text-white">
      
      {/* --- HEADER --- */}
      <header className={`fixed top-0 w-full z-50 transition-all duration-300 ${step === 'INPUT' ? 'bg-white/90 backdrop-blur-sm py-5' : 'bg-white border-b border-zinc-200 py-3'}`}>
        <div className="container mx-auto px-6 flex items-center justify-between max-w-6xl">
          <button onClick={resetAll} className="flex items-center hover:opacity-70 transition-opacity">
             <span className="text-[18px] font-medium tracking-wide text-zinc-700" style={{ fontFamily: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif" }}>
               Offerin
             </span>
          </button>

          {step !== 'INPUT' && (
            <div className="hidden md:flex items-center gap-1 text-[13px] text-zinc-400">
              <button onClick={() => setStep('INPUT')} className={`px-2 py-1 rounded transition-colors hover:text-zinc-600`}>首页</button>
              <span className="text-zinc-300 mx-1">|</span>
              <button onClick={() => setStep('UPLOAD')} className={`px-2 py-1 rounded transition-colors ${step === 'UPLOAD' ? 'text-zinc-900 font-medium' : 'hover:text-zinc-600'}`}>简历输入</button>
              <span className="text-zinc-300 mx-0.5">→</span>
              <button onClick={() => diagnosisContent && setStep('ANALYSIS')} className={`px-2 py-1 rounded transition-colors ${step === 'ANALYSIS' ? 'text-zinc-900 font-medium' : diagnosisContent ? 'hover:text-zinc-600' : 'text-zinc-300 cursor-not-allowed'}`}>诊断</button>
              <span className="text-zinc-300 mx-0.5">→</span>
              <button onClick={() => editableResume && setStep('EDITOR')} className={`px-2 py-1 rounded transition-colors ${step === 'EDITOR' ? 'text-zinc-900 font-medium' : editableResume ? 'hover:text-zinc-600' : 'text-zinc-300 cursor-not-allowed'}`}>编辑</button>
              <span className="text-zinc-300 mx-0.5">→</span>
              <button onClick={() => englishResume && setStep('ENGLISH_VERSION')} className={`px-2 py-1 rounded transition-colors ${step === 'ENGLISH_VERSION' ? 'text-zinc-900 font-medium' : englishResume ? 'hover:text-zinc-600' : 'text-zinc-300 cursor-not-allowed'}`}>英文版</button>
              <span className="text-zinc-300 mx-1">|</span>
              <button onClick={() => setStep('INTERVIEW')} className={`px-2 py-1 rounded transition-colors flex items-center gap-1 ${step === 'INTERVIEW' ? 'text-zinc-900 font-medium' : 'hover:text-zinc-600'}`}>
                <Mic size={11} />
                模拟面试
              </button>
              <span className="text-zinc-300 mx-1">|</span>
              <button onClick={() => requireLogin(() => setStep('RESUME_LIBRARY'))} className={`px-2 py-1 rounded transition-colors flex items-center gap-1 ${step === 'RESUME_LIBRARY' ? 'text-zinc-900 font-medium' : 'hover:text-zinc-600'}`}>
                <FolderOpen size={11} />
                简历库
              </button>
            </div>
          )}
          
          <div className="flex items-center gap-3">
            {step !== 'INPUT' && (
              <button onClick={resetAll} className="text-[13px] text-zinc-400 hover:text-zinc-900 transition-colors flex items-center gap-1.5">
                <RefreshCw size={13} />
                <span className="hidden sm:inline">重置</span>
              </button>
            )}

            <UserAvatar 
              onLoginClick={() => setShowLoginModal(true)} 
              onUpgradeClick={() => setShowVIPModal(true)}
              onResumeLibrary={() => requireLogin(() => setStep('RESUME_LIBRARY'))}
              onInterviewLibrary={() => requireLogin(() => setStep('INTERVIEW_LIBRARY'))}
            />
          </div>
        </div>
      </header>

      {/* 登录弹窗 */}
      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />

      {/* VIP 升级弹窗 */}
      <VIPUpgradeModal 
        isOpen={showVIPModal} 
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
        onUpgradeVIP={() => setShowVIPModal(true)}
      />

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
                  setShowVIPModal(true);
                }}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg text-sm font-medium text-white hover:from-amber-600 hover:to-orange-600 transition-colors"
              >
                升级 VIP
              </button>
            </div>
          </div>
        </div>
      )}

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
                从简历诊断到模拟面试，全方位助力你的求职之旅
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

              {/* 功能板块 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left items-stretch">
                
                {/* 板块一：简历优化 */}
                <button 
                  onClick={() => requireLogin(() => setStep('UPLOAD'))}
                  className="rounded-xl border border-zinc-200 bg-white overflow-hidden text-left hover:border-zinc-300 hover:shadow-lg transition-all duration-300 group flex flex-col h-full hover:-translate-y-1"
                >
                  <div className="px-5 py-4 bg-zinc-50 border-b border-zinc-100 group-hover:bg-zinc-100 transition-colors">
                    <div className="flex items-center gap-2">
                      <FileText size={18} className="text-zinc-600" />
                      <h2 className="font-display font-semibold text-[16px] text-zinc-800">简历优化</h2>
                      <ArrowRight size={16} className="text-zinc-300 ml-auto group-hover:translate-x-1 group-hover:text-zinc-600 transition-all" />
                    </div>
                    <p className="text-[12px] text-zinc-400 mt-1">智能诊断 · AI 优化 · 逐句精调 · 英文翻译 · 简历库</p>
                  </div>
                  <div className="p-5 space-y-4 flex-1 flex flex-col">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-100/50 transition-colors">
                      <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center shrink-0">
                        <Target size={16} className="text-zinc-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[13px] text-zinc-900 mb-0.5">智能诊断</h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          基于目标 JD 进行匹配度分析，提供评分、能力差距识别及 ATS 关键词建议
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-100/50 transition-colors">
                      <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center shrink-0">
                        <PenTool size={16} className="text-zinc-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[13px] text-zinc-900 mb-0.5">AI 优化 & 精调</h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          基于诊断结果智能优化简历，支持选中任意文本逐句 AI 精调，实时预览与 PDF 导出
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-100/50 transition-colors">
                      <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center shrink-0">
                        <Globe size={16} className="text-zinc-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[13px] text-zinc-900 mb-0.5">英文版本</h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          一键生成专业英文简历，遵循硅谷标准格式，助力外企与海外求职
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-100/50 transition-colors flex-1">
                      <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center shrink-0">
                        <FolderOpen size={16} className="text-zinc-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[13px] text-zinc-900 mb-0.5">简历库</h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          云端保存多版本简历，支持收藏、复制、重命名，随时打开继续编辑
                        </p>
                      </div>
                    </div>
                  </div>
                </button>

                {/* 板块二：模拟面试 */}
                <button 
                  onClick={() => requireLogin(() => setStep('INTERVIEW'))}
                  className="rounded-xl border border-zinc-200 bg-white overflow-hidden text-left hover:border-zinc-300 hover:shadow-lg transition-all duration-300 group flex flex-col h-full hover:-translate-y-1"
                >
                  <div className="px-5 py-4 bg-zinc-50 border-b border-zinc-100 group-hover:bg-zinc-100 transition-colors">
                    <div className="flex items-center gap-2">
                      <Mic size={18} className="text-zinc-600" />
                      <h2 className="font-display font-semibold text-[16px] text-zinc-800">模拟面试</h2>
                      <ArrowRight size={16} className="text-zinc-300 ml-auto group-hover:translate-x-1 group-hover:text-zinc-600 transition-all" />
                    </div>
                    <p className="text-[12px] text-zinc-400 mt-1">纯模拟观摩 · 人机交互练习 · 五轮全流程 · 谈薪指导</p>
                  </div>
                  <div className="p-5 space-y-4 flex-1 flex flex-col">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-100/50 transition-colors">
                      <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center shrink-0">
                        <Play size={16} className="text-zinc-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[13px] text-zinc-900 mb-0.5">纯模拟模式</h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          AI 同时扮演面试官和面试者，自动多轮问答，适合观摩学习标准回答
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-100/50 transition-colors">
                      <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center shrink-0">
                        <Users size={16} className="text-zinc-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[13px] text-zinc-900 mb-0.5">人机交互模式</h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          AI 提问你来回答，每轮获得即时点评反馈，真实模拟面试场景
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-100/50 transition-colors">
                      <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center shrink-0">
                        <Briefcase size={16} className="text-zinc-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[13px] text-zinc-900 mb-0.5">五轮全流程模拟</h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          真实模拟 TA→Peers→+1→+2→HRBP 完整面试链路
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-100/50 transition-colors flex-1">
                      <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center shrink-0">
                        <Target size={16} className="text-zinc-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[13px] text-zinc-900 mb-0.5">谈薪博弈指导</h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          HRBP 轮含薪资谈判模拟，提供策略建议与话术参考
                        </p>
                      </div>
                    </div>
                  </div>
                </button>

              </div>

              {/* 使用方式介绍 */}
              <div className="mt-20 pt-16 border-t border-zinc-200">
                <h2 className="font-display text-[24px] font-semibold text-zinc-900 mb-3">
                  如何使用 Offerin
                </h2>
                <p className="text-zinc-500 text-[14px] mb-12 max-w-2xl mx-auto">
                  两种使用路径，满足不同求职阶段的需求
                </p>

                {/* 路径一：完整流程 - 推荐 */}
                <div className="bg-gradient-to-b from-zinc-50 to-zinc-100/50 border-2 border-zinc-200 rounded-2xl p-6 md:p-8 mb-6 text-left shadow-sm">
                  <div className="flex flex-wrap items-center gap-3 mb-6">
                    <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center text-white font-semibold text-[14px] shrink-0">
                      1
                    </div>
                    <h3 className="text-zinc-800 font-semibold text-[16px] md:text-[18px]">推荐路径：简历优化 → 模拟面试</h3>
                    <span className="px-3 py-1 bg-zinc-900 text-white text-[12px] rounded-full font-medium shrink-0">
                      ✨ 最佳体验
                    </span>
                    <button 
                      onClick={() => requireLogin(() => setStep('UPLOAD'))}
                      className="w-full md:w-auto md:ml-auto group inline-flex items-center justify-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg text-[13px] font-medium hover:bg-zinc-800 transition-all"
                    >
                      <FileText size={14} />
                      开始诊断
                      <ArrowRight size={14} className="opacity-60 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
                    {/* 步骤 1 */}
                    <div className="bg-white rounded-xl p-4 md:p-5 relative border border-zinc-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                      <div className="absolute -top-3 left-3 md:left-4 px-2 py-0.5 bg-zinc-800 text-white text-[10px] md:text-[11px] rounded font-medium">
                        STEP 1
                      </div>
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-zinc-100 flex items-center justify-center mb-2 md:mb-3">
                        <Target size={18} className="text-zinc-600" />
                      </div>
                      <h4 className="text-zinc-800 font-medium text-[13px] md:text-[14px] mb-1 md:mb-2">上传 JD + 简历</h4>
                      <p className="text-zinc-500 text-[11px] md:text-[12px] leading-relaxed">
                        目标岗位 JD + 当前简历
                      </p>
                    </div>

                    {/* 步骤 2 */}
                    <div className="bg-white rounded-xl p-4 md:p-5 relative border border-zinc-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                      <div className="absolute -top-3 left-3 md:left-4 px-2 py-0.5 bg-zinc-800 text-white text-[10px] md:text-[11px] rounded font-medium">
                        STEP 2
                      </div>
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-zinc-100 flex items-center justify-center mb-2 md:mb-3">
                        <AlertTriangle size={18} className="text-zinc-600" />
                      </div>
                      <h4 className="text-zinc-800 font-medium text-[13px] md:text-[14px] mb-1 md:mb-2">AI 诊断</h4>
                      <p className="text-zinc-500 text-[11px] md:text-[12px] leading-relaxed">
                        匹配度分析，识别硬伤与亮点
                      </p>
                    </div>

                    {/* 步骤 3 */}
                    <div className="bg-white rounded-xl p-4 md:p-5 relative border border-zinc-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                      <div className="absolute -top-3 left-3 md:left-4 px-2 py-0.5 bg-zinc-800 text-white text-[10px] md:text-[11px] rounded font-medium">
                        STEP 3
                      </div>
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-zinc-100 flex items-center justify-center mb-2 md:mb-3">
                        <PenTool size={18} className="text-zinc-600" />
                      </div>
                      <h4 className="text-zinc-800 font-medium text-[13px] md:text-[14px] mb-1 md:mb-2">AI 优化 & 精调</h4>
                      <p className="text-zinc-500 text-[11px] md:text-[12px] leading-relaxed">
                        智能优化，逐句精调
                      </p>
                    </div>

                    {/* 步骤 4 */}
                    <div className="bg-white rounded-xl p-4 md:p-5 relative border border-zinc-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                      <div className="absolute -top-3 left-3 md:left-4 px-2 py-0.5 bg-zinc-800 text-white text-[10px] md:text-[11px] rounded font-medium">
                        STEP 4
                      </div>
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-zinc-100 flex items-center justify-center mb-2 md:mb-3">
                        <Globe size={18} className="text-zinc-600" />
                      </div>
                      <h4 className="text-zinc-800 font-medium text-[13px] md:text-[14px] mb-1 md:mb-2">英文版 (可选)</h4>
                      <p className="text-zinc-500 text-[11px] md:text-[12px] leading-relaxed">
                        一键生成专业英文简历
                      </p>
                    </div>
                  </div>

                  {/* 补充提示 */}
                  <div className="mt-5 md:mt-6 pt-4 md:pt-5 border-t border-zinc-200/80 space-y-2">
                    <p className="text-zinc-500 text-[12px] md:text-[13px] flex items-start md:items-center gap-2">
                      <FolderOpen size={14} className="text-zinc-400 shrink-0 mt-0.5 md:mt-0" />
                      <span>优化后的简历可保存至<span className="text-zinc-700 font-medium">简历库</span>，支持多版本管理、收藏和随时编辑</span>
                    </p>
                    <p className="text-zinc-500 text-[12px] md:text-[13px] flex items-start md:items-center gap-2">
                      <Mic size={14} className="text-zinc-400 shrink-0 mt-0.5 md:mt-0" />
                      <span>完成优化后，可直接进入模拟面试，简历和 JD 将自动填入</span>
                    </p>
                  </div>
                </div>

                {/* 路径二：直接面试 */}
                <div className="bg-white border border-zinc-200 rounded-2xl p-6 md:p-8 text-left">
                  <div className="flex flex-wrap items-center gap-3 mb-6">
                    <div className="w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center text-zinc-600 font-semibold text-[14px] shrink-0">
                      2
                    </div>
                    <h3 className="text-zinc-800 font-semibold text-[16px] md:text-[18px]">快速路径：直接模拟面试</h3>
                    <span className="px-3 py-1 bg-zinc-100 text-zinc-500 text-[12px] rounded-full font-medium shrink-0">
                      ⚡ 快速开始
                    </span>
                    <button 
                      onClick={() => requireLogin(() => setStep('INTERVIEW'))}
                      className="w-full md:w-auto md:ml-auto group inline-flex items-center justify-center gap-2 px-4 py-2 bg-white text-zinc-700 border border-zinc-300 rounded-lg text-[13px] font-medium hover:border-zinc-400 hover:shadow-sm transition-all"
                    >
                      <Mic size={14} />
                      开始面试
                      <ArrowRight size={14} className="text-zinc-400 group-hover:text-zinc-600 group-hover:translate-x-0.5 transition-all" />
                    </button>
                  </div>
                  
                  <p className="text-zinc-500 text-[13px] md:text-[14px] leading-relaxed mb-5">
                    跳过简历优化，直接输入 JD 和简历开始模拟面试
                  </p>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-[12px] text-zinc-600">
                      <Play size={14} className="text-zinc-400 shrink-0" />
                      <span>纯模拟观摩</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-[12px] text-zinc-600">
                      <Users size={14} className="text-zinc-400 shrink-0" />
                      <span>人机交互练习</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-[12px] text-zinc-600">
                      <Target size={14} className="text-zinc-400 shrink-0" />
                      <span>五轮全流程</span>
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg text-[12px] text-zinc-600">
                      <Briefcase size={14} className="text-zinc-400 shrink-0" />
                      <span>谈薪博弈指导</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 会员体系介绍 - 紧凑版，两侧对齐 */}
              <div className="mt-16 pt-12 border-t border-zinc-200">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Crown size={18} className="text-zinc-600" />
                  <h2 className="font-display text-[20px] font-semibold text-zinc-800">
                    会员体系
                  </h2>
                </div>
                <p className="text-zinc-500 text-[13px] mb-8">
                  选择适合你的方案，开启高效求职之旅
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-2xl mx-auto">
                  {/* 免费用户 */}
                  <div className="bg-white border border-zinc-200 rounded-xl p-5 text-left flex flex-col hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-9 h-9 bg-zinc-100 rounded-lg flex items-center justify-center">
                        <Users size={18} className="text-zinc-500" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-[15px] text-zinc-800">免费用户</h3>
                        <p className="text-[11px] text-zinc-400">体验核心功能</p>
                      </div>
                    </div>
                    
                    <div className="space-y-2.5 mb-5 flex-grow">
                      <div className="flex items-center gap-2.5 text-[13px] text-zinc-600">
                        <span className="w-5 h-5 rounded bg-zinc-100 flex items-center justify-center text-[10px] font-semibold text-zinc-500 shrink-0">3</span>
                        <span>简历诊断 + 全局重构 共3次体验</span>
                      </div>
                      <div className="flex items-center gap-2.5 text-[13px] text-zinc-600">
                        <span className="w-5 h-5 rounded bg-zinc-100 flex items-center justify-center text-[10px] font-semibold text-zinc-500 shrink-0">1</span>
                        <span>模拟面试 独立1次体验</span>
                      </div>
                      <div className="flex items-center gap-2.5 text-[13px] text-zinc-600">
                        <span className="w-5 h-5 rounded bg-zinc-100 flex items-center justify-center text-[10px] font-semibold text-zinc-500 shrink-0">3</span>
                        <span>英文简历翻译 共3次体验</span>
                      </div>
                      <div className="flex items-center gap-2.5 text-[13px] text-zinc-600">
                        <span className="w-5 h-5 rounded bg-zinc-100 flex items-center justify-center text-[10px] font-semibold text-zinc-500 shrink-0">¥</span>
                        <span>PDF 导出 ¥4.9/次</span>
                      </div>
                      <div className="flex items-center gap-2.5 text-[13px] text-zinc-600">
                        <span className="w-5 h-5 rounded bg-zinc-100 flex items-center justify-center text-[10px] font-semibold text-zinc-500 shrink-0">¥</span>
                        <span>面试记录保存 ¥4.9/次</span>
                      </div>
                      <div className="flex items-center gap-2.5 text-[13px] text-zinc-600">
                        <span className="w-5 h-5 rounded bg-zinc-100 flex items-center justify-center shrink-0">
                          <CheckCircle2 size={10} className="text-zinc-500" />
                        </span>
                        <span>简历库 云端保存与管理</span>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-zinc-100">
                      <div className="text-[22px] font-bold text-zinc-800">免费</div>
                      <p className="text-[11px] text-zinc-400">适合初次体验</p>
                    </div>
                  </div>

                  {/* VIP 会员 - 浅灰背景，琥珀色仅用于按钮 */}
                  <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-5 text-left relative flex flex-col hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
                    {/* 推荐标签 */}
                    <div className="absolute top-4 right-4 px-2 py-0.5 bg-zinc-900 text-white text-[10px] font-semibold rounded">
                      推荐
                    </div>
                    
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="w-9 h-9 bg-zinc-900 rounded-lg flex items-center justify-center">
                        <Crown size={18} className="text-white" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-[15px] text-zinc-800">VIP 会员</h3>
                        <p className="text-[11px] text-zinc-500">解锁全部功能</p>
                      </div>
                    </div>
                    
                    <div className="space-y-2.5 mb-5 flex-grow">
                      <div className="flex items-center gap-2.5 text-[13px] text-zinc-700">
                        <span className="w-5 h-5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                          <CheckCircle2 size={12} className="text-zinc-600" />
                        </span>
                        <span>简历诊断 <span className="text-zinc-900 font-semibold">50次/天</span></span>
                      </div>
                      <div className="flex items-center gap-2.5 text-[13px] text-zinc-700">
                        <span className="w-5 h-5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                          <CheckCircle2 size={12} className="text-zinc-600" />
                        </span>
                        <span>模拟面试 <span className="text-zinc-900 font-semibold">10次/月</span></span>
                      </div>
                      <div className="flex items-center gap-2.5 text-[13px] text-zinc-700">
                        <span className="w-5 h-5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                          <CheckCircle2 size={12} className="text-zinc-600" />
                        </span>
                        <span>英文简历翻译 <span className="text-zinc-900 font-semibold">无限</span></span>
                      </div>
                      <div className="flex items-center gap-2.5 text-[13px] text-zinc-700">
                        <span className="w-5 h-5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                          <CheckCircle2 size={12} className="text-zinc-600" />
                        </span>
                        <span>PDF 导出 <span className="text-zinc-900 font-semibold">无限</span></span>
                      </div>
                      <div className="flex items-center gap-2.5 text-[13px] text-zinc-700">
                        <span className="w-5 h-5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                          <CheckCircle2 size={12} className="text-zinc-600" />
                        </span>
                        <span>面试记录保存 <span className="text-zinc-900 font-semibold">无限</span></span>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-zinc-200">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[22px] font-bold text-zinc-800">¥29.9</span>
                        <span className="text-zinc-500 text-[13px]">/月</span>
                        <span className="text-zinc-400 line-through text-[13px] ml-1">¥39.9</span>
                      </div>
                      <p className="text-[11px] text-zinc-500">高效求职必备</p>
                    </div>

                    <button 
                      onClick={() => {
                        if (!user) {
                          setShowLoginModal(true);
                        } else {
                          setShowVIPModal(true);
                        }
                      }}
                      className="w-full mt-4 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg text-[13px] font-medium transition-colors flex items-center justify-center gap-2"
                    >
                      <Crown size={14} />
                      立即开通
                    </button>
                  </div>
                </div>
              </div>

              {/* 即将上线 - 会员专属功能预告 */}
              <div className="mt-20 pt-16 border-t border-zinc-200">
                <div className="flex items-center justify-center gap-3 mb-3">
                  <Sparkles size={20} className="text-amber-500" />
                  <h2 className="font-display text-[24px] font-semibold text-zinc-900">
                    会员专属 · 敬请期待
                  </h2>
                  <Sparkles size={20} className="text-amber-500" />
                </div>
                <p className="text-zinc-500 text-[14px] mb-10 max-w-2xl mx-auto">
                  更多智能功能正在紧锣密鼓开发中，VIP 会员将优先体验
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
                  {/* 功能一：智能 JD 推荐 */}
                  <div className="bg-zinc-50/80 border border-zinc-200 rounded-2xl p-6 text-left relative overflow-hidden group hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                    {/* 装饰背景 */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-zinc-200/20 rounded-full blur-3xl -mr-16 -mt-16" />
                    
                    {/* 即将上线标签 */}
                    <div className="absolute top-4 right-4 px-2.5 py-1 bg-zinc-800 text-white text-[10px] font-semibold rounded-full flex items-center gap-1">
                      <Sparkles size={10} />
                      即将上线
                    </div>
                    
                    <div className="relative">
                      <div className="w-11 h-11 bg-zinc-800 rounded-xl flex items-center justify-center mb-4">
                        <Target size={22} className="text-white" />
                      </div>
                      
                      <h3 className="font-semibold text-[17px] text-zinc-800 mb-2">
                        🔍 智能 JD 推荐
                      </h3>
                      <p className="text-zinc-500 text-[13px] leading-relaxed mb-4">
                        基于你的简历和求职意向，AI 全网搜索最匹配的岗位，一键定制针对性简历
                      </p>
                      
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                          <div className="w-4.5 h-4.5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                            <CheckCircle2 size={11} className="text-zinc-500" />
                          </div>
                          <span>覆盖 Boss直聘、猎聘、脉脉等主流平台</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                          <div className="w-4.5 h-4.5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                            <CheckCircle2 size={11} className="text-zinc-500" />
                          </div>
                          <span>字节、腾讯、阿里等大厂官网岗位直达</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                          <div className="w-4.5 h-4.5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                            <CheckCircle2 size={11} className="text-zinc-500" />
                          </div>
                          <span>AI 匹配度评分，精准推荐 20+ 优质岗位</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                          <div className="w-4.5 h-4.5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                            <CheckCircle2 size={11} className="text-zinc-500" />
                          </div>
                          <span>选中心仪岗位，一键生成定制简历</span>
                        </div>
                      </div>

                      {/* 预览卡片 */}
                      <div className="mt-4 p-2.5 bg-white border border-zinc-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="w-5 h-5 bg-zinc-800 rounded flex items-center justify-center">
                            <Briefcase size={10} className="text-white" />
                          </div>
                          <span className="text-[11px] font-medium text-zinc-700">字节跳动 · 产品经理</span>
                          <span className="ml-auto text-[9px] px-1.5 py-0.5 bg-zinc-100 text-zinc-600 rounded font-medium">匹配度 92%</span>
                        </div>
                        <p className="text-[10px] text-zinc-400">📍 北京 · 30-50K · 3-5年经验</p>
                      </div>
                    </div>
                  </div>

                  {/* 功能二：摸鱼小精灵 */}
                  <div className="bg-zinc-50/80 border border-zinc-200 rounded-2xl p-6 text-left relative overflow-hidden group hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                    {/* 装饰背景 */}
                    <div className="absolute top-0 right-0 w-32 h-32 bg-zinc-200/20 rounded-full blur-3xl -mr-16 -mt-16" />
                    
                    {/* 即将上线标签 */}
                    <div className="absolute top-4 right-4 px-2.5 py-1 bg-zinc-800 text-white text-[10px] font-semibold rounded-full flex items-center gap-1">
                      <Sparkles size={10} />
                      即将上线
                    </div>
                    
                    <div className="relative">
                      <div className="w-11 h-11 bg-zinc-800 rounded-xl flex items-center justify-center mb-4">
                        <MessageSquare size={22} className="text-white" />
                      </div>
                      
                      <h3 className="font-semibold text-[17px] text-zinc-800 mb-2">
                        👻 摸鱼搭子
                      </h3>
                      <p className="text-zinc-500 text-[13px] leading-relaxed mb-4">
                        懂梗会整活的桌面小精灵，上班摸鱼解闷、划水聊天、吐槽搭子
                      </p>
                      
                      <div className="space-y-2">
                        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                          <div className="w-4.5 h-4.5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                            <CheckCircle2 size={11} className="text-zinc-500" />
                          </div>
                          <span>摸鱼搭子 · 上班最佳电子宠物</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                          <div className="w-4.5 h-4.5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                            <CheckCircle2 size={11} className="text-zinc-500" />
                          </div>
                          <span>嘴替担当 · 帮你怼天怼地怼需求</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                          <div className="w-4.5 h-4.5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                            <CheckCircle2 size={11} className="text-zinc-500" />
                          </div>
                          <span>互联网嘴替 · 懂梗会整活不尬聊</span>
                        </div>
                        <div className="flex items-center gap-2 text-[12px] text-zinc-500">
                          <div className="w-4.5 h-4.5 rounded bg-zinc-200 flex items-center justify-center shrink-0">
                            <CheckCircle2 size={11} className="text-zinc-500" />
                          </div>
                          <span>定时抖动 · 每 30 分钟蹦跶提醒你它在</span>
                        </div>
                      </div>

                      {/* 对话预览 */}
                      <div className="mt-4 p-2.5 bg-white border border-zinc-200 rounded-lg space-y-1.5">
                        <div className="flex items-start gap-1.5">
                          <span className="text-[12px]">👻</span>
                          <div className="bg-zinc-50 rounded px-2 py-1 text-[10px] text-zinc-600">
                            bro 醒醒，摸鱼时间到 🐟
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5 justify-end">
                          <div className="bg-zinc-100 rounded px-2 py-1 text-[10px] text-zinc-600">
                            我真的会谢，又改需求
                          </div>
                          <span className="text-[12px]">💀</span>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <span className="text-[12px]">👻</span>
                          <div className="bg-zinc-50 rounded px-2 py-1 text-[10px] text-zinc-600">
                            绷不住了 😂 你们 PM 是不是每天摇骰子定需求
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 底部提示 - 移到最底部 */}
              <div className="mt-12 pt-8 border-t border-zinc-100 flex items-center justify-center gap-6 text-[12px] text-zinc-500 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-zinc-400" />
                  AI 智能诊断与优化
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-zinc-400" />
                  五轮面试全流程模拟
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-zinc-400" />
                  简历库多版本管理
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 size={14} className="text-zinc-400" />
                  支持导出 PDF/文本/图片
                </div>
              </div>

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
                  <div className="flex items-center justify-between">
                    <label className="text-[13px] font-medium text-zinc-900 flex items-center gap-1.5">
                      <Target size={13} className="text-zinc-400" />
                      目标岗位 JD
                    </label>
                    <button onClick={() => jdFileInputRef.current?.click()} disabled={processingState.jd} className={`text-[12px] text-zinc-400 hover:text-zinc-900 font-medium flex items-center gap-1 transition-colors ${processingState.jd ? 'opacity-50 cursor-not-allowed' : ''}`}>
                      <Upload size={11} /> 上传文件
                    </button>
                  </div>
                  {/* JD 完整度提示 */}
                  <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
                    <p className="text-[11px] text-amber-700 leading-relaxed">
                      <span className="font-semibold">💡 提示：</span>请提供尽可能<span className="font-semibold">详细、完整</span>的 JD 内容（包括岗位职责、任职要求、团队介绍等），这将帮助 AI 更精准地优化你的简历。
                    </p>
                  </div>
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
                  <div className="flex items-center justify-between">
                    <label className="text-[13px] font-medium text-zinc-900 flex items-center gap-1.5">
                      <FileText size={13} className="text-zinc-400" />
                      你的简历
                    </label>
                    <button onClick={() => resumeFileInputRef.current?.click()} disabled={processingState.resume} className={`text-[12px] text-zinc-400 hover:text-zinc-900 font-medium flex items-center gap-1 transition-colors ${processingState.resume ? 'opacity-50 cursor-not-allowed' : ''}`}>
                      <Upload size={11} /> 上传文件
                    </button>
                  </div>
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
              <div className="px-6 md:px-8 py-4 bg-zinc-50 border-t border-zinc-100 flex items-center justify-between">
                <span className="text-[11px] text-zinc-400">
                  分析约需 30 秒，请耐心等待
                </span>
                <button
                  onClick={handleAnalysis}
                  disabled={isAnalyzing || processingState.jd || processingState.resume}
                  className={`px-6 py-2.5 rounded-md flex items-center gap-2 text-[13px] font-medium transition-all ${isAnalyzing || processingState.jd || processingState.resume ? 'bg-zinc-200 text-zinc-400 cursor-not-allowed' : 'bg-zinc-900 text-white hover:bg-zinc-800'}`}
                >
                  {isAnalyzing ? <Loader2 className="animate-spin" size={15} /> : <Send size={15} />}
                  <span>{isAnalyzing ? '分析中...' : '开始分析'}</span>
                </button>
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
              <div className="px-6 py-4 flex items-center justify-between border-b border-zinc-100">
                <div className="flex items-center gap-3">
                  <h2 className="font-display font-semibold text-[15px] text-zinc-900">诊断报告</h2>
                  {isAnalyzing && (
                    <span className="flex items-center gap-1.5 text-[12px] text-zinc-400">
                      <Loader2 size={12} className="animate-spin" />
                      生成中...
                    </span>
                  )}
                </div>
                <button onClick={cancelAnalysisAndGoBack} className="text-[12px] text-zinc-400 hover:text-zinc-900 transition-colors">
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
                        disabled={isRewriting && !editableResume}
                        className={`group px-6 py-4 rounded-lg text-[13px] font-medium flex flex-col items-center gap-2 transition-all min-w-[200px] ${
                          isRewriting && !editableResume
                            ? 'bg-zinc-700 cursor-wait' 
                            : editableResume
                              ? 'bg-zinc-900 hover:bg-zinc-800'
                              : 'bg-zinc-700 cursor-wait'
                        } text-white`}
                      >
                        {isRewriting && !editableResume ? (
                          <Loader2 size={18} className="text-zinc-300 animate-spin" />
                        ) : editableResume ? (
                          <Sparkles size={18} className="text-zinc-300" />
                        ) : (
                          <Loader2 size={18} className="text-zinc-300 animate-spin" />
                        )}
                        <span>{editableResume ? '查看优化结果' : '优化中...'}</span>
                        <span className="text-[11px] text-zinc-400 font-normal">{editableResume ? '简历已优化完成，点击查看并精调' : '请稍候，AI 正在后台优化简历'}</span>
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
          <div className={`flex flex-col lg:flex-row gap-4 ${isFullscreen ? 'fixed inset-0 z-50 bg-zinc-100 p-4' : 'h-[calc(100vh-120px)]'}`}>
            
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
            <div className={`flex flex-col bg-white rounded-lg border border-zinc-200 overflow-hidden no-print transition-all duration-300 ${isFullscreen ? 'hidden' : 'w-full lg:w-1/2'}`}>
              <div className="bg-zinc-50 px-5 py-2.5 border-b border-zinc-200 flex justify-between items-center">
                 <span className="text-[13px] font-medium text-zinc-900 flex items-center gap-1.5">
                   <PenTool size={13} className="text-zinc-400" /> 
                   {step === 'ENGLISH_VERSION' ? '英文编辑器' : '编辑器'}
                 </span>
                 
                 <div className="flex items-center gap-2">
                   {step === 'EDITOR' ? (
                     <>
                       <div className="relative">
                         <button 
                           onClick={() => setShowPhotoPanel(!showPhotoPanel)}
                           className={`flex items-center gap-1 text-[12px] px-2 py-1 rounded transition-colors ${
                             getPhotoUrlFromMarkdown(editableResume)
                               ? 'text-green-600 bg-green-50 hover:bg-green-100'
                               : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'
                           }`}
                           title="添加简历照片"
                         >
                           <ImageIcon size={11} />
                           照片
                         </button>
                         {showPhotoPanel && (
                           <PhotoUploadPanel
                             userId={user?.id}
                             currentPhotoUrl={getPhotoUrlFromMarkdown(editableResume)}
                             onPhotoChange={handlePhotoChange}
                             onClose={() => setShowPhotoPanel(false)}
                           />
                         )}
                       </div>
                       <span className="text-zinc-200">|</span>
                       <button onClick={() => setStep('ANALYSIS')} className="text-[12px] text-zinc-400 hover:text-zinc-900 flex items-center gap-1 transition-colors">
                         <ArrowLeft size={11} /> 诊断
                       </button>
                       <span className="text-zinc-200">|</span>
                       <button 
                         onClick={() => englishResume ? setStep('ENGLISH_VERSION') : generateTranslation()}
                         disabled={isTranslating}
                         className={`flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded transition-colors ${englishResume ? 'text-zinc-600 hover:text-zinc-900' : 'bg-zinc-900 text-white hover:bg-zinc-800'}`}
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
                         className={`flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded transition-colors ${
                           saveSuccess 
                             ? 'bg-green-50 text-green-600 border border-green-200' 
                             : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
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
                            className={`flex items-center gap-1 text-[12px] px-2 py-1 rounded transition-colors ${
                              getPhotoUrlFromMarkdown(englishResume)
                                ? 'text-green-600 bg-green-50 hover:bg-green-100'
                                : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'
                            }`}
                            title="添加简历照片"
                          >
                            <ImageIcon size={11} />
                            照片
                          </button>
                          {showPhotoPanel && (
                            <PhotoUploadPanel
                              userId={user?.id}
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
                           className={`flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded transition-colors ${
                             saveSuccess 
                               ? 'bg-green-50 text-green-600 border border-green-200' 
                               : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
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

            {/* Preview */}
            <div className={`flex flex-col transition-all duration-300 ${isFullscreen ? 'w-full h-full pt-14' : 'w-full lg:w-1/2'}`}>
               
               {/* Toolbar */}
               <div className="bg-white px-4 py-2.5 rounded-t-lg flex flex-wrap gap-y-2 justify-between items-center no-print border border-zinc-200 border-b-0">
                 <div className="flex items-center gap-3 flex-1">
                    <span className="text-[13px] font-medium text-zinc-900 flex items-center gap-1.5 whitespace-nowrap mr-2">
                      <FileText size={13} className="text-zinc-400" /> 预览
                    </span>
                    
                    {/* Capacity */}
                    <span className={`text-[11px] px-2 py-0.5 rounded-sm font-medium ${
                      capacity.status === 'optimal' ? 'bg-green-50 text-green-600' : 
                      capacity.status === 'overflow' ? 'bg-orange-50 text-orange-600' :
                      'bg-red-50 text-red-600'
                    }`}>
                       {capacity.percentage}% · {capacity.label}
                    </span>

                    {/* Density */}
                    <div className="flex items-center gap-1.5 ml-3 flex-1 max-w-[120px]">
                      <AlignJustify size={12} className="text-zinc-300" />
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
            onShowVIPModal={() => setShowVIPModal(true)}
            viewingRecord={viewingInterviewRecord}
          />
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
         </footer>
      )}
    </div>
  );
};

export default App;
