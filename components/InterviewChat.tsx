
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Briefcase, User, Hash, Info, AlertCircle, Award, 
  Send, Square, Plus, X, FileText, Upload, Settings,
  Download, RefreshCw, Loader2, ArrowLeft, ChevronDown, Image as ImageIcon,
  Play, MessageSquare, Users, Mic, MicOff, StopCircle, CheckCircle2, File, Paperclip, Lock, Crown
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import html2canvas from 'html2canvas';
import type { InterviewMessage, InterviewSettings, InterviewStatus, InterviewMode, InterviewerRole, InterviewSupplementInfo } from '../types';
import { 
  runInterview, 
  exportInterviewRecord, 
  generateFirstQuestion, 
  processUserAnswer,
  InteractiveInterviewState 
} from '../services/interviewService';
import { transcribeAudio, extractTextFromFile } from '../services/geminiService';
import { useAuth } from '../contexts/AuthContext';
import { checkUsageLimit, logUsage, checkInterviewExportPermission } from '../services/authService';

// 文件数据类型
interface FileData {
  name: string;
  data: string;
  mime: string;
}

interface InterviewChatProps {
  onBack: () => void;
  initialResume?: string;
  initialJd?: string;
  initialJdFile?: FileData | null;
  initialResumeFile?: FileData | null;
  onShowVIPModal?: () => void;
}

