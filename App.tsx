
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { analyzeResumeStream, translateResume, FileData, extractTextFromFile } from './services/geminiService';
import MarkdownRenderer from './components/MarkdownRenderer';
import InterviewChat from './components/InterviewChat';
import { LoginModal, UserAvatar } from './components/LoginModal';
import { useAuth } from './contexts/AuthContext';
import { checkUsageLimit, logUsage } from './services/authService';
import { FileText, Target, Send, Loader2, RefreshCw, ChevronRight, Upload, X, Paperclip, Image as ImageIcon, File, AlertCircle, PenTool, ArrowLeft, Maximize2, Minimize2, ZoomIn, ZoomOut, CheckCircle2, AlertTriangle, AlignJustify, Languages, Globe, ArrowRight, Sparkles, MessageSquare, Mic, Play, Users, Lock, Briefcase } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

type Step = 'INPUT' | 'UPLOAD' | 'ANALYSIS' | 'EDITOR' | 'ENGLISH_VERSION' | 'INTERVIEW';

const App: React.FC = () => {
  const { user, profile, loading: authLoading } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [usageLimitError, setUsageLimitError] = useState<string | null>(null);
  
  const [step, setStep] = useState<Step>('INPUT');

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
  
  const [isTranslating, setIsTranslating] = useState(false);
  
  const [diagnosisContent, setDiagnosisContent] = useState<string>('');
  const [resumeContent, setResumeContent] = useState<string>('');

  const [editableResume, setEditableResume] = useState('');
  const [englishResume, setEnglishResume] = useState('');

  const [previewScale, setPreviewScale] = useState(0.65);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  const [densityMultiplier, setDensityMultiplier] = useState<number>(1.0); 
  const [resumeHeight, setResumeHeight] = useState<number>(0);
  
  const jdFileInputRef = useRef<HTMLInputElement>(null);
  const resumeFileInputRef = useRef<HTMLInputElement>(null);
  const inputSectionRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const A4_WIDTH_PX = 794;
  const A4_HEIGHT_PX = 1123; 
  
  const PAGE_PADDING_TOP = 24; 
  const PAGE_PADDING_BOTTOM = 40; 
  const PAGINATION_SAFETY_BUFFER = 5; 

  useEffect(() => {
    if (step !== 'EDITOR' && step !== 'ENGLISH_VERSION') return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setResumeHeight(entry.contentRect.height);
      }
    });

    const target = document.querySelector('#resume-preview-content');
    if (target) {
      observer.observe(target);
    }

    return () => observer.disconnect();
  }, [step, editableResume, englishResume, densityMultiplier]);

  const scrollToInput = () => {
    inputSectionRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const compressImage = (file: File): Promise<{data: string, mime: string}> => {
    return new Promise((resolve, reject) => {
      // PDF 文件处理
      if (file.type === 'application/pdf') {
         if (file.size > 10 * 1024 * 1024) { 
           reject(new Error('PDF文件过大，请上传小于10MB的文件'));
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
        if (file.size > 10 * 1024 * 1024) { 
          reject(new Error('Word文件过大，请上传小于10MB的文件'));
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
      setUsageLimitError(`今日免费次数已用完（${limitCheck.limit}次/天）。升级 VIP 解锁无限使用！`);
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
      
      // 使用流式并行请求
      await analyzeResumeStream(
        jd, 
        resume, 
        aspiration,
        {
          onDiagnosisChunk: (chunk) => {
            // 检查是否已被取消
            if (abortController.signal.aborted) return;
            setDiagnosisContent(prev => prev + chunk);
          },
          onResumeChunk: (chunk) => {
            // 检查是否已被取消
            if (abortController.signal.aborted) return;
            setResumeContent(prev => prev + chunk);
          },
          onDiagnosisComplete: (content) => {
            // 诊断完成，记录使用
            if (user) {
              logUsage(user.id, 'diagnosis');
            }
          },
          onResumeComplete: (content) => {
            // 简历完成
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
      if (msg === 'ENTITY_NOT_FOUND') {
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
    
    setIsTranslating(true);
    try {
      const result = await translateResume(editableResume);
      setEnglishResume(result);
      setStep('ENGLISH_VERSION');
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
    setError(null);
    setStep('INPUT');
    setPreviewScale(0.65);
    setIsFullscreen(false);
    setDensityMultiplier(1.0);
    setEnglishResume('');
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
    setEditableResume(resumeContent);
    setStep('EDITOR');
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

  const preparePaginatedDom = async (sourceElement: HTMLElement) => {
    const shadowContainer = document.createElement('div');
    shadowContainer.style.position = 'absolute';
    shadowContainer.style.top = '-10000px';
    shadowContainer.style.left = '0';
    shadowContainer.style.width = `${A4_WIDTH_PX}px`; 
    const computedStyle = window.getComputedStyle(sourceElement);
    shadowContainer.style.fontFamily = computedStyle.fontFamily;
    shadowContainer.style.fontSize = computedStyle.fontSize;
    shadowContainer.style.lineHeight = computedStyle.lineHeight;
    shadowContainer.style.color = computedStyle.color;
    shadowContainer.style.boxSizing = 'border-box'; 
    shadowContainer.className = sourceElement.className; 

    const contentClone = sourceElement.cloneNode(true) as HTMLElement;
    contentClone.style.transform = 'none';
    contentClone.style.margin = '0';
    contentClone.style.padding = `${PAGE_PADDING_TOP}px 40px ${PAGE_PADDING_BOTTOM}px 40px`; 
    contentClone.style.minHeight = 'auto'; 
    contentClone.style.boxShadow = 'none';
    contentClone.style.backgroundColor = '#ffffff';
    contentClone.style.width = '100%';
    contentClone.style.boxSizing = 'border-box';
    
    // 确保所有子元素的 line-height 被正确设置，防止文字重叠
    const allElements = contentClone.querySelectorAll('*');
    allElements.forEach((el) => {
      const elem = el as HTMLElement;
      const elStyle = window.getComputedStyle(elem);
      // 强制设置 line-height 为计算后的像素值，避免 html2canvas 渲染问题
      if (elStyle.lineHeight && elStyle.lineHeight !== 'normal') {
        elem.style.lineHeight = elStyle.lineHeight;
      }
      // 确保 margin 和 padding 被保留
      if (elStyle.marginTop) elem.style.marginTop = elStyle.marginTop;
      if (elStyle.marginBottom) elem.style.marginBottom = elStyle.marginBottom;
      if (elStyle.paddingTop) elem.style.paddingTop = elStyle.paddingTop;
      if (elStyle.paddingBottom) elem.style.paddingBottom = elStyle.paddingBottom;
    });
    
    shadowContainer.appendChild(contentClone);
    document.body.appendChild(shadowContainer);

    await waitForImages(contentClone);
    
    return { shadowContainer, contentClone };
  };

  const handleExportImage = async () => {
    const wrapper = document.getElementById('resume-preview-content');
    const element = wrapper?.firstElementChild as HTMLElement;
    if (!element) return;
    
    setIsGeneratingFile(true);
    const { shadowContainer, contentClone } = await preparePaginatedDom(element);

    try {
      const canvas = await html2canvas(contentClone, {
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
      if (document.body.contains(shadowContainer)) {
        document.body.removeChild(shadowContainer);
      }
      setIsGeneratingFile(false);
    }
  };

  const handleExportPDF = async () => {
    const wrapper = document.getElementById('resume-preview-content');
    const element = wrapper?.firstElementChild as HTMLElement;
    if (!element) return;

    setIsGeneratingFile(true);
    const { shadowContainer, contentClone } = await preparePaginatedDom(element);

    try {
      const canvas = await html2canvas(contentClone, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: A4_WIDTH_PX,
        windowWidth: 1024
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = 210; 
      const pdfHeight = 297;
      const imgProps = pdf.getImageProperties(imgData);
      const imgHeightInPdf = (imgProps.height * pdfWidth) / imgProps.width;
      
      let heightLeft = imgHeightInPdf;
      let position = 0;
      
      pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeightInPdf);
      heightLeft -= pdfHeight;

      while (heightLeft > 5) { 
        position -= pdfHeight; 
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, pdfWidth, imgHeightInPdf);
        heightLeft -= pdfHeight;
      }
      
      pdf.save(getResumeFileName('pdf'));
    } catch (e) {
      console.error('PDF export failed', e);
      alert('PDF 生成失败，请重试');
    } finally {
      if (document.body.contains(shadowContainer)) {
        document.body.removeChild(shadowContainer);
      }
      setIsGeneratingFile(false);
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
    const percentage = (resumeHeight / A4_HEIGHT_PX) * 100;
    if (percentage <= 95) return { status: 'optimal', label: '1 页' };  // 最佳状态，绿色
    if (percentage <= 100) return { status: 'warning', label: '1 页' }; // 接近满页，橙色警告（>95%）
    if (percentage <= 110) return { status: 'overflow', label: '溢出' }; // 轻微溢出
    return { status: 'danger', label: '超 1 页' };  // 严重超出
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
            </div>
          )}
          
          <div className="flex items-center gap-3">
            {step !== 'INPUT' && (
              <button onClick={resetAll} className="text-[13px] text-zinc-400 hover:text-zinc-900 transition-colors flex items-center gap-1.5">
                <RefreshCw size={13} />
                <span className="hidden sm:inline">重置</span>
              </button>
            )}

            <UserAvatar onLoginClick={() => setShowLoginModal(true)} />
          </div>
        </div>
      </header>

      {/* 登录弹窗 */}
      <LoginModal isOpen={showLoginModal} onClose={() => setShowLoginModal(false)} />

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
                  // TODO: 跳转到升级页面
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
              <h1 className="font-display text-[38px] md:text-[48px] font-semibold tracking-tight text-zinc-900 mb-5 leading-[1.15]">
                AI 简历优化与面试模拟
              </h1>
              <p className="text-zinc-500 text-[15px] font-normal max-w-xl mx-auto mb-12 leading-relaxed">
                从简历诊断到模拟面试，全方位助力你的求职之旅
              </p>

              {/* 功能板块 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left items-stretch">
                
                {/* 板块一：简历优化 */}
                <button 
                  onClick={() => requireLogin(() => setStep('UPLOAD'))}
                  className="rounded-xl border border-zinc-200 bg-white overflow-hidden text-left hover:border-zinc-300 hover:shadow-sm transition-all group flex flex-col h-full"
                >
                  <div className="px-5 py-4 bg-zinc-50 border-b border-zinc-100 group-hover:bg-zinc-100 transition-colors">
                    <div className="flex items-center gap-2">
                      <FileText size={18} className="text-zinc-500" />
                      <h2 className="font-display font-semibold text-[16px] text-zinc-800">简历优化</h2>
                      <ArrowRight size={16} className="text-zinc-300 ml-auto group-hover:translate-x-1 group-hover:text-zinc-400 transition-all" />
                    </div>
                    <p className="text-[12px] text-zinc-400 mt-1">智能诊断 · AI 重写 · 英文翻译</p>
                  </div>
                  <div className="p-5 space-y-4 flex-1 flex flex-col">
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-50 transition-colors">
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
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-50 transition-colors">
                      <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center shrink-0">
                        <PenTool size={16} className="text-zinc-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[13px] text-zinc-900 mb-0.5">AI 重构</h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          STAR 法则重写经历，实时编辑预览，支持排版密度调节与 PDF 导出
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-50 transition-colors flex-1">
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
                  </div>
                </button>

                {/* 板块二：模拟面试 */}
                <button 
                  onClick={() => requireLogin(() => setStep('INTERVIEW'))}
                  className="rounded-xl border border-zinc-200 bg-white overflow-hidden text-left hover:border-zinc-300 hover:shadow-sm transition-all group flex flex-col h-full"
                >
                  <div className="px-5 py-4 bg-zinc-50 border-b border-zinc-100 group-hover:bg-zinc-100 transition-colors">
                    <div className="flex items-center gap-2">
                      <Mic size={18} className="text-zinc-500" />
                      <h2 className="font-display font-semibold text-[16px] text-zinc-800">模拟面试</h2>
                      <ArrowRight size={16} className="text-zinc-300 ml-auto group-hover:translate-x-1 group-hover:text-zinc-400 transition-all" />
                    </div>
                    <p className="text-[12px] text-zinc-400 mt-1">纯模拟观摩 · 人机交互练习</p>
                  </div>
                  <div className="p-5 space-y-4 flex-1 flex flex-col">
                    <div className="flex items-start gap-3 p-3 pr-8 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-50 transition-colors">
                      <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center shrink-0">
                        <Play size={16} className="text-zinc-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[13px] text-zinc-900 mb-0.5">纯模拟模式</h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          AI 同时扮演面试官和面试者，自动进行多轮问答，适合观摩学习标准回答
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3 p-3 pr-8 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-50 transition-colors">
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
                    <div className="flex items-start gap-3 p-3 pr-8 rounded-lg bg-zinc-50/50 group-hover:bg-zinc-50 transition-colors flex-1">
                      <div className="w-8 h-8 rounded-md bg-zinc-100 flex items-center justify-center shrink-0">
                        <Briefcase size={16} className="text-zinc-600" />
                      </div>
                      <div>
                        <h3 className="font-medium text-[13px] text-zinc-900 mb-0.5">多轮次场景模拟</h3>
                        <p className="text-[12px] text-zinc-500 leading-relaxed">
                          真实模拟 TA→Peers→+1→+2→HRBP 全流程，含谈薪博弈指导
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
                <div className="bg-gradient-to-b from-zinc-50 to-zinc-100/50 border-2 border-zinc-200 rounded-2xl p-8 mb-6 text-left shadow-sm">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center text-white font-semibold text-[14px]">
                      1
                    </div>
                    <h3 className="text-zinc-800 font-semibold text-[18px]">推荐路径：简历优化 → 模拟面试</h3>
                    <span className="px-3 py-1 bg-zinc-900 text-white text-[12px] rounded-full font-medium">
                      ✨ 最佳体验
                    </span>
                    <button 
                      onClick={() => requireLogin(() => setStep('UPLOAD'))}
                      className="ml-auto group inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded-lg text-[13px] font-medium hover:bg-zinc-800 transition-all"
                    >
                      <FileText size={14} />
                      开始诊断
                      <ArrowRight size={14} className="opacity-60 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* 步骤 1 */}
                    <div className="bg-white rounded-xl p-5 relative border border-zinc-200 shadow-sm">
                      <div className="absolute -top-3 left-4 px-2 py-0.5 bg-zinc-800 text-white text-[11px] rounded font-medium">
                        STEP 1
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center mb-3">
                        <Target size={20} className="text-zinc-600" />
                      </div>
                      <h4 className="text-zinc-800 font-medium text-[14px] mb-2">上传 JD + 简历</h4>
                      <p className="text-zinc-500 text-[12px] leading-relaxed">
                        找到心仪的目标岗位 JD，上传当前版本的简历
                      </p>
                    </div>

                    {/* 步骤 2 */}
                    <div className="bg-white rounded-xl p-5 relative border border-zinc-200 shadow-sm">
                      <div className="absolute -top-3 left-4 px-2 py-0.5 bg-zinc-800 text-white text-[11px] rounded font-medium">
                        STEP 2
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center mb-3">
                        <AlertTriangle size={20} className="text-zinc-600" />
                      </div>
                      <h4 className="text-zinc-800 font-medium text-[14px] mb-2">AI 诊断问题</h4>
                      <p className="text-zinc-500 text-[12px] leading-relaxed">
                        智能分析匹配度，识别简历硬伤和潜在亮点
                      </p>
                    </div>

                    {/* 步骤 3 */}
                    <div className="bg-white rounded-xl p-5 relative border border-zinc-200 shadow-sm">
                      <div className="absolute -top-3 left-4 px-2 py-0.5 bg-zinc-800 text-white text-[11px] rounded font-medium">
                        STEP 3
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center mb-3">
                        <PenTool size={20} className="text-zinc-600" />
                      </div>
                      <h4 className="text-zinc-800 font-medium text-[14px] mb-2">优化 & 编辑</h4>
                      <p className="text-zinc-500 text-[12px] leading-relaxed">
                        AI 重写简历，支持实时编辑、调整密度、保存 PDF
                      </p>
                    </div>

                    {/* 步骤 4 */}
                    <div className="bg-white rounded-xl p-5 relative border border-zinc-200 shadow-sm">
                      <div className="absolute -top-3 left-4 px-2 py-0.5 bg-zinc-800 text-white text-[11px] rounded font-medium">
                        STEP 4
                      </div>
                      <div className="w-10 h-10 rounded-lg bg-zinc-100 flex items-center justify-center mb-3">
                        <Globe size={20} className="text-zinc-600" />
                      </div>
                      <h4 className="text-zinc-800 font-medium text-[14px] mb-2">英文版 (可选)</h4>
                      <p className="text-zinc-500 text-[12px] leading-relaxed">
                        一键生成专业英文简历，适合外企和海外申请
                      </p>
                    </div>
                  </div>

                  {/* 进入面试提示 - 简化版 */}
                  <div className="mt-6 pt-5 border-t border-zinc-200/80">
                    <p className="text-zinc-500 text-[13px] flex items-center gap-2">
                      <Mic size={14} className="text-zinc-400" />
                      完成优化后，可直接进入模拟面试，简历和 JD 将自动填入
                    </p>
                  </div>
                </div>

                {/* 路径二：直接面试 */}
                <div className="bg-white border border-zinc-200 rounded-2xl p-8 text-left">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center text-zinc-600 font-semibold text-[14px]">
                      2
                    </div>
                    <h3 className="text-zinc-800 font-semibold text-[18px]">快速路径：直接模拟面试</h3>
                    <span className="px-3 py-1 bg-zinc-100 text-zinc-500 text-[12px] rounded-full font-medium">
                      ⚡ 快速开始
                    </span>
                    <button 
                      onClick={() => requireLogin(() => setStep('INTERVIEW'))}
                      className="ml-auto group inline-flex items-center gap-2 px-4 py-2 bg-white text-zinc-700 border border-zinc-300 rounded-lg text-[13px] font-medium hover:border-zinc-400 hover:shadow-sm transition-all"
                    >
                      <Mic size={14} />
                      开始面试
                      <ArrowRight size={14} className="text-zinc-400 group-hover:translate-x-0.5 transition-transform" />
                    </button>
                  </div>
                  
                  <p className="text-zinc-500 text-[14px] leading-relaxed mb-5">
                    跳过简历优化，直接输入 JD 和简历开始模拟面试
                  </p>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
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
                    <div className="flex items-center gap-2 px-3 py-2.5 bg-zinc-100 border border-zinc-300 rounded-lg text-[12px] text-zinc-700 font-medium">
                      <Briefcase size={14} className="text-zinc-500 shrink-0" />
                      <span>谈薪博弈指导</span>
                    </div>
                  </div>
                </div>

                {/* 底部提示 */}
                <div className="mt-10 flex items-center justify-center gap-6 text-[12px] text-zinc-400">
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    AI 智能诊断与优化
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    五轮面试全流程模拟
                  </div>
                  <div className="flex items-center gap-1.5">
                    <CheckCircle2 size={14} className="text-emerald-500" />
                    支持导出 PDF/文本/图片
                  </div>
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
                
                {!isAnalyzing && diagnosisContent && resumeContent && (
                  <div className="mt-12 flex justify-center pb-6 border-t border-zinc-100 pt-8">
                     <button 
                       onClick={handleProceedToEditor}
                       className="bg-zinc-900 hover:bg-zinc-800 text-white px-6 py-2.5 rounded-md text-[13px] font-medium flex items-center gap-2 transition-all"
                     >
                       进入编辑器
                       <ArrowRight size={15} />
                     </button>
                  </div>
                )}
                
                {isAnalyzing && diagnosisContent && (
                  <div className="mt-8 flex justify-center">
                    <span className="text-[12px] text-zinc-400 flex items-center gap-2">
                      <Loader2 size={12} className="animate-spin" />
                      简历重构中，请稍候...
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Step 3 & 4: Editor + Preview */}
        {(step === 'EDITOR' || step === 'ENGLISH_VERSION') && (
          <div className={`flex flex-col lg:flex-row gap-4 ${isFullscreen ? 'fixed inset-0 z-50 bg-white p-4' : 'h-[calc(100vh-120px)]'}`}>
            
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
                     </>
                   ) : (
                     <>
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
                     </>
                   )}
                 </div>
              </div>
              <textarea 
                className="flex-grow p-5 resize-none focus:outline-none bg-white text-[13px] font-mono leading-relaxed text-zinc-800 selection:bg-zinc-200"
                value={step === 'ENGLISH_VERSION' ? englishResume : editableResume}
                onChange={(e) => step === 'ENGLISH_VERSION' ? setEnglishResume(e.target.value) : setEditableResume(e.target.value)}
                placeholder={step === 'ENGLISH_VERSION' ? "在此编辑英文简历..." : "在此编辑 Markdown 简历..."}
                spellCheck={false}
              />
            </div>

            {/* Preview */}
            <div className={`flex flex-col transition-all duration-300 ${isFullscreen ? 'w-full h-full' : 'w-full lg:w-1/2'}`}>
               
               {/* Toolbar */}
               <div className="bg-white px-4 py-2.5 rounded-t-lg flex flex-wrap gap-y-2 justify-between items-center no-print border border-zinc-200 border-b-0">
                 <div className="flex items-center gap-3 flex-1">
                    <span className="text-[13px] font-medium text-zinc-900 flex items-center gap-1.5 whitespace-nowrap mr-2">
                      <FileText size={13} className="text-zinc-400" /> 预览
                    </span>
                    
                    {/* Capacity */}
                    <span className={`text-[11px] px-2 py-0.5 rounded-sm font-medium ${
                      capacity.status === 'optimal' ? 'bg-green-50 text-green-600' : 
                      capacity.status === 'warning' ? 'bg-amber-50 text-amber-600' : 
                      capacity.status === 'overflow' ? 'bg-orange-50 text-orange-600' :
                      'bg-red-50 text-red-600'
                    }`}>
                       {Math.round((resumeHeight/A4_HEIGHT_PX)*100)}% · {capacity.label}
                       {capacity.status === 'warning' && ' ⚠️'}
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
                     onClick={handleExportImage}
                     disabled={isGeneratingFile}
                     className="text-[12px] text-zinc-500 hover:text-zinc-900 px-2 py-1 rounded transition-colors flex items-center gap-1"
                   >
                     {isGeneratingFile ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
                     <span className="hidden lg:inline">图片</span>
                   </button>

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
                
                {/* 顶部提示：页面警告优先显示，否则显示占位符提示（仅当内容包含 X% 时） */}
                {capacity.status === 'warning' ? (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-amber-500 text-white text-[11px] px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 whitespace-nowrap">
                       <AlertTriangle size={12} /> 接近满页，建议精简内容避免打印分页
                    </div>
                ) : (capacity.status === 'overflow' || capacity.status === 'danger') ? (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-zinc-900 text-white text-[11px] px-3 py-1.5 rounded-md font-medium flex items-center gap-1.5 whitespace-nowrap">
                       <AlertTriangle size={12} /> 内容超出 1 页
                    </div>
                ) : (step === 'ENGLISH_VERSION' ? englishResume : editableResume).includes('X%') ? (
                    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-blue-50 text-blue-700 text-[11px] px-3 py-1.5 rounded-md font-medium border border-blue-200 whitespace-nowrap">
                       <span className="inline-flex items-center gap-1.5">
                         <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                         简历中的 <strong className="text-blue-800">X%</strong> 等数据为占位符，请根据实际情况修改
                       </span>
                    </div>
                ) : null}

                 <div className="flex justify-center min-w-min"> 
                   <div 
                     id="resume-preview" 
                     className="bg-white shadow-sm transition-transform origin-top duration-200 ease-out relative"
                     style={{
                       width: '794px', 
                       minHeight: '1123px', 
                       padding: '24px 40px', 
                       boxSizing: 'border-box',
                       transform: `scale(${previewScale})`,
                       transformOrigin: 'top center',
                     }}
                   >
                      <div id="resume-preview-content">
                        <div className="text-slate-900">
                           <MarkdownRenderer content={step === 'ENGLISH_VERSION' ? englishResume : editableResume} isResumePreview={true} densityMultiplier={densityMultiplier} mode="resume" />
                        </div>
                      </div>
                      
                      <div className="absolute left-0 w-full border-b border-dashed border-zinc-300/50 pointer-events-none flex items-end justify-end px-2 text-zinc-300/60 text-[9px] font-mono tracking-widest" style={{ top: '1123px' }}>P.1</div>
                      <div className="absolute left-0 w-full border-b border-dashed border-zinc-300/50 pointer-events-none flex items-end justify-end px-2 text-zinc-300/60 text-[9px] font-mono tracking-widest" style={{ top: '2246px' }}>P.2</div>
                   </div>
                 </div>
               </div>
            </div>
          </div>
        )}

        {/* Step 5: Interview */}
        {step === 'INTERVIEW' && (
          <InterviewChat 
            onBack={() => setStep('INPUT')} 
            initialResume={editableResume || resume}
            initialJd={jd}
          />
        )}
      </main>

      {step === 'INPUT' && (
         <footer className="py-5 text-center text-zinc-300 text-[11px] tracking-wide bg-white no-print">
            Offerin
         </footer>
      )}
    </div>
  );
};

export default App;
