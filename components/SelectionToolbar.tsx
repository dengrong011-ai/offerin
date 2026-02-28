import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Scissors, BarChart3, Target, RefreshCw, MessageSquare, Loader2, X, Check, Undo2, Send, AlertCircle } from 'lucide-react';
import { rewriteSelectedText, type RewriteAction, type RewriteStreamCallbacks } from '../services/geminiService';

interface SelectionToolbarProps {
  editorRef: React.RefObject<HTMLTextAreaElement | null>;
  fullResume: string;
  jd?: string;
  diagnosis?: string;
  onReplace: (oldText: string, newText: string) => void;
  onShowLimitError?: (message: string) => void;
}

interface ToolbarPosition {
  top: number;
  left: number;
}

const SelectionToolbar: React.FC<SelectionToolbarProps> = ({
  editorRef,
  fullResume,
  jd,
  diagnosis,
  onReplace,
  onShowLimitError,
}) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<ToolbarPosition>({ top: 0, left: 0 });
  const [selectedText, setSelectedText] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customInstruction, setCustomInstruction] = useState('');
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteResult, setRewriteResult] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const customInputRef = useRef<HTMLInputElement>(null);
  const originalTextRef = useRef('');

  const getSelectedTextFromEditor = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return { text: '', start: 0, end: 0 };
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const text = editor.value.substring(start, end);
    return { text, start, end };
  }, [editorRef]);

  // Calculate caret position in textarea using a mirror div
  const getCaretCoordinates = useCallback((element: HTMLTextAreaElement, position: number) => {
    const mirror = document.createElement('div');
    const style = window.getComputedStyle(element);
    
    // Copy textarea styles to mirror
    const properties = [
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
      'textTransform', 'wordSpacing', 'textIndent', 'lineHeight',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap', 'tabSize',
    ] as const;
    
    mirror.style.position = 'absolute';
    mirror.style.top = '-9999px';
    mirror.style.left = '-9999px';
    mirror.style.visibility = 'hidden';
    mirror.style.overflow = 'hidden';
    mirror.style.width = style.width;
    
    properties.forEach(prop => {
      mirror.style[prop as any] = style[prop as any];
    });
    
    const textBefore = element.value.substring(0, position);
    const textNode = document.createTextNode(textBefore);
    const span = document.createElement('span');
    span.textContent = element.value.substring(position) || '.';
    
    mirror.appendChild(textNode);
    mirror.appendChild(span);
    document.body.appendChild(mirror);
    
    const top = span.offsetTop - element.scrollTop;
    const left = span.offsetLeft;
    const height = span.offsetHeight;
    
    document.body.removeChild(mirror);
    
    return { top, left, height };
  }, []);

  useEffect(() => {
    const handleMouseUp = () => {
      // Small delay to let selection finalize
      setTimeout(() => {
        const editor = editorRef.current;
        if (!editor) return;
        
        const { text, start, end } = getSelectedTextFromEditor();
        if (text.trim().length > 5) {
          // Calculate position using mirror div technique for textarea
          const startCoords = getCaretCoordinates(editor, start);
          const endCoords = getCaretCoordinates(editor, end);
          
          // Position toolbar above the selection
          const toolbarTop = startCoords.top - 48;
          const midLeft = (startCoords.left + endCoords.left) / 2;
          const editorWidth = editor.clientWidth;
          
          setPosition({
            top: Math.max(toolbarTop, -40),
            left: Math.min(
              Math.max(midLeft - 140, 8),
              editorWidth - 296
            ),
          });
          setSelectedText(text);
          originalTextRef.current = text;
          setVisible(true);
          setRewriteResult('');
          setStreamingText('');
          setShowCustomInput(false);
          setErrorMessage(null);
        } else if (!isRewriting) {
          setVisible(false);
        }
      }, 10);
    };

    const editor = editorRef.current;
    if (editor) {
      editor.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      if (editor) {
        editor.removeEventListener('mouseup', handleMouseUp);
      }
    };
  }, [editorRef, getSelectedTextFromEditor, getCaretCoordinates, isRewriting]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(e.target as Node) &&
        editorRef.current &&
        !editorRef.current.contains(e.target as Node) &&
        !isRewriting
      ) {
        setVisible(false);
      }
    };
    if (visible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [visible, editorRef, isRewriting]);

  const handleAction = async (action: RewriteAction, instruction?: string) => {
    if (!selectedText.trim()) return;
    setIsRewriting(true);
    setRewriteResult('');
    setStreamingText('');
    setShowCustomInput(false);
    setErrorMessage(null);

    const callbacks: RewriteStreamCallbacks = {
      onChunk: (chunk) => {
        setStreamingText(prev => prev + chunk);
      },
      onComplete: (fullText) => {
        setRewriteResult(fullText);
        setStreamingText('');
        setIsRewriting(false);
      },
      onError: (error) => {
        console.error('Rewrite error:', error);
        setIsRewriting(false);
        setStreamingText('');
        
        // 检查是否是使用限制错误
        if (error.includes('USAGE_LIMIT_EXCEEDED') || error.includes('使用次数') || error.includes('上限') || error.includes('403')) {
          const limitMessage = '精调功能使用次数已达上限。升级 VIP 享更多使用次数！';
          setErrorMessage(limitMessage);
          // 同时触发全局提示弹窗
          if (onShowLimitError) {
            onShowLimitError(limitMessage);
            setVisible(false);
          }
        } else {
          setErrorMessage(error || '重写失败，请稍后重试');
        }
      },
    };

    try {
      await rewriteSelectedText(
        selectedText,
        action,
        instruction,
        { fullResume, jd, diagnosis },
        callbacks
      );
    } catch (err: any) {
      setIsRewriting(false);
      // 检查是否是使用限制错误
      const errorMsg = err?.message || '重写失败';
      if (errorMsg.includes('USAGE_LIMIT_EXCEEDED') || errorMsg.includes('使用次数') || errorMsg.includes('上限') || errorMsg.includes('403')) {
        const limitMessage = '精调功能使用次数已达上限。升级 VIP 享更多使用次数！';
        if (onShowLimitError) {
          onShowLimitError(limitMessage);
          setVisible(false);
        } else {
          setErrorMessage(limitMessage);
        }
      }
    }
  };

  const handleAccept = () => {
    const finalText = rewriteResult;
    if (finalText && originalTextRef.current) {
      onReplace(originalTextRef.current, finalText);
    }
    setVisible(false);
    setRewriteResult('');
  };

  const handleReject = () => {
    setRewriteResult('');
    setStreamingText('');
    setIsRewriting(false);
    setErrorMessage(null);
  };

  const handleCustomSubmit = () => {
    if (customInstruction.trim()) {
      handleAction('custom', customInstruction.trim());
      setCustomInstruction('');
    }
  };

  if (!visible) return null;

  const displayText = isRewriting ? streamingText : rewriteResult;

  return (
    <div
      ref={toolbarRef}
      className="absolute z-50 animate-fade-in"
      style={{ top: position.top, left: position.left }}
    >
      {/* 错误提示区 */}
      {errorMessage && !onShowLimitError && (
        <div className="mb-2 bg-white border border-red-200 rounded-lg shadow-lg max-w-[360px] overflow-hidden">
          <div className="px-3 py-3 flex items-start gap-2">
            <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-[12px] text-red-600">{errorMessage}</p>
            </div>
            <button
              onClick={() => { setErrorMessage(null); setVisible(false); }}
              className="p-1 text-zinc-400 hover:text-zinc-600 transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* 结果预览区 */}
      {(displayText || isRewriting) && !errorMessage && (
        <div className="mb-2 bg-white border border-zinc-200 rounded-lg shadow-lg max-w-[360px] overflow-hidden">
          <div className="px-3 py-2 border-b border-zinc-100 flex items-center justify-between">
            <span className="text-[11px] font-medium text-zinc-500 flex items-center gap-1.5">
              {isRewriting ? (
                <>
                  <Loader2 size={10} className="animate-spin" />
                  AI 重写中...
                </>
              ) : (
                '重写结果'
              )}
            </span>
            {!isRewriting && rewriteResult && (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleReject}
                  className="p-1 text-zinc-400 hover:text-red-500 transition-colors"
                  title="放弃"
                >
                  <Undo2 size={12} />
                </button>
                <button
                  onClick={handleAccept}
                  className="p-1 text-zinc-400 hover:text-green-600 transition-colors"
                  title="采纳"
                >
                  <Check size={12} />
                </button>
              </div>
            )}
          </div>
          <div className="px-3 py-2 max-h-[200px] overflow-y-auto">
            <pre className="text-[12px] text-zinc-700 whitespace-pre-wrap font-mono leading-relaxed">
              {displayText || '...'}
            </pre>
          </div>
          {!isRewriting && rewriteResult && (
            <div className="px-3 py-2 border-t border-zinc-100 flex gap-2">
              <button
                onClick={handleReject}
                className="flex-1 px-3 py-1.5 text-[11px] border border-zinc-200 rounded text-zinc-600 hover:bg-zinc-50 transition-colors flex items-center justify-center gap-1"
              >
                <Undo2 size={10} /> 放弃
              </button>
              <button
                onClick={handleAccept}
                className="flex-1 px-3 py-1.5 text-[11px] bg-zinc-900 text-white rounded hover:bg-zinc-800 transition-colors flex items-center justify-center gap-1"
              >
                <Check size={10} /> 采纳替换
              </button>
            </div>
          )}
        </div>
      )}

      {/* 快捷操作栏 */}
      {!isRewriting && !rewriteResult && !errorMessage && (
        <div className="bg-white border border-zinc-200 rounded-lg shadow-lg overflow-hidden">
          <div className="flex items-center gap-0.5 px-1.5 py-1.5">
            <button
              onClick={() => handleAction('concise')}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-zinc-600 hover:bg-zinc-100 rounded transition-colors whitespace-nowrap"
              title="精简表达"
            >
              <Scissors size={11} /> 精简
            </button>
            <button
              onClick={() => handleAction('quantify')}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-zinc-600 hover:bg-zinc-100 rounded transition-colors whitespace-nowrap"
              title="补充量化数据"
            >
              <BarChart3 size={11} /> 量化
            </button>
            {jd && (
              <button
                onClick={() => handleAction('match_jd')}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-zinc-600 hover:bg-zinc-100 rounded transition-colors whitespace-nowrap"
                title="匹配JD关键词"
              >
                <Target size={11} /> 匹配JD
              </button>
            )}
            <button
              onClick={() => handleAction('rewrite')}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-zinc-600 hover:bg-zinc-100 rounded transition-colors whitespace-nowrap"
              title="专业重写"
            >
              <RefreshCw size={11} /> 重写
            </button>
            <div className="w-px h-4 bg-zinc-200 mx-0.5" />
            <button
              onClick={() => {
                setShowCustomInput(true);
                setTimeout(() => customInputRef.current?.focus(), 50);
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] text-zinc-600 hover:bg-zinc-100 rounded transition-colors whitespace-nowrap"
              title="自由输入指令"
            >
              <MessageSquare size={11} /> 自定义
            </button>
            <button
              onClick={() => setVisible(false)}
              className="p-1.5 text-zinc-400 hover:text-zinc-600 rounded transition-colors ml-0.5"
            >
              <X size={11} />
            </button>
          </div>
          
          {/* 自定义输入区 */}
          {showCustomInput && (
            <div className="px-2 pb-2 flex gap-1.5">
              <input
                ref={customInputRef}
                value={customInstruction}
                onChange={e => setCustomInstruction(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCustomSubmit(); if (e.key === 'Escape') setShowCustomInput(false); }}
                placeholder="例如：用STAR写法重写..."
                className="flex-1 px-2.5 py-1.5 text-[11px] border border-zinc-200 rounded focus:outline-none focus:ring-1 focus:ring-zinc-400 bg-zinc-50"
              />
              <button
                onClick={handleCustomSubmit}
                disabled={!customInstruction.trim()}
                className="px-2.5 py-1.5 bg-zinc-900 text-white rounded text-[11px] hover:bg-zinc-800 disabled:opacity-40 transition-colors"
              >
                <Send size={10} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SelectionToolbar;
