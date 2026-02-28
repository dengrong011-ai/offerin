import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  getSavedInterviewRecords,
  deleteInterviewRecord,
  toggleInterviewFavorite,
  updateInterviewRecordTitle,
} from '../services/interviewRecordService';
import type { SavedInterviewRecord } from '../services/interviewRecordService';
import {
  MessageSquare, Star, Trash2, 
  Loader2, ArrowLeft, Search, MoreHorizontal,
  Clock, X, Type, Users, Play
} from 'lucide-react';

interface InterviewLibraryProps {
  onBack: () => void;
  onOpenRecord: (record: SavedInterviewRecord) => void;
}

const InterviewLibrary: React.FC<InterviewLibraryProps> = ({
  onBack,
  onOpenRecord,
}) => {
  const { user } = useAuth();
  const [records, setRecords] = useState<SavedInterviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null);
  const [editingTitleValue, setEditingTitleValue] = useState('');

  const loadRecords = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const data = await getSavedInterviewRecords(user.id);
    setRecords(data);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    const handleClick = () => setActiveMenu(null);
    if (activeMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [activeMenu]);

  const handleToggleFavorite = async (record: SavedInterviewRecord) => {
    setActionLoading(record.id);
    await toggleInterviewFavorite(record.id, record.is_favorited);
    await loadRecords();
    setActionLoading(null);
  };

  const handleDelete = async (recordId: string) => {
    setActionLoading(recordId);
    setDeleteConfirmId(null);
    setActiveMenu(null);
    await deleteInterviewRecord(recordId);
    await loadRecords();
    setActionLoading(null);
  };

  const handleStartRename = (record: SavedInterviewRecord) => {
    setEditingTitleId(record.id);
    setEditingTitleValue(record.title);
    setActiveMenu(null);
  };

  const handleFinishRename = async (recordId: string) => {
    const trimmed = editingTitleValue.trim();
    if (!trimmed) {
      setEditingTitleId(null);
      return;
    }
    const original = records.find(r => r.id === recordId);
    if (original && trimmed !== original.title) {
      await updateInterviewRecordTitle(recordId, trimmed);
      setRecords(prev => prev.map(r => r.id === recordId ? { ...r, title: trimmed } : r));
    }
    setEditingTitleId(null);
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHour = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 1) return '刚刚';
    if (diffMin < 60) return `${diffMin} 分钟前`;
    if (diffHour < 24) return `${diffHour} 小时前`;
    if (diffDay < 7) return `${diffDay} 天前`;
    return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };

  const roleLabels: Record<string, string> = {
    ta: '第一轮/TA',
    peers: '第二轮/Peers',
    leader: '第三轮/+1',
    director: '第四轮/+2',
    hrbp: '第五轮/HRBP',
  };

  const modeLabel = (mode: string) => mode === 'interactive' ? '人机交互' : '纯AI模拟';

  const filteredRecords = searchQuery
    ? records.filter(r =>
        r.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        r.summary.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : records;

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-zinc-100 rounded-md transition-colors text-zinc-500">
            <ArrowLeft size={18} />
          </button>
          <h2 className="font-display font-semibold text-[18px] text-zinc-900">面试记录库</h2>
          <span className="text-[12px] text-zinc-400 bg-zinc-100 px-2 py-0.5 rounded">
            {records.length} 条
          </span>
        </div>
      </div>

      {/* 搜索 */}
      {records.length > 0 && (
        <div className="relative mb-5">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="搜索面试记录..."
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-lg text-[13px] text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-zinc-400 focus:border-zinc-400 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* 加载中 */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
          <Loader2 size={24} className="animate-spin mb-3" />
          <span className="text-[13px]">加载中...</span>
        </div>
      )}

      {/* 空状态 */}
      {!loading && records.length === 0 && (
        <div className="border border-dashed border-zinc-300 rounded-xl bg-zinc-50/50 p-16 text-center">
          <div className="w-14 h-14 bg-zinc-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <MessageSquare size={24} className="text-zinc-400" />
          </div>
          <h3 className="text-[15px] font-medium text-zinc-700 mb-2">还没有保存的面试记录</h3>
          <p className="text-[13px] text-zinc-500">
            完成模拟面试后，点击"保存记录"即可保存到这里
          </p>
        </div>
      )}

      {/* 记录卡片列表 */}
      {!loading && filteredRecords.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredRecords.map((record) => (
            <div
              key={record.id}
              className="group relative border border-zinc-200 rounded-xl bg-white hover:border-zinc-300 hover:shadow-md transition-all duration-200 overflow-hidden"
            >
              {/* 卡片主体 */}
              <button
                onClick={() => editingTitleId !== record.id && onOpenRecord(record)}
                className="w-full text-left p-5 pb-3"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {record.is_favorited && (
                        <Star size={12} className="text-amber-500 fill-amber-500 shrink-0" />
                      )}
                      {editingTitleId === record.id ? (
                        <input
                          autoFocus
                          value={editingTitleValue}
                          onChange={e => setEditingTitleValue(e.target.value)}
                          onBlur={() => handleFinishRename(record.id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') handleFinishRename(record.id);
                            if (e.key === 'Escape') setEditingTitleId(null);
                          }}
                          onClick={e => e.stopPropagation()}
                          className="font-medium text-[14px] text-zinc-900 w-full bg-zinc-50 border border-zinc-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-zinc-400"
                        />
                      ) : (
                        <h3
                          className="font-medium text-[14px] text-zinc-900 truncate cursor-text hover:text-zinc-600"
                          onClick={e => { e.stopPropagation(); handleStartRename(record); }}
                          title="点击重命名"
                        >
                          {record.title}
                        </h3>
                      )}
                    </div>
                  </div>
                </div>

                {/* 摘要预览 */}
                <p className="text-[12px] text-zinc-500 line-clamp-2 leading-relaxed mb-3">
                  {record.summary
                    ? record.summary.replace(/[#*\-_`>]/g, '').substring(0, 120) + '...'
                    : '暂无摘要'}
                </p>

                {/* 标签 */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    record.interview_mode === 'interactive'
                      ? 'bg-blue-50 text-blue-500'
                      : 'bg-emerald-50 text-emerald-600'
                  }`}>
                    {record.interview_mode === 'interactive' ? (
                      <span className="flex items-center gap-0.5"><Users size={9} /> 人机交互</span>
                    ) : (
                      <span className="flex items-center gap-0.5"><Play size={9} /> 纯AI模拟</span>
                    )}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded">
                    {roleLabels[record.interviewer_role] || record.interviewer_role}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-zinc-100 text-zinc-500 rounded">
                    {record.total_rounds} 轮
                  </span>
                </div>
              </button>

              {/* 底部操作栏 */}
              <div className="px-5 py-2.5 border-t border-zinc-100 flex items-center justify-between">
                <span className="text-[11px] text-zinc-400 flex items-center gap-1">
                  <Clock size={10} />
                  {formatTime(record.updated_at)}
                </span>

                <div className="flex items-center gap-1">
                  {/* 收藏 */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleFavorite(record); }}
                    disabled={actionLoading === record.id}
                    className={`p-1.5 rounded transition-colors ${
                      record.is_favorited
                        ? 'text-amber-500 hover:text-amber-600'
                        : 'text-zinc-300 hover:text-amber-500'
                    }`}
                    title={record.is_favorited ? '取消收藏' : '收藏'}
                  >
                    <Star size={14} className={record.is_favorited ? 'fill-current' : ''} />
                  </button>

                  {/* 更多操作 */}
                  <div className="relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenu(activeMenu === record.id ? null : record.id);
                      }}
                      className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 transition-colors"
                    >
                      <MoreHorizontal size={14} />
                    </button>

                    {activeMenu === record.id && (
                      <div
                        className="absolute right-0 bottom-full mb-1 bg-white border border-zinc-200 rounded-lg shadow-lg py-1 z-50 min-w-[140px]"
                        onClick={e => e.stopPropagation()}
                      >
                        <button
                          onClick={() => { onOpenRecord(record); setActiveMenu(null); }}
                          className="w-full px-3 py-2 text-left text-[12px] text-zinc-700 hover:bg-zinc-50 flex items-center gap-2 transition-colors"
                        >
                          <MessageSquare size={12} /> 查看记录
                        </button>
                        <button
                          onClick={() => handleStartRename(record)}
                          className="w-full px-3 py-2 text-left text-[12px] text-zinc-700 hover:bg-zinc-50 flex items-center gap-2 transition-colors"
                        >
                          <Type size={12} /> 重命名
                        </button>
                        <div className="border-t border-zinc-100 my-1" />
                        <button
                          onClick={() => setDeleteConfirmId(record.id)}
                          className="w-full px-3 py-2 text-left text-[12px] text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
                        >
                          <Trash2 size={12} /> 删除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* 加载遮罩 */}
              {actionLoading === record.id && (
                <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded-xl">
                  <Loader2 size={18} className="animate-spin text-zinc-500" />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 搜索无结果 */}
      {!loading && searchQuery && filteredRecords.length === 0 && records.length > 0 && (
        <div className="text-center py-12 text-zinc-400">
          <Search size={20} className="mx-auto mb-2" />
          <p className="text-[13px]">没有找到匹配的记录</p>
        </div>
      )}

      {/* 删除确认弹窗 */}
      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setDeleteConfirmId(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
            <h3 className="font-semibold text-[15px] text-zinc-900 mb-2">确认删除？</h3>
            <p className="text-[13px] text-zinc-500 mb-5">删除后无法恢复，请确认操作。</p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="flex-1 px-4 py-2 border border-zinc-200 rounded-lg text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(deleteConfirmId)}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-[13px] font-medium transition-colors"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InterviewLibrary;