const InterviewChat: React.FC<InterviewChatProps> = ({ 
  onBack, 
  initialResume = '', 
  initialJd = '',
  initialJdFile = null,
  initialResumeFile = null,
  onShowVIPModal
}) => {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [settings, setSettings] = useState<InterviewSettings>({
    totalRounds: 8,
    interviewerRole: 'peers',
    mode: 'simulation'
  });
  const [showSettings, setShowSettings] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<InterviewStatus>('idle');
  
  // 使用限制相关状态
  const [usageLimitError, setUsageLimitError] = useState<string | null>(null);
  const [showUpgradeHint, setShowUpgradeHint] = useState(false);
  
  const [resumeText, setResumeText] = useState(initialResume);
  const [jdText, setJdText] = useState(initialJd);
  const [showInputPanel, setShowInputPanel] = useState(!initialResume && !initialResumeFile);
  
  // 文件上传相关状态
  const [resumeFile, setResumeFile] = useState<FileData | null>(initialResumeFile);
  const [jdFile, setJdFile] = useState<FileData | null>(initialJdFile);
  const [processingState, setProcessingState] = useState({ resume: false, jd: false });
  const [fileError, setFileError] = useState<string | null>(null);
  const resumeFileInputRef = useRef<HTMLInputElement>(null);
  const jdFileInputRef = useRef<HTMLInputElement>(null);
  
  // 补充信息状态（薪资、到岗时间等）
  const [supplementInfo, setSupplementInfo] = useState<InterviewSupplementInfo>({
    currentSalary: '',
    expectedSalary: '',
    availableTime: '',
    otherInfo: ''
  });
  const [showSupplementInfo, setShowSupplementInfo] = useState(true);
  
  // 人机交互模式状态
  const [interactiveState, setInteractiveState] = useState<InteractiveInterviewState | null>(null);
  const [userInput, setUserInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // 语音录制状态（使用 Gemini API）
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const inputTextareaRef = useRef<HTMLTextAreaElement>(null);

  // 开始录音
  const startRecording = useCallback(async () => {
    try {
      // 首先检查浏览器是否支持 MediaDevices API
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('您的浏览器不支持录音功能，请使用 Chrome 或 Safari 浏览器');
      }

      // 检查是否有可用的音频输入设备
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputDevices = devices.filter(device => device.kind === 'audioinput');
        console.log('Available audio input devices:', audioInputDevices);
        
        if (audioInputDevices.length === 0) {
          throw new Error('未找到麦克风设备，请连接麦克风后重试');
        }
      } catch (enumError) {
        console.warn('Could not enumerate devices:', enumError);
        // 继续尝试获取麦克风，因为某些浏览器可能不支持枚举但支持录音
      }

      // 请求麦克风权限，使用更宽松的约束
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        } 
      });
      micStreamRef.current = stream;
      
      // 创建音频分析器来显示音量
      const audioContext = new AudioContext();
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      
      // 创建 MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });
      
      audioChunksRef.current = [];
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        // 停止音量检测
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
        }
        
        // 合并音频数据
        const audioBlob = new Blob(audioChunksRef.current, { 
          type: mediaRecorder.mimeType 
        });
        
        // 停止麦克风
        if (micStreamRef.current) {
          micStreamRef.current.getTracks().forEach(track => track.stop());
          micStreamRef.current = null;
        }
        
        // 如果有录音数据，发送给 Gemini 转文字
        if (audioBlob.size > 0) {
          setIsTranscribing(true);
          try {
            await transcribeAudio(audioBlob, {
              onTranscribing: () => {
                console.log('Transcribing audio...');
              },
              onChunk: (text) => {
                // 流式更新文字
                setUserInput(prev => prev + text);
              },
              onComplete: (text) => {
                console.log('Transcription complete:', text);
                setIsTranscribing(false);
              },
              onError: (error) => {
                console.error('Transcription error:', error);
                setIsTranscribing(false);
                alert('语音转文字失败: ' + error);
              }
            });
          } catch (error) {
            console.error('Transcription failed:', error);
            setIsTranscribing(false);
          }
        }
        
        setRecordingTime(0);
        setAudioLevel(0);
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(100); // 每100ms收集一次数据
      setIsRecording(true);
      
      // 开始计时和音量检测
      let seconds = 0;
      recordingTimerRef.current = setInterval(() => {
        seconds++;
        setRecordingTime(seconds);
        
        // 检测音量
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
          setAudioLevel(average);
        }
      }, 1000);
      
      inputTextareaRef.current?.focus();
      
    } catch (error: any) {
      console.error('Failed to start recording:', error);
      
      // 根据错误类型给出更具体的提示
      let errorMessage = '无法启动录音';
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage = '未找到麦克风设备。请确保：\n1. 已连接麦克风\n2. 麦克风未被其他应用占用\n3. 系统已启用麦克风';
      } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage = '麦克风权限被拒绝。请在浏览器设置中允许访问麦克风，然后刷新页面重试';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage = '麦克风被其他应用占用。请关闭其他正在使用麦克风的应用后重试';
      } else if (error.name === 'OverconstrainedError') {
        errorMessage = '麦克风不满足要求，请尝试使用其他麦克风';
      } else if (error.name === 'TypeError') {
        errorMessage = '浏览器不支持录音功能';
      } else {
        errorMessage = `录音失败: ${error.message || '未知错误'}`;
      }
      
      alert(errorMessage);
    }
  }, []);

  // 停止录音
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  // 切换录音状态
  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // 清理录音资源
  useEffect(() => {
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 追踪是否已经提取过初始文件（防止重复提取）
  const hasExtractedInitialFilesRef = useRef(false);
  
  // 初始化时从传入的文件数据中提取文本（仅在组件首次挂载时执行一次）
  useEffect(() => {
    // 如果已经提取过，不再重复提取
    if (hasExtractedInitialFilesRef.current) return;
    
    const extractInitialFileText = async () => {
      let needExtract = false;
      
      // 如果有初始 JD 文件但没有 JD 文本，需要提取
      if (initialJdFile && !initialJd) {
        needExtract = true;
      }
      // 如果有初始简历文件但没有简历文本，需要提取
      if (initialResumeFile && !initialResume) {
        needExtract = true;
      }
      
      // 如果不需要提取，直接返回
      if (!needExtract) {
        hasExtractedInitialFilesRef.current = true;
        return;
      }
      
      // 标记已经开始提取
      hasExtractedInitialFilesRef.current = true;
      
      // 并行提取 JD 和简历文本
      const promises: Promise<void>[] = [];
      
      if (initialJdFile && !initialJd) {
        setProcessingState(prev => ({ ...prev, jd: true }));
        promises.push(
          extractTextFromFile({ 
            data: initialJdFile.data, 
            mimeType: initialJdFile.mime 
          }).then(extractedText => {
            if (extractedText && extractedText.trim()) {
              setJdText(extractedText);
            }
          }).catch(err => {
            console.error('Failed to extract JD text:', err);
          }).finally(() => {
            setProcessingState(prev => ({ ...prev, jd: false }));
          })
        );
      }
      
      if (initialResumeFile && !initialResume) {
        setProcessingState(prev => ({ ...prev, resume: true }));
        promises.push(
          extractTextFromFile({ 
            data: initialResumeFile.data, 
            mimeType: initialResumeFile.mime 
          }).then(extractedText => {
            if (extractedText && extractedText.trim()) {
              setResumeText(extractedText);
            }
          }).catch(err => {
            console.error('Failed to extract resume text:', err);
          }).finally(() => {
            setProcessingState(prev => ({ ...prev, resume: false }));
          })
        );
      }
      
      await Promise.all(promises);
    };
    
    extractInitialFileText();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅在组件挂载时执行一次

  // 点击外部关闭导出菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 纯模拟模式开始面试
  const handleStartSimulationInterview = useCallback(async () => {
    if (!resumeText.trim() || !jdText.trim()) {
      setMessages(prev => [...prev, {
        type: 'error',
        content: '请先输入简历和岗位 JD',
        timestamp: new Date().toISOString()
      }]);
      return;
    }

    // 检查使用限制
    if (user) {
      const limitCheck = await checkUsageLimit(user.id, 'interview', user.email || undefined);
      if (!limitCheck.allowed) {
        if (limitCheck.isTrialLimit) {
          setUsageLimitError(`免费体验次数已用完（共${limitCheck.limit}次）。升级 VIP 享每日50次使用！`);
        } else {
          setUsageLimitError(`今日使用次数已达上限（${limitCheck.limit}次/天）。`);
        }
        return;
      }
    }

    setStatus('running');
    setShowInputPanel(false);
    setMessages([]);
    
    abortControllerRef.current = new AbortController();

    try {
      // 记录使用
      if (user) {
        logUsage(user.id, 'interview');
      }

      await runInterview(
        resumeText,
        jdText,
        settings,
        {
          onMessage: (msg) => {
            setMessages(prev => {
              if (msg.isStreaming) {
                const lastIndex = prev.length - 1;
                if (lastIndex >= 0 && prev[lastIndex].type === msg.type && prev[lastIndex].isStreaming) {
                  const newMessages = [...prev];
                  newMessages[lastIndex] = msg;
                  return newMessages;
                }
              }
              if (!msg.isStreaming && prev.length > 0) {
                const lastIndex = prev.length - 1;
                if (prev[lastIndex].type === msg.type && prev[lastIndex].isStreaming) {
                  const newMessages = [...prev];
                  newMessages[lastIndex] = msg;
                  return newMessages;
                }
              }
              return [...prev, msg];
            });
          },
          onComplete: () => {
            setStatus('completed');
          },
          onError: (error) => {
            setMessages(prev => [...prev, {
              type: 'error',
              content: `面试出错: ${error}`,
              timestamp: new Date().toISOString()
            }]);
            setStatus('error');
          }
        },
        abortControllerRef.current.signal,
        // 只有填写了内容才传递补充信息
        (supplementInfo.currentSalary || supplementInfo.expectedSalary || supplementInfo.availableTime || supplementInfo.otherInfo) 
          ? supplementInfo 
          : undefined
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatus('stopped');
      }
    }
  }, [resumeText, jdText, settings, supplementInfo, user]);

  // 人机交互模式开始面试
  const handleStartInteractiveInterview = useCallback(async () => {
    if (!resumeText.trim() || !jdText.trim()) {
      setMessages(prev => [...prev, {
        type: 'error',
        content: '请先输入简历和岗位 JD',
        timestamp: new Date().toISOString()
      }]);
      return;
    }

    // 检查使用限制
    if (user) {
      const limitCheck = await checkUsageLimit(user.id, 'interview', user.email || undefined);
      if (!limitCheck.allowed) {
        if (limitCheck.isTrialLimit) {
          setUsageLimitError(`免费体验次数已用完（共${limitCheck.limit}次）。升级 VIP 享每日50次使用！`);
        } else {
          setUsageLimitError(`今日使用次数已达上限（${limitCheck.limit}次/天）。`);
        }
        return;
      }
    }

    setStatus('running');
    setShowInputPanel(false);
    setMessages([]);
    
    abortControllerRef.current = new AbortController();

    try {
      // 记录使用
      if (user) {
        logUsage(user.id, 'interview');
      }

      const state = await generateFirstQuestion(
        resumeText,
        jdText,
        settings,
        {
          onMessage: (msg) => {
            setMessages(prev => {
              if (msg.isStreaming) {
                const lastIndex = prev.length - 1;
                if (lastIndex >= 0 && prev[lastIndex].type === msg.type && prev[lastIndex].isStreaming) {
                  const newMessages = [...prev];
                  newMessages[lastIndex] = msg;
                  return newMessages;
                }
              }
              if (!msg.isStreaming && prev.length > 0) {
                const lastIndex = prev.length - 1;
                if (prev[lastIndex].type === msg.type && prev[lastIndex].isStreaming) {
                  const newMessages = [...prev];
                  newMessages[lastIndex] = msg;
                  return newMessages;
                }
              }
              return [...prev, msg];
            });
          },
          onComplete: () => {
            setStatus('completed');
          },
          onError: (error) => {
            setMessages(prev => [...prev, {
              type: 'error',
              content: `面试出错: ${error}`,
              timestamp: new Date().toISOString()
            }]);
            setStatus('error');
          },
          onWaitingForInput: () => {
            setStatus('waiting_input');
            // 聚焦输入框
            setTimeout(() => inputTextareaRef.current?.focus(), 100);
          }
        },
        abortControllerRef.current.signal,
        // 只有填写了内容才传递补充信息
        (supplementInfo.currentSalary || supplementInfo.expectedSalary || supplementInfo.availableTime || supplementInfo.otherInfo) 
          ? supplementInfo 
          : undefined
      );

      if (state) {
        setInteractiveState(state);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatus('stopped');
      }
    }
  }, [resumeText, jdText, settings, supplementInfo]);

  // 文件压缩和处理函数
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
          // 对于 Word 文档，我们将其作为 PDF 处理（Gemini 支持）
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

  // 处理文件上传
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
      setFileError('格式错误：目前支持 PDF、Word（.doc/.docx）、JPG、PNG 或 WebP。');
      return;
    }

    setProcessingState(prev => ({ ...prev, [type]: true }));
    setFileError(null);

    try {
      const { data, mime } = await compressImage(file);
      
      // 保存文件信息
      if (type === 'jd') {
        setJdFile({ name: file.name, data, mime });
      } else {
        setResumeFile({ name: file.name, data, mime });
      }
      
      // 自动提取文本内容（面试需要立即识别以便开始）
      const extractedText = await extractTextFromFile({ data, mimeType: mime });
      
      if (extractedText && extractedText.trim()) {
        if (type === 'jd') {
          setJdText(extractedText.trim());
        } else {
          setResumeText(extractedText.trim());
        }
      }
    } catch (err: any) {
      setFileError(err.message || '文件处理失败。');
    } finally {
      setProcessingState(prev => ({ ...prev, [type]: false }));
    }
  };

  // 处理粘贴图片
  const handlePaste = async (e: React.ClipboardEvent, type: 'jd' | 'resume') => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          setProcessingState(prev => ({ ...prev, [type]: true }));
          try {
            setFileError(null);
            const { data, mime } = await compressImage(file);
            const fileName = `pasted-image-${new Date().getTime()}.jpg`;
            
            // 保存文件信息
            if (type === 'jd') {
              setJdFile({ name: fileName, data, mime });
            } else {
              setResumeFile({ name: fileName, data, mime });
            }
            
            // 自动提取文本内容
            const extractedText = await extractTextFromFile({ data, mimeType: mime });
            
            if (extractedText && extractedText.trim()) {
              if (type === 'jd') {
                setJdText(extractedText.trim());
              } else {
                setResumeText(extractedText.trim());
              }
            }
          } catch (err: any) {
            setFileError('粘贴图片处理失败：' + err.message);
          } finally {
            setProcessingState(prev => ({ ...prev, [type]: false }));
          }
        }
      }
    }
  };

  // 文件标签组件
  const FileChip = ({ name, mime, onRemove, isLoading }: { name: string, mime: string, onRemove: () => void, isLoading?: boolean }) => {
    const getFileIcon = () => {
      if (mime.includes('image')) return <ImageIcon size={13} className="text-zinc-400" />;
      if (mime.includes('pdf')) return <File size={13} className="text-zinc-400" />;
      if (mime.includes('word') || mime.includes('document')) return <FileText size={13} className="text-zinc-400" />;
      return <Paperclip size={13} className="text-zinc-400" />;
    };

    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-md text-xs text-zinc-600 mt-2">
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

  // 开始面试（根据模式选择）
  const handleStartInterview = useCallback(() => {
    if (settings.mode === 'simulation') {
      handleStartSimulationInterview();
    } else {
      handleStartInteractiveInterview();
    }
  }, [settings.mode, handleStartSimulationInterview, handleStartInteractiveInterview]);

  // 提交用户回答（人机交互模式）
  const handleSubmitAnswer = useCallback(async () => {
    if (!userInput.trim() || !interactiveState || isSubmitting) return;

    setIsSubmitting(true);
    setStatus('running');
    const answer = userInput;
    setUserInput('');

    abortControllerRef.current = new AbortController();

    try {
      const newState = await processUserAnswer(
        interactiveState,
        answer,
        {
          onMessage: (msg) => {
            setMessages(prev => {
              if (msg.isStreaming) {
                const lastIndex = prev.length - 1;
                if (lastIndex >= 0 && prev[lastIndex].type === msg.type && prev[lastIndex].isStreaming) {
                  const newMessages = [...prev];
                  newMessages[lastIndex] = msg;
                  return newMessages;
                }
              }
              if (!msg.isStreaming && prev.length > 0) {
                const lastIndex = prev.length - 1;
                if (prev[lastIndex].type === msg.type && prev[lastIndex].isStreaming) {
                  const newMessages = [...prev];
                  newMessages[lastIndex] = msg;
                  return newMessages;
                }
              }
              return [...prev, msg];
            });
          },
          onComplete: () => {
            setStatus('completed');
            setInteractiveState(null);
          },
          onError: (error) => {
            setMessages(prev => [...prev, {
              type: 'error',
              content: `回答处理出错: ${error}`,
              timestamp: new Date().toISOString()
            }]);
            setStatus('error');
          },
          onWaitingForInput: () => {
            setStatus('waiting_input');
            setTimeout(() => inputTextareaRef.current?.focus(), 100);
          }
        },
        abortControllerRef.current.signal
      );

      if (newState) {
        setInteractiveState(newState);
      }
    } catch (error) {
      console.error('Submit answer error:', error);
    } finally {
      setIsSubmitting(false);
    }
  }, [userInput, interactiveState, isSubmitting]);

  // 键盘事件处理
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmitAnswer();
    }
  };

  const handleStopInterview = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStatus('stopped');
    setInteractiveState(null);
    setMessages(prev => [...prev, {
      type: 'system',
      content: '面试已停止',
      timestamp: new Date().toISOString()
    }]);
  };

  // 导出为 Markdown 文本
  const handleExportMarkdown = async () => {
    setShowExportMenu(false);
    
    // 检查导出权限
    if (user) {
      const exportCheck = await checkInterviewExportPermission(user.id, user.email || undefined);
      if (!exportCheck.allowed) {
        setUsageLimitError(exportCheck.reason || '面试记录导出为 VIP 专属功能，请升级会员');
        return;
      }
    } else {
      setUsageLimitError('请先登录后再导出面试记录');
      return;
    }
    
    const timestamp = new Date().toISOString().split('T')[0];
    const modeLabel = settings.mode === 'interactive' ? '人机交互' : '纯模拟';
    const roleLabels: Record<string, string> = {
      ta: '第一轮/TA',
      peers: '第二轮/Peers',
      leader: '第三轮/+1',
      director: '第四轮/+2',
      hrbp: '第五轮/HRBP'
    };
    
    let markdown = `# 模拟面试记录\n\n`;
    markdown += `- **日期**: ${timestamp}\n`;
    markdown += `- **模式**: ${modeLabel}\n`;
    markdown += `- **面试轮次**: ${roleLabels[settings.interviewerRole] || settings.interviewerRole}\n`;
    markdown += `- **对话轮数**: ${settings.totalRounds} 轮\n\n`;
    markdown += `---\n\n`;
    
    messages.forEach((msg) => {
      if (msg.type === 'round') {
        markdown += `### ${msg.content}\n\n`;
      } else if (msg.type === 'system') {
        markdown += `> 📌 ${msg.content}\n\n`;
      } else if (msg.type === 'interviewer') {
        markdown += `**🎤 面试官**:\n\n${msg.content}\n\n`;
      } else if (msg.type === 'interviewee') {
        markdown += `**👤 面试者**:\n\n${msg.content}\n\n`;
      } else if (msg.type === 'evaluation') {
        markdown += `---\n\n${msg.content}\n`;
      }
    });
    
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `面试记录_${modeLabel}_${timestamp}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  // 导出为图片
  const handleExportImage = async () => {
    if (!chatContainerRef.current) return;
    
    // 检查导出权限
    if (user) {
      const exportCheck = await checkInterviewExportPermission(user.id, user.email || undefined);
      if (!exportCheck.allowed) {
        setUsageLimitError(exportCheck.reason || '面试记录导出为 VIP 专属功能，请升级会员');
        return;
      }
    } else {
      setUsageLimitError('请先登录后再导出面试记录');
      return;
    }

    setIsExporting(true);
    setShowExportMenu(false);
    
    try {
      const element = chatContainerRef.current;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight
      });
      
      const imgData = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      const modeLabel = settings.mode === 'interactive' ? '人机交互' : '纯模拟';
      link.download = `面试记录_${modeLabel}_${new Date().toISOString().split('T')[0]}.png`;
      link.href = imgData;
      link.click();
    } catch (error) {
      console.error('Image export error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  const handleReset = () => {
    // 先中止正在进行的请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setMessages([]);
    setStatus('idle');
    setShowInputPanel(true);
    setInteractiveState(null);
    setUserInput('');
  };

  const renderMessage = (message: InterviewMessage, index: number) => {
    const { type, content, isStreaming } = message;

    if (type === 'round') {
      return (
        <div key={index} className="flex items-center justify-center gap-2 py-3 text-[12px] text-zinc-400">
          <Hash size={12} />
          <span>{content}</span>
        </div>
      );
    }

    if (type === 'system') {
      return (
        <div key={index} className="flex items-center justify-center gap-2 py-2 text-[12px] text-zinc-500">
          <Info size={12} />
          <span>{content}</span>
        </div>
      );
    }

    if (type === 'error') {
      return (
        <div key={index} className="flex items-center justify-center gap-2 py-2 px-4 mx-auto max-w-lg bg-red-50 border border-red-100 rounded-md text-[12px] text-red-600">
          <AlertCircle size={12} />
          <span>{content}</span>
        </div>
      );
    }

    if (type === 'user') {
      return (
        <div key={index} className="flex justify-end mb-4">
          <div className="max-w-[80%] bg-zinc-100 rounded-lg px-4 py-3">
            <div className="text-[11px] text-zinc-400 mb-1.5 font-medium">岗位 JD</div>
            <div className="text-[13px] text-zinc-800 prose prose-sm max-w-none prose-zinc">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          </div>
        </div>
      );
    }

    if (type === 'interviewer') {
      return (
        <div key={index} className="flex items-start gap-3 mb-4">
          <div className="shrink-0 w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center">
            <Briefcase size={14} />
          </div>
          <div className="flex-1 max-w-[80%]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[12px] font-medium text-zinc-700">面试官</span>
              {isStreaming && <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />}
            </div>
            <div className="bg-white border border-zinc-200 rounded-lg px-4 py-3">
              <div className="text-[13px] text-zinc-800 prose prose-sm max-w-none prose-zinc">
                <ReactMarkdown>{content || '...'}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (type === 'interviewee') {
      const isUserAnswer = settings.mode === 'interactive';
      return (
        <div key={index} className="flex items-start gap-3 mb-4 flex-row-reverse">
          <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center border ${
            isUserAnswer 
              ? 'bg-blue-50 text-blue-600 border-blue-200' 
              : 'bg-zinc-100 text-zinc-600 border-zinc-200'
          }`}>
            <User size={14} />
          </div>
          <div className="flex-1 max-w-[80%]">
            <div className="flex items-center gap-2 mb-1.5 justify-end">
              {isStreaming && <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-pulse" />}
              <span className="text-[12px] font-medium text-zinc-700">
                {isUserAnswer ? '你的回答' : '面试者'}
              </span>
            </div>
            <div className={`border rounded-lg px-4 py-3 ${
              isUserAnswer 
                ? 'bg-blue-50 border-blue-200' 
                : 'bg-zinc-50 border-zinc-200'
            }`}>
              <div className="text-[13px] text-zinc-800 prose prose-sm max-w-none prose-zinc">
                <ReactMarkdown>{content || '...'}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (type === 'summary') {
      // 解析评估报告和反问建议两个部分
      const fullContent = content || '正在生成评估报告...';
      const [reportContent, questionsContent] = fullContent.split('===SECTION_DIVIDER===');
      const hasQuestionsSection = questionsContent && questionsContent.trim().length > 0;
      
      return (
        <div key={index} className="my-6 mx-auto max-w-2xl space-y-4">
          {/* 评估报告卡片 */}
          <div className="bg-zinc-50 border border-zinc-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-zinc-100 border-b border-zinc-200 flex items-center gap-2">
              <Award size={16} className="text-zinc-600" />
              <span className="text-[14px] font-semibold text-zinc-800">📊 面试评估报告</span>
              {isStreaming && !hasQuestionsSection && <Loader2 size={14} className="animate-spin text-zinc-400 ml-auto" />}
            </div>
            <div className="p-5">
              <div className="text-[14px] text-zinc-700 leading-relaxed interview-report">
                <ReactMarkdown>{reportContent?.trim() || '正在生成评估报告...'}</ReactMarkdown>
              </div>
            </div>
          </div>
          
          {/* 推荐反问卡片 - 只有在有内容时显示 */}
          {hasQuestionsSection && (
            <div className="bg-amber-50/50 border border-amber-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 bg-amber-100/60 border-b border-amber-200 flex items-center gap-2">
                <span className="text-[16px]">🎯</span>
                <span className="text-[14px] font-semibold text-amber-800">本轮推荐反问</span>
                {isStreaming && <Loader2 size={14} className="animate-spin text-amber-500 ml-auto" />}
              </div>
              <div className="p-5">
                <div className="text-[14px] text-zinc-700 leading-relaxed interview-questions">
                  <ReactMarkdown>{questionsContent.trim()}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col bg-white">
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
                <h3 className="font-semibold text-zinc-900">功能受限</h3>
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
                  onShowVIPModal?.();
                }}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg text-sm font-medium text-white hover:from-amber-600 hover:to-orange-600 transition-colors flex items-center justify-center gap-1.5"
              >
                <Crown size={16} />
                升级 VIP
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="shrink-0 px-6 py-3 border-b border-zinc-200 flex items-center justify-between bg-white">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-zinc-400 hover:text-zinc-900 transition-colors">
            <ArrowLeft size={18} />
          </button>
          <h2 className="font-semibold text-[15px] text-zinc-900">模拟面试</h2>
          {status === 'running' && (
            <span className="flex items-center gap-1.5 text-[12px] text-zinc-400">
              <Loader2 size={12} className="animate-spin" />
              {settings.mode === 'interactive' ? '面试官思考中...' : '面试进行中...'}
            </span>
          )}
          {status === 'waiting_input' && (
            <span className="flex items-center gap-1.5 text-[12px] text-blue-500">
              <MessageSquare size={12} />
              等待你的回答
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors flex items-center gap-1.5"
          >
            <Settings size={16} />
            <span className="text-[12px]">{showSettings ? '隐藏设置' : '显示设置'}</span>
          </button>
          {status === 'completed' && (
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={isExporting}
                className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors flex items-center gap-1.5"
              >
                {isExporting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
                <span className="text-[12px]">下载记录</span>
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                  <button
                    onClick={handleExportMarkdown}
                    className="w-full px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-50 flex items-center gap-2 transition-colors"
                  >
                    <FileText size={14} className="text-zinc-400" />
                    导出文本
                  </button>
                  <button
                    onClick={handleExportImage}
                    className="w-full px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-50 flex items-center gap-2 transition-colors"
                  >
                    <ImageIcon size={14} className="text-zinc-400" />
                    导出图片
                  </button>
                </div>
              )}
            </div>
          )}
          {(status !== 'idle' || messages.length > 0) && (
            <button
              onClick={handleReset}
              className="text-[12px] text-zinc-400 hover:text-zinc-900 flex items-center gap-1 px-2 py-1.5 hover:bg-zinc-100 rounded-md transition-colors"
            >
              <RefreshCw size={12} />
              重置
            </button>
          )}
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="shrink-0 px-6 py-4 border-b border-zinc-200 bg-zinc-50">
          <div className="max-w-2xl mx-auto space-y-4">
            {/* 1. 面试模式选择 - 标签页样式 */}
            <div>
              <label className="text-[12px] font-medium text-zinc-700 mb-2 block">面试模式</label>
              <div className="flex bg-zinc-200 rounded-lg p-1">
                <button
                  onClick={() => setSettings({ ...settings, mode: 'simulation' })}
                  disabled={status === 'running' || status === 'waiting_input'}
                  className={`flex-1 py-2 px-3 rounded-md text-[13px] font-medium flex items-center justify-center gap-2 transition-all ${
                    settings.mode === 'simulation'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700'
                  } ${(status === 'running' || status === 'waiting_input') ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Play size={14} />
                  纯模拟
                </button>
                <button
                  onClick={() => setSettings({ ...settings, mode: 'interactive' })}
                  disabled={status === 'running' || status === 'waiting_input'}
                  className={`flex-1 py-2 px-3 rounded-md text-[13px] font-medium flex items-center justify-center gap-2 transition-all ${
                    settings.mode === 'interactive'
                      ? 'bg-white text-zinc-900 shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-700'
                  } ${(status === 'running' || status === 'waiting_input') ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Users size={14} />
                  人机交互
                </button>
              </div>
              <p className="text-[11px] text-zinc-400 mt-2">
                {settings.mode === 'simulation' 
                  ? '🎬 AI 同时扮演面试官和面试者，自动进行多轮问答，适合学习参考' 
                  : '🎤 AI 扮演面试官提问，你来回答，体验真实面试场景'}
              </p>
            </div>

            {/* 2. 面试官角色选择 */}
            <div>
              <label className="text-[12px] font-medium text-zinc-700 mb-2 block">面试官角色</label>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { value: 'ta', label: 'TA', icon: '😊', focus: '初筛', desc: '动机·稳定性·薪资初探' },
                  { value: 'peers', label: 'Peers', icon: '⚖️', focus: '专业验证', desc: '技术能力·项目深挖' },
                  { value: 'leader', label: '+1', icon: '🔥', focus: 'Leader认可', desc: '潜力·方法论·适配' },
                  { value: 'director', label: '+2', icon: '👔', focus: '高层背书', desc: '视野·战略·价值观' },
                  { value: 'hrbp', label: 'HRBP', icon: '💰', focus: 'Offer谈判', desc: '薪资·压价·到岗' }
                ].map((role, index) => (
                  <button
                    key={role.value}
                    onClick={() => setSettings({ ...settings, interviewerRole: role.value as any })}
                    disabled={status === 'running' || status === 'waiting_input'}
                    className={`relative flex flex-col items-center py-3 px-2 rounded-lg border-2 transition-all ${
                      settings.interviewerRole === role.value
                        ? 'bg-zinc-900 text-white border-zinc-900 shadow-md'
                        : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400 hover:bg-zinc-50'
                    } ${(status === 'running' || status === 'waiting_input') ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    {/* 轮次标记 */}
                    <span className={`absolute -top-2 -left-1 text-[9px] px-1.5 py-0.5 rounded-full ${
                      settings.interviewerRole === role.value 
                        ? 'bg-white text-zinc-900' 
                        : 'bg-zinc-100 text-zinc-500'
                    }`}>
                      第{index + 1}轮
                    </span>
                    {/* 图标和名称 */}
                    <span className="text-[16px] mb-1">{role.icon}</span>
                    <span className="text-[12px] font-medium">{role.label}</span>
                    {/* 核心关注点 */}
                    <span className={`text-[10px] mt-1 ${
                      settings.interviewerRole === role.value ? 'text-zinc-300' : 'text-zinc-400'
                    }`}>
                      {role.focus}
                    </span>
                    {/* 详细描述 - 仅选中时显示 */}
                    {settings.interviewerRole === role.value && (
                      <span className="text-[9px] mt-1 text-zinc-400 text-center leading-tight">
                        {role.desc}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. 问答轮数 - 最后 */}
            <div>
              <label className="text-[12px] font-medium text-zinc-700 mb-2 block">问答轮数</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="5"
                  max="12"
                  value={settings.totalRounds}
                  onChange={(e) => setSettings({ ...settings, totalRounds: parseInt(e.target.value) })}
                  className="flex-1 h-1 bg-zinc-200 rounded appearance-none cursor-pointer accent-zinc-900"
                  disabled={status === 'running' || status === 'waiting_input'}
                />
                <span className="text-[13px] text-zinc-600 w-12">{settings.totalRounds} 轮</span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-2">
                💡 TA/+2/HRBP 面试通常为 5-8 个问题，Peers/+1 轮可能为 8-12 个问题。默认 8 轮，可按实际情况调整
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !showInputPanel ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400 p-8">
            <Briefcase size={48} strokeWidth={1} className="mb-4 text-zinc-300" />
            <h3 className="text-[16px] font-medium text-zinc-600 mb-2">AI 模拟面试</h3>
            <p className="text-[13px] text-center max-w-sm mb-6">
              输入你的简历和目标岗位 JD，开始一场专业的模拟面试
            </p>
            <button
              onClick={() => setShowInputPanel(true)}
              className="px-4 py-2 bg-zinc-900 text-white text-[13px] rounded-md hover:bg-zinc-800 transition-colors"
            >
              开始新面试
            </button>
          </div>
        ) : showInputPanel ? (
          <div className="max-w-2xl mx-auto p-6">
            <div className="space-y-5">
              {/* 模式选择提示 */}
              <div className={`p-4 rounded-lg border ${
                settings.mode === 'simulation' 
                  ? 'bg-zinc-50 border-zinc-200' 
                  : 'bg-blue-50 border-blue-200'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {settings.mode === 'simulation' ? (
                    <>
                      <Play size={16} className="text-zinc-600" />
                      <span className="text-[13px] font-medium text-zinc-800">纯模拟模式</span>
                    </>
                  ) : (
                    <>
                      <Users size={16} className="text-blue-600" />
                      <span className="text-[13px] font-medium text-blue-800">人机交互模式</span>
                    </>
                  )}
                </div>
                <p className="text-[12px] text-zinc-500">
                  {settings.mode === 'simulation' 
                    ? 'AI 将同时扮演面试官和面试者，自动进行多轮问答。你可以观看学习，了解标准问题和优秀回答。' 
                    : 'AI 扮演面试官向你提问，你需要自己组织语言作答。每轮回答后，面试官会给出点评并提出下一个问题。最终你将获得完整的面试评估报告。'}
                </p>
              </div>

              {/* 错误提示 */}
              {fileError && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-md flex items-start gap-2">
                  <AlertCircle size={14} className="text-red-500 mt-0.5 shrink-0" />
                  <p className="text-[12px] text-red-600">{fileError}</p>
                </div>
              )}

              {/* JD Input - 与简历优化页面顺序一致 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-medium text-zinc-700 flex items-center gap-1.5">
                    <Briefcase size={13} className="text-zinc-400" />
                    目标岗位 JD
                  </label>
                  <button 
                    onClick={() => jdFileInputRef.current?.click()} 
                    disabled={processingState.jd} 
                    className={`text-[12px] text-zinc-400 hover:text-zinc-900 font-medium flex items-center gap-1 transition-colors ${processingState.jd ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Upload size={11} /> 上传文件
                  </button>
                </div>
                {/* JD 完整度提示 */}
                <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    <span className="font-semibold">💡 提示：</span>请提供尽可能<span className="font-semibold">详细、完整</span>的 JD 内容（包括岗位职责、任职要求、团队介绍等），这将帮助 AI 更精准地优化简历、模拟更真实的面试问题。
                  </p>
                </div>
                <input 
                  type="file" 
                  ref={jdFileInputRef} 
                  className="hidden" 
                  accept=".pdf,.doc,.docx,image/*" 
                  onChange={(e) => handleFileChange(e, 'jd')} 
                />
                <textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  onPaste={(e) => handlePaste(e, 'jd')}
                  placeholder="粘贴目标岗位描述（建议包含：岗位职责、任职要求、团队/业务介绍等）..."
                  className="w-full h-32 p-4 bg-zinc-50 border border-zinc-200 rounded-md focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 outline-none text-[13px] text-zinc-800 placeholder:text-zinc-400 resize-none"
                />
                {processingState.jd && <FileChip name="" mime="" onRemove={() => {}} isLoading={true} />}
                {!processingState.jd && jdFile && <FileChip name={jdFile.name} mime={jdFile.mime} onRemove={() => setJdFile(null)} />}
              </div>

              {/* Resume Input */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-medium text-zinc-700 flex items-center gap-1.5">
                    <FileText size={13} className="text-zinc-400" />
                    你的简历
                  </label>
                  <button 
                    onClick={() => resumeFileInputRef.current?.click()} 
                    disabled={processingState.resume} 
                    className={`text-[12px] text-zinc-400 hover:text-zinc-900 font-medium flex items-center gap-1 transition-colors ${processingState.resume ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <Upload size={11} /> 上传文件
                  </button>
                </div>
                <input 
                  type="file" 
                  ref={resumeFileInputRef} 
                  className="hidden" 
                  accept=".pdf,.doc,.docx,image/*" 
                  onChange={(e) => handleFileChange(e, 'resume')} 
                />
                <textarea
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  onPaste={(e) => handlePaste(e, 'resume')}
                  placeholder="粘贴简历内容，或直接上传/截图粘贴..."
                  className="w-full h-44 p-4 bg-zinc-50 border border-zinc-200 rounded-md focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 outline-none text-[13px] text-zinc-800 placeholder:text-zinc-400 resize-none"
                />
                {processingState.resume && <FileChip name="" mime="" onRemove={() => {}} isLoading={true} />}
                {!processingState.resume && resumeFile && <FileChip name={resumeFile.name} mime={resumeFile.mime} onRemove={() => setResumeFile(null)} />}
              </div>

              {/* 补充信息（可选） */}
              <div className="space-y-2">
                <button
                  onClick={() => setShowSupplementInfo(!showSupplementInfo)}
                  className="flex items-center gap-1.5 text-[13px] text-zinc-500 hover:text-zinc-700 transition-colors"
                >
                  <ChevronDown 
                    size={14} 
                    className={`transition-transform ${showSupplementInfo ? 'rotate-180' : ''}`} 
                  />
                  <span className="font-medium">📋 补充信息（可选，帮助模拟谈薪环节）</span>
                </button>
                
                {showSupplementInfo && (
                  <div className="p-4 bg-zinc-50 border border-zinc-200 rounded-lg space-y-3">
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                      以下信息仅用于本次模拟面试，帮助 AI 更真实地模拟谈薪环节，助你更好地争取利益。
                      <span className="text-amber-600 font-medium"> 🔒 不会被存储</span>
                    </p>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-zinc-600 flex items-center gap-1">
                          💰 当前薪资结构
                        </label>
                        <textarea
                          value={supplementInfo.currentSalary}
                          onChange={(e) => setSupplementInfo(prev => ({ ...prev, currentSalary: e.target.value }))}
                          placeholder="例：Base 30k/月 + 年终4个月 + 股票 xxx 股..."
                          className="w-full h-16 p-2.5 bg-white border border-zinc-200 rounded-md focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 outline-none text-[12px] text-zinc-700 placeholder:text-zinc-400 resize-none"
                        />
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-zinc-600 flex items-center gap-1">
                          🎯 期望薪资范围
                        </label>
                        <textarea
                          value={supplementInfo.expectedSalary}
                          onChange={(e) => setSupplementInfo(prev => ({ ...prev, expectedSalary: e.target.value }))}
                          placeholder="例：Base 40-50k/月，总包希望涨幅 30%..."
                          className="w-full h-16 p-2.5 bg-white border border-zinc-200 rounded-md focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 outline-none text-[12px] text-zinc-700 placeholder:text-zinc-400 resize-none"
                        />
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-zinc-600 flex items-center gap-1">
                          📅 最快到岗时间
                        </label>
                        <input
                          type="text"
                          value={supplementInfo.availableTime}
                          onChange={(e) => setSupplementInfo(prev => ({ ...prev, availableTime: e.target.value }))}
                          placeholder="例：1个月内 / 需要交接2周 / 随时..."
                          className="w-full p-2.5 bg-white border border-zinc-200 rounded-md focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 outline-none text-[12px] text-zinc-700 placeholder:text-zinc-400"
                        />
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-[12px] font-medium text-zinc-600 flex items-center gap-1">
                          📝 其他补充
                        </label>
                        <input
                          type="text"
                          value={supplementInfo.otherInfo}
                          onChange={(e) => setSupplementInfo(prev => ({ ...prev, otherInfo: e.target.value }))}
                          placeholder="例：有其他 Offer 在手 / 需要 WLB..."
                          className="w-full p-2.5 bg-white border border-zinc-200 rounded-md focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 outline-none text-[12px] text-zinc-700 placeholder:text-zinc-400"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2">
                <button
                  onClick={handleStartInterview}
                  disabled={!resumeText.trim() || !jdText.trim() || processingState.resume || processingState.jd}
                  className={`w-full py-3 rounded-md text-[14px] font-medium flex items-center justify-center gap-2 transition-colors ${
                    resumeText.trim() && jdText.trim() && !processingState.resume && !processingState.jd
                      ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                      : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
                  }`}
                >
                  {processingState.resume || processingState.jd ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      正在识别文件内容...
                    </>
                  ) : (
                    <>
                      {settings.mode === 'simulation' ? <Play size={15} /> : <Users size={15} />}
                      {settings.mode === 'simulation' ? '开始模拟面试' : '开始交互面试'}
                    </>
                  )}
                </button>
                <p className="text-[11px] text-zinc-400 text-center mt-3">
                  {processingState.resume || processingState.jd 
                    ? '正在识别上传的文件，请稍候...'
                    : settings.mode === 'simulation' 
                      ? '面试过程约 3-5 分钟，AI 将扮演面试官和面试者进行对话' 
                      : '面试官会逐个提问，你可以慢慢思考并输入回答'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6" ref={chatContainerRef}>
            <div className="max-w-3xl mx-auto">
              {/* 导出时的标题 */}
              <div className="hidden print:block mb-6 pb-4 border-b border-zinc-200">
                <h1 className="text-[18px] font-bold text-zinc-900">模拟面试记录</h1>
                <p className="text-[12px] text-zinc-500 mt-1">
                  日期：{new Date().toLocaleDateString('zh-CN')} | 模式：{settings.mode === 'interactive' ? '人机交互' : '纯模拟'}
                </p>
              </div>
              {messages.map((msg, index) => renderMessage(msg, index))}
              <div ref={bottomRef} />
            </div>
          </div>
        )}
      </div>

      {/* Bottom Bar - 运行中状态 */}
      {status === 'running' && (
        <div className="shrink-0 px-6 py-4 border-t border-zinc-200 bg-zinc-50">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <span className="text-[12px] text-zinc-500">
              {settings.mode === 'interactive' ? '面试官正在思考下一个问题...' : '面试进行中，请耐心等待...'}
            </span>
            <button
              onClick={handleStopInterview}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 text-red-600 text-[12px] rounded-md hover:bg-red-100 transition-colors"
            >
              <Square size={12} />
              停止面试
            </button>
          </div>
        </div>
      )}

      {/* Bottom Bar - 等待用户输入（人机交互模式） */}
      {status === 'waiting_input' && settings.mode === 'interactive' && (
        <div className="shrink-0 px-6 py-4 border-t border-zinc-200 bg-white">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare size={14} className="text-blue-500" />
              <span className="text-[12px] text-zinc-600">
                请输入你的回答（按 Enter 提交，Shift+Enter 换行）
              </span>
              <span className="text-[11px] text-zinc-400 ml-auto">
                第 {interactiveState?.currentRound}/{settings.totalRounds} 轮
              </span>
            </div>
            <div className="flex gap-3">
              <div className="flex-1 relative">
                <textarea
                  ref={inputTextareaRef}
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={isTranscribing ? "正在转换语音..." : "在这里输入你的回答..."}
                  className={`w-full p-3 pr-12 bg-zinc-50 border rounded-lg focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none text-[13px] text-zinc-800 placeholder:text-zinc-400 resize-none min-h-[80px] max-h-[200px] ${
                    isRecording ? 'border-red-300 bg-red-50/30' : isTranscribing ? 'border-blue-300 bg-blue-50/30' : 'border-zinc-200'
                  }`}
                  disabled={isSubmitting || isTranscribing}
                />
                {/* 语音录制按钮 */}
                <button
                  onClick={toggleRecording}
                  disabled={isSubmitting || isTranscribing}
                  className={`absolute right-3 bottom-3 p-2 rounded-full transition-all ${
                    isRecording 
                      ? 'bg-red-500 text-white animate-pulse hover:bg-red-600' 
                      : isTranscribing
                        ? 'bg-blue-500 text-white cursor-wait'
                        : 'bg-zinc-200 text-zinc-500 hover:bg-zinc-300 hover:text-zinc-700'
                  }`}
                  title={isRecording ? '停止录音并转文字' : isTranscribing ? '正在转换...' : '开始语音录制'}
                >
                  {isRecording ? <StopCircle size={16} /> : isTranscribing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
                </button>
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={handleSubmitAnswer}
                  disabled={!userInput.trim() || isSubmitting || isTranscribing}
                  className={`px-4 py-2 rounded-md text-[13px] font-medium flex items-center gap-2 transition-colors ${
                    userInput.trim() && !isSubmitting && !isTranscribing
                      ? 'bg-blue-500 text-white hover:bg-blue-600'
                      : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
                  }`}
                >
                  {isSubmitting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Send size={14} />
                  )}
                  提交
                </button>
                <button
                  onClick={handleStopInterview}
                  className="px-4 py-2 text-[12px] text-zinc-400 hover:text-red-500 transition-colors"
                >
                  结束面试
                </button>
              </div>
            </div>
            {/* 录音状态显示 */}
            {isRecording && (
              <div className="mt-2 flex items-center gap-3 text-[12px]">
                <div className="flex items-center gap-2 text-red-500">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  正在录音 {recordingTime}s
                </div>
                {/* 音量电平指示器 */}
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-400">音量:</span>
                  <div className="w-24 h-2 bg-zinc-200 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all duration-75 ${
                        audioLevel > 50 ? 'bg-green-500' : audioLevel > 20 ? 'bg-yellow-500' : 'bg-red-400'
                      }`}
                      style={{ width: `${Math.min(audioLevel, 100)}%` }}
                    />
                  </div>
                </div>
                <span className="text-zinc-400">
                  点击停止按钮结束录音
                </span>
              </div>
            )}
            {isTranscribing && (
              <div className="mt-2 flex items-center gap-2 text-[12px] text-blue-500">
                <Loader2 size={14} className="animate-spin" />
                正在将语音转换为文字，请稍候...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default InterviewChat;
