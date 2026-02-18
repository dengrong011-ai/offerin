
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Briefcase, User, Hash, Info, AlertCircle, Award, 
  Send, Square, Plus, X, FileText, Upload, Settings,
  Download, RefreshCw, Loader2, ArrowLeft, ChevronDown, Image as ImageIcon, FileDown,
  Play, MessageSquare, Users, Mic, MicOff, StopCircle
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { InterviewMessage, InterviewSettings, InterviewStatus, InterviewMode } from '../types';
import { 
  runInterview, 
  exportInterviewRecord, 
  generateFirstQuestion, 
  processUserAnswer,
  InteractiveInterviewState 
} from '../services/interviewService';
import { transcribeAudio } from '../services/geminiService';

interface InterviewChatProps {
  onBack: () => void;
  initialResume?: string;
  initialJd?: string;
}

const InterviewChat: React.FC<InterviewChatProps> = ({ onBack, initialResume = '', initialJd = '' }) => {
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [settings, setSettings] = useState<InterviewSettings>({
    totalRounds: 8,
    interviewStyle: 'standard',
    mode: 'simulation'
  });
  const [showSettings, setShowSettings] = useState(true);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<InterviewStatus>('idle');
  
  const [resumeText, setResumeText] = useState(initialResume);
  const [jdText, setJdText] = useState(initialJd);
  const [showInputPanel, setShowInputPanel] = useState(!initialResume);
  
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

    setStatus('running');
    setShowInputPanel(false);
    setMessages([]);
    
    abortControllerRef.current = new AbortController();

    try {
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
        abortControllerRef.current.signal
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatus('stopped');
      }
    }
  }, [resumeText, jdText, settings]);

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

    setStatus('running');
    setShowInputPanel(false);
    setMessages([]);
    
    abortControllerRef.current = new AbortController();

    try {
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
        abortControllerRef.current.signal
      );

      if (state) {
        setInteractiveState(state);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStatus('stopped');
      }
    }
  }, [resumeText, jdText, settings]);

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
    abortControllerRef.current?.abort();
    setStatus('stopped');
    setInteractiveState(null);
    setMessages(prev => [...prev, {
      type: 'system',
      content: '面试已停止',
      timestamp: new Date().toISOString()
    }]);
  };

  // 导出为 PDF
  const handleExportPDF = async () => {
    if (!chatContainerRef.current) return;
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
      const imgWidth = 210;
      const pageHeight = 297;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      let heightLeft = imgHeight;
      let position = 0;
      
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
      
      const timestamp = new Date().toISOString().split('T')[0];
      const modeLabel = settings.mode === 'interactive' ? '人机交互' : '纯模拟';
      pdf.save(`面试记录_${modeLabel}_${timestamp}.pdf`);
    } catch (error) {
      console.error('PDF export error:', error);
    } finally {
      setIsExporting(false);
    }
  };

  // 导出为图片
  const handleExportImage = async () => {
    if (!chatContainerRef.current) return;
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
      return (
        <div key={index} className="my-6 mx-auto max-w-2xl">
          <div className="bg-zinc-50 border border-zinc-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 bg-zinc-100 border-b border-zinc-200 flex items-center gap-2">
              <Award size={16} className="text-zinc-600" />
              <span className="text-[14px] font-semibold text-zinc-800">面试评估报告</span>
              {isStreaming && <Loader2 size={14} className="animate-spin text-zinc-400 ml-auto" />}
            </div>
            <div className="p-4">
              <div className="text-[13px] text-zinc-700 prose prose-sm max-w-none prose-zinc">
                <ReactMarkdown>{content || '正在生成评估报告...'}</ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col bg-white">
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
            className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors"
          >
            <Settings size={16} />
          </button>
          {status === 'completed' && (
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setShowExportMenu(!showExportMenu)}
                disabled={isExporting}
                className="p-2 text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors flex items-center gap-1"
              >
                {isExporting ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Download size={16} />
                )}
              </button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-zinc-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]">
                  <button
                    onClick={handleExportPDF}
                    className="w-full px-3 py-2 text-left text-[13px] text-zinc-700 hover:bg-zinc-50 flex items-center gap-2 transition-colors"
                  >
                    <FileDown size={14} className="text-zinc-400" />
                    导出 PDF
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
            {/* 面试模式选择 - 标签页样式 */}
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

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="text-[12px] font-medium text-zinc-700 mb-2 block">面试轮次</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="3"
                    max="15"
                    value={settings.totalRounds}
                    onChange={(e) => setSettings({ ...settings, totalRounds: parseInt(e.target.value) })}
                    className="flex-1 h-1 bg-zinc-200 rounded appearance-none cursor-pointer accent-zinc-900"
                    disabled={status === 'running' || status === 'waiting_input'}
                  />
                  <span className="text-[13px] text-zinc-600 w-12">{settings.totalRounds} 轮</span>
                </div>
              </div>
              <div>
                <label className="text-[12px] font-medium text-zinc-700 mb-2 block">面试风格</label>
                <div className="flex gap-2">
                  {[
                    { value: 'standard', label: '标准', icon: '⚖️' },
                    { value: 'pressure', label: '压力', icon: '🔥' },
                    { value: 'friendly', label: '友好', icon: '😊' }
                  ].map(style => (
                    <button
                      key={style.value}
                      onClick={() => setSettings({ ...settings, interviewStyle: style.value as any })}
                      disabled={status === 'running' || status === 'waiting_input'}
                      className={`flex-1 py-1.5 px-2 rounded-md text-[12px] border transition-colors ${
                        settings.interviewStyle === style.value
                          ? 'bg-zinc-900 text-white border-zinc-900'
                          : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-400'
                      } ${(status === 'running' || status === 'waiting_input') ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {style.icon} {style.label}
                    </button>
                  ))}
                </div>
              </div>
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

              <div>
                <label className="text-[13px] font-medium text-zinc-700 mb-2 flex items-center gap-1.5">
                  <FileText size={13} className="text-zinc-400" />
                  你的简历
                </label>
                <textarea
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder="粘贴你的简历内容..."
                  className="w-full h-40 p-4 bg-zinc-50 border border-zinc-200 rounded-md focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 outline-none text-[13px] text-zinc-800 placeholder:text-zinc-400 resize-none"
                />
              </div>
              <div>
                <label className="text-[13px] font-medium text-zinc-700 mb-2 flex items-center gap-1.5">
                  <Briefcase size={13} className="text-zinc-400" />
                  目标岗位 JD
                </label>
                <textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  placeholder="粘贴目标岗位的职位描述..."
                  className="w-full h-32 p-4 bg-zinc-50 border border-zinc-200 rounded-md focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 outline-none text-[13px] text-zinc-800 placeholder:text-zinc-400 resize-none"
                />
              </div>
              <div className="pt-2">
                <button
                  onClick={handleStartInterview}
                  disabled={!resumeText.trim() || !jdText.trim()}
                  className={`w-full py-3 rounded-md text-[14px] font-medium flex items-center justify-center gap-2 transition-colors ${
                    resumeText.trim() && jdText.trim()
                      ? 'bg-zinc-900 text-white hover:bg-zinc-800'
                      : 'bg-zinc-200 text-zinc-400 cursor-not-allowed'
                  }`}
                >
                  {settings.mode === 'simulation' ? <Play size={15} /> : <Users size={15} />}
                  {settings.mode === 'simulation' ? '开始模拟面试' : '开始交互面试'}
                </button>
                <p className="text-[11px] text-zinc-400 text-center mt-3">
                  {settings.mode === 'simulation' 
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
