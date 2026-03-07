import React, { useState, useRef, useCallback } from 'react';
import { Upload, Link2, Loader2, X, Check, AlertCircle, ImageIcon } from 'lucide-react';
import { uploadResumePhoto, validateImageUrl } from '../services/storageService';

interface PhotoUploadPanelProps {
  userId: string | undefined;
  resumeId: string | undefined;
  currentPhotoUrl: string;
  onPhotoChange: (url: string) => void;
  onClose: () => void;
}

const PhotoUploadPanel: React.FC<PhotoUploadPanelProps> = ({
  userId,
  resumeId,
  currentPhotoUrl,
  onPhotoChange,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'url'>('upload');
  const [isUploading, setIsUploading] = useState(false);
  const [urlInput, setUrlInput] = useState(currentPhotoUrl);
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState(currentPhotoUrl);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    setError('');
    setIsUploading(true);

    const { url, error: uploadError } = await uploadResumePhoto(file, userId, resumeId);

    if (uploadError) {
      setError(uploadError);
      setIsUploading(false);
      return;
    }

    setPreviewUrl(url);
    onPhotoChange(url);
    setIsUploading(false);
  }, [userId, resumeId, onPhotoChange]);

  const handleUrlSubmit = useCallback(async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setError('请输入图片链接');
      return;
    }

    // 基本 URL 校验
    try {
      new URL(trimmed);
    } catch {
      setError('请输入有效的 URL 地址');
      return;
    }

    setError('');
    setIsValidating(true);

    const isValid = await validateImageUrl(trimmed);

    if (!isValid) {
      setError('无法加载该图片，请检查链接是否可公开访问');
      setIsValidating(false);
      return;
    }

    setPreviewUrl(trimmed);
    onPhotoChange(trimmed);
    setIsValidating(false);
  }, [urlInput, onPhotoChange]);

  const handleRemovePhoto = useCallback(() => {
    setPreviewUrl('');
    setUrlInput('');
    onPhotoChange('');
  }, [onPhotoChange]);

  return (
    <div className="absolute top-full left-0 mt-1 z-50 w-[320px] bg-white rounded-lg border border-zinc-200 shadow-xl animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-100">
        <span className="text-[13px] font-medium text-zinc-800">添加简历照片</span>
        <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-100">
        <button
          onClick={() => { setActiveTab('upload'); setError(''); }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium transition-colors ${
            activeTab === 'upload'
              ? 'text-zinc-900 border-b-2 border-zinc-900'
              : 'text-zinc-400 hover:text-zinc-600'
          }`}
        >
          <Upload size={12} />
          上传照片
        </button>
        <button
          onClick={() => { setActiveTab('url'); setError(''); }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-[12px] font-medium transition-colors ${
            activeTab === 'url'
              ? 'text-zinc-900 border-b-2 border-zinc-900'
              : 'text-zinc-400 hover:text-zinc-600'
          }`}
        >
          <Link2 size={12} />
          粘贴链接
        </button>
      </div>

      {/* Content */}
      <div className="p-4">
        {/* Preview */}
        {previewUrl && (
          <div className="flex items-center gap-3 mb-3 p-2 bg-zinc-50 rounded-lg">
            <img
              src={previewUrl}
              alt="Preview"
              className="w-12 h-16 object-cover rounded border border-zinc-200"
              onError={() => setPreviewUrl('')}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-zinc-500 truncate">{previewUrl.length > 40 ? '...' + previewUrl.slice(-37) : previewUrl}</p>
              <p className="text-[11px] text-green-600 flex items-center gap-1 mt-0.5">
                <Check size={10} /> 已添加
              </p>
            </div>
            <button
              onClick={handleRemovePhoto}
              className="text-zinc-400 hover:text-red-500 transition-colors shrink-0"
              title="移除照片"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {activeTab === 'upload' ? (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileSelect}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || !userId}
              className={`w-full py-6 border-2 border-dashed rounded-lg flex flex-col items-center gap-2 transition-colors ${
                isUploading
                  ? 'border-zinc-200 bg-zinc-50 cursor-wait'
                  : !userId
                    ? 'border-zinc-200 bg-zinc-50 cursor-not-allowed'
                    : 'border-zinc-300 hover:border-zinc-400 hover:bg-zinc-50 cursor-pointer'
              }`}
            >
              {isUploading ? (
                <Loader2 size={20} className="text-zinc-400 animate-spin" />
              ) : (
                <ImageIcon size={20} className="text-zinc-400" />
              )}
              <span className="text-[12px] text-zinc-500">
                {isUploading ? '上传中...' : !userId ? '请先登录' : '点击选择照片'}
              </span>
              <span className="text-[11px] text-zinc-400">
                JPG / PNG / WebP，不超过 2MB
              </span>
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
                placeholder="https://example.com/photo.jpg"
                className="flex-1 px-3 py-2 text-[12px] border border-zinc-200 rounded-lg focus:outline-none focus:border-zinc-400 bg-white"
              />
              <button
                onClick={handleUrlSubmit}
                disabled={isValidating || !urlInput.trim()}
                className="px-3 py-2 bg-zinc-900 text-white text-[12px] rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                {isValidating ? <Loader2 size={12} className="animate-spin" /> : '确认'}
              </button>
            </div>
            <p className="text-[11px] text-zinc-400 leading-relaxed">
              请确保链接可公开访问（如 GitHub 头像、图床链接等）
            </p>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-2 flex items-start gap-1.5 text-[11px] text-red-500">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default PhotoUploadPanel;
