import React, { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronRight, Upload, X, Sparkles, FileText, FolderOpen } from 'lucide-react';
import { extractTextFromFile } from '../services/geminiService';
import type { UserPreferences } from '../types';
import { useAuth } from '../contexts/AuthContext';
import SavedResumePickModal, { type SavedResumePickMode } from './SavedResumePickModal';
import type { SavedResume } from '../types';
import { getSavedResumeBodyMarkdown } from '../services/resumeService';

const CORE_NEEDS_OPTIONS = [
  { value: '薪资', label: '薪资提升' },
  { value: '成长', label: '职业成长' },
  { value: 'WLB', label: '工作生活平衡' },
  { value: '稳定性', label: '稳定性' },
  { value: '成就感', label: '成就感' },
  { value: '管理', label: '走管理路线' },
  { value: '技术深度', label: '技术深度' },
  { value: '好平台', label: '好平台' },
  { value: '创新性', label: '创新性' },
  { value: '其他', label: '其他（手动备注）' },
];

const CITY_OPTIONS = ['北京', '上海', '深圳', '杭州', '广州', '成都', '南京', '苏州', '远程', '其他'];

const CHOICE_OPTIONS = [
  { value: 'yes' as const, label: '是' },
  { value: 'no' as const, label: '否' },
  { value: 'maybe' as const, label: '视情况' },
];

interface ExplorePreferencesProps {
  onSubmit: (preferences: UserPreferences) => void;
  isLoading?: boolean;
  /** 免费档「画像+方向」需 2 次计费额度；不足时弹出升级或点主按钮打开会员 */
  trialQuotaBlocksFirstFlow?: boolean;
  onOpenUpgrade?: () => void;
  /** 由 ExplorePage 持有，避免子组件卸载后简历丢失 */
  resumeText: string;
  onResumeTextChange: (text: string) => void;
  resumeLabel: string | null;
  onResumeLabelChange: (label: string | null) => void;
}

const SUPPORTED_RESUME_TYPES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
];

/** 部分浏览器对 PDF 的 file.type 为空或 octet-stream，需按扩展名补全 */
function inferResumeMimeFromFileName(name: string): string | null {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.heic')) return 'image/heic';
  return null;
}

function effectiveResumeMime(file: File): string | null {
  if (file.type && SUPPORTED_RESUME_TYPES.includes(file.type)) return file.type;
  if (file.type === 'application/octet-stream') {
    const fromName = inferResumeMimeFromFileName(file.name);
    if (fromName) return fromName;
  }
  return inferResumeMimeFromFileName(file.name);
}

const ExplorePreferences: React.FC<ExplorePreferencesProps> = ({
  onSubmit,
  isLoading,
  trialQuotaBlocksFirstFlow = false,
  onOpenUpgrade,
  resumeText,
  onResumeTextChange,
  resumeLabel,
  onResumeLabelChange,
}) => {
  const { user } = useAuth();
  const [resumeLibOpen, setResumeLibOpen] = useState(false);
  const [selectedNeeds, setSelectedNeeds] = useState<string[]>([]);
  const [otherRemark, setOtherRemark] = useState('');
  const [salaryMin, setSalaryMin] = useState<string>('');
  const [openToIndustry, setOpenToIndustry] = useState<'yes' | 'no' | 'maybe'>('maybe');
  const [openToCity, setOpenToCity] = useState<'yes' | 'no' | 'maybe'>('maybe');
  const [targetCities, setTargetCities] = useState<string[]>([]);
  const [otherCityRemark, setOtherCityRemark] = useState('');
  const [showResumeInput, setShowResumeInput] = useState(() => resumeText.trim().length > 0);
  const [resumeExtracting, setResumeExtracting] = useState(false);
  const [resumeFileError, setResumeFileError] = useState<string | null>(null);
  const [libraryEmptyHint, setLibraryEmptyHint] = useState<string | null>(null);
  const resumeFileInputRef = useRef<HTMLInputElement>(null);
  const quotaUpgradeAutoShownRef = useRef(false);

  useEffect(() => {
    if (resumeText.trim().length > 0) setShowResumeInput(true);
  }, [resumeText]);

  const hasResume = resumeText.trim().length > 0;
  const formReady = selectedNeeds.length > 0 && hasResume;

  useEffect(() => {
    if (!trialQuotaBlocksFirstFlow) {
      quotaUpgradeAutoShownRef.current = false;
      return;
    }
    if (!formReady || !onOpenUpgrade || quotaUpgradeAutoShownRef.current) return;
    quotaUpgradeAutoShownRef.current = true;
    onOpenUpgrade();
  }, [trialQuotaBlocksFirstFlow, formReady, onOpenUpgrade]);

  const toggleNeed = useCallback((need: string) => {
    setSelectedNeeds(prev =>
      prev.includes(need)
        ? prev.filter(n => n !== need)
        : [...prev, need]
    );
  }, []);

  const toggleCity = useCallback((city: string) => {
    setTargetCities(prev => {
      const next = prev.includes(city) ? prev.filter(c => c !== city) : [...prev, city];
      if (city === '其他' && !next.includes('其他')) setOtherCityRemark('');
      return next;
    });
  }, []);

  const coreNeedsPriorityDisplay = selectedNeeds.map(n => (n === '其他' && otherRemark.trim()) ? `其他：${otherRemark.trim()}` : n);

  const handleSubmit = () => {
    const priority = selectedNeeds.map(n => (n === '其他' && otherRemark.trim()) ? `其他：${otherRemark.trim()}` : n);
    const cities = targetCities.map(c =>
      c === '其他' && otherCityRemark.trim() ? `其他：${otherCityRemark.trim()}` : c
    );
    const preferences: UserPreferences = {
      coreNeeds: selectedNeeds,
      coreNeedsPriority: priority,
      salaryMin: salaryMin ? parseInt(salaryMin) : undefined,
      openToIndustryChange: openToIndustry,
      openToCityChange: openToCity,
      targetCities: cities,
      targetIndustries: [],
    };
    void onSubmit(preferences);
  };

  const readFileToBase64 = (file: File, mimeForApi: string): Promise<{ data: string; mime: string }> => {
    return new Promise((resolve, reject) => {
      if (file.size > 3 * 1024 * 1024) {
        reject(new Error('文件请小于 3MB'));
        return;
      }
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1]?.replace(/\s/g, '') || '';
        resolve({ data: base64, mime: mimeForApi });
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
    });
  };

  const handleResumeFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setResumeFileError(null);
    const mime = effectiveResumeMime(file);
    if (!mime) {
      setResumeFileError('无法识别文件类型。请使用 PDF 或常见图片；若已是 PDF，请确认扩展名为 .pdf。');
      return;
    }
    setResumeExtracting(true);
    onResumeLabelChange(file.name);
    try {
      const { data, mime: apiMime } = await readFileToBase64(file, mime);
      const text = await extractTextFromFile({ data, mimeType: apiMime });
      const trimmed = (text || '').trim();
      if (!trimmed) {
        setResumeFileError('未能从文件中提取到文字。可尝试：另存为新 PDF、截图上传、或直接粘贴简历文本。');
        onResumeLabelChange(null);
        onResumeTextChange('');
        return;
      }
      onResumeTextChange(trimmed);
      setShowResumeInput(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '解析失败';
      setResumeFileError(msg);
      onResumeLabelChange(null);
      onResumeTextChange('');
    } finally {
      setResumeExtracting(false);
    }
  };

  const clearResume = () => {
    onResumeTextChange('');
    onResumeLabelChange(null);
    setShowResumeInput(false);
    setResumeFileError(null);
  };

  const handleResumeLibraryPick = useCallback((r: SavedResume, mode: SavedResumePickMode) => {
    if (mode !== 'resume') return;
    const text = getSavedResumeBodyMarkdown(r);
    if (!text) {
      setLibraryEmptyHint('该版本中文/英文正文均为空，请先在「简历库」中打开并保存后再试。');
      return;
    }
    setLibraryEmptyHint(null);
    onResumeTextChange(text);
    const zh = (r.resume_markdown || '').trim();
    onResumeLabelChange(r.title + (zh ? '' : '（英文版）'));
    setShowResumeInput(true);
  }, [onResumeLabelChange, onResumeTextChange]);

  const handlePrimaryClick = () => {
    if (trialQuotaBlocksFirstFlow) {
      onOpenUpgrade?.();
      return;
    }
    handleSubmit();
  };

  const primaryDisabled = isLoading || !formReady;
  const primaryQuotaBlocked = trialQuotaBlocksFirstFlow && formReady;

  return (
    <>
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-zinc-900 mb-2">告诉我们你的求职偏好</h2>
        <p className="text-sm text-zinc-500">填写偏好并上传简历后，AI 将为你推荐最适合的职业方向</p>
      </div>

      <div className="mb-8">
        <label className="block text-sm font-medium text-zinc-700 mb-3">
          核心诉求 <span className="text-zinc-400 font-normal">（选择并按优先级排序，先选=更重要）</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {CORE_NEEDS_OPTIONS.map(option => {
            const isSelected = selectedNeeds.includes(option.value);
            const index = selectedNeeds.indexOf(option.value);
            return (
              <button
                key={option.value}
                onClick={() => toggleNeed(option.value)}
                className={`relative px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                  isSelected ? 'bg-zinc-900 text-white shadow-sm' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
              >
                {isSelected && (
                  <span className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-white text-zinc-900 text-[10px] font-bold flex items-center justify-center shadow-sm border border-zinc-200">
                    {index + 1}
                  </span>
                )}
                {option.label}
              </button>
            );
          })}
        </div>
        {selectedNeeds.includes('其他') && (
          <div className="mt-3">
            <input
              type="text"
              value={otherRemark}
              onChange={e => setOtherRemark(e.target.value)}
              placeholder="请填写你的其他诉求..."
              className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400"
            />
          </div>
        )}
        {selectedNeeds.length > 0 && (
          <p className="mt-2 text-xs text-zinc-400">优先级：{coreNeedsPriorityDisplay.join(' > ')}</p>
        )}
      </div>

      <div className="mb-8">
        <label className="block text-sm font-medium text-zinc-700 mb-3">期望最低月薪（K）</label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            placeholder="如 30"
            value={salaryMin}
            onChange={e => setSalaryMin(e.target.value)}
            className="w-28 px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-900 placeholder-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400"
          />
          <span className="text-xs text-zinc-400">K / 月 起</span>
        </div>
        <p className="mt-1 text-xs text-zinc-400">不填表示不限</p>
      </div>

      <div className="mb-8">
        <label className="block text-sm font-medium text-zinc-700 mb-3">是否愿意换行业</label>
        <div className="flex gap-2">
          {CHOICE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setOpenToIndustry(opt.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                openToIndustry === opt.value ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-8">
        <label className="block text-sm font-medium text-zinc-700 mb-3">是否愿意换城市</label>
        <div className="flex gap-2 mb-3">
          {CHOICE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setOpenToCity(opt.value)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                openToCity === opt.value ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {openToCity !== 'no' && (
          <div>
            <p className="text-xs text-zinc-400 mb-2">目标城市（可多选）</p>
            <div className="flex flex-wrap gap-2">
              {CITY_OPTIONS.map(city => (
                <button
                  key={city}
                  onClick={() => toggleCity(city)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    targetCities.includes(city) ? 'bg-zinc-800 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'
                  }`}
                >
                  {city === '其他' ? '其他（手动备注）' : city}
                </button>
              ))}
            </div>
            {targetCities.includes('其他') && (
              <div className="mt-3">
                <input
                  type="text"
                  value={otherCityRemark}
                  onChange={e => setOtherCityRemark(e.target.value)}
                  placeholder="请填写目标城市或地区..."
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400"
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-10">
        <label className="block text-sm font-medium text-zinc-700 mb-2">
          上传简历 <span className="text-red-400 font-normal">*</span>
        </label>
        <p className="text-[11px] text-zinc-400 mb-3">AI 需要你的简历来分析技能和经验，精准匹配方向。支持 PDF、图片或直接粘贴文本。</p>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <button
            type="button"
            onClick={() => resumeFileInputRef.current?.click()}
            disabled={resumeExtracting}
            className="text-xs text-zinc-500 hover:text-zinc-700 flex items-center gap-1 transition-colors border border-zinc-200 rounded-lg px-3 py-2 hover:bg-zinc-50 disabled:opacity-50"
          >
            <Upload size={12} />
            {resumeExtracting ? '解析中...' : '上传文件'}
          </button>
          <input
            ref={resumeFileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,image/*"
            onChange={handleResumeFileChange}
          />
          <button
            type="button"
            onClick={() => setShowResumeInput(true)}
            className="text-xs text-zinc-500 hover:text-zinc-700 flex items-center gap-1 transition-colors border border-zinc-200 rounded-lg px-3 py-2 hover:bg-zinc-50"
          >
            <FileText size={12} />
            粘贴简历文本
          </button>
          {user ? (
            <button
              type="button"
              onClick={() => {
                setLibraryEmptyHint(null);
                setResumeLibOpen(true);
              }}
              className="text-xs text-zinc-500 hover:text-zinc-700 flex items-center gap-1 transition-colors border border-zinc-200 rounded-lg px-3 py-2 hover:bg-zinc-50"
            >
              <FolderOpen size={12} />
              从简历库选择
            </button>
          ) : (
            <span className="text-[11px] text-zinc-400 self-center">登录后可从简历库导入</span>
          )}
          {resumeLabel && (
            <span className="text-xs text-zinc-500 flex items-center gap-1">
              {resumeLabel}
              <button type="button" onClick={clearResume} className="text-zinc-400 hover:text-zinc-600">
                <X size={12} />
              </button>
            </span>
          )}
        </div>
        {resumeFileError && (
          <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-2">{resumeFileError}</p>
        )}
        {libraryEmptyHint && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-2">{libraryEmptyHint}</p>
        )}
        {showResumeInput && (
          <div className="relative">
            <textarea
              value={resumeText}
              onChange={e => onResumeTextChange(e.target.value)}
              placeholder="粘贴你的简历文本内容..."
              rows={6}
              className="w-full px-3 py-2.5 border border-zinc-200 rounded-lg text-sm text-zinc-900 placeholder-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 resize-none"
            />
            <button
              type="button"
              onClick={clearResume}
              className="absolute top-2 right-2 text-zinc-300 hover:text-zinc-500 transition-colors"
            >
              <X size={14} />
            </button>
            {resumeText && <p className="mt-1 text-xs text-zinc-400">已输入 {resumeText.length} 字</p>}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handlePrimaryClick}
        disabled={primaryDisabled}
        className={`w-full py-3 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
          primaryDisabled
            ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed'
            : primaryQuotaBlocked
              ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:from-amber-600 hover:to-orange-600 shadow-sm'
              : 'bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm'
        }`}
      >
        {isLoading ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            AI 正在分析...
          </>
        ) : primaryQuotaBlocked ? (
          <>升级会员，继续职业探索</>
        ) : (
          <>
            <Sparkles size={16} />
            AI 推荐方向
            <ChevronRight size={16} />
          </>
        )}
      </button>
      {(primaryDisabled && !isLoading) || trialQuotaBlocksFirstFlow ? (
        <p className="mt-2 text-center text-xs text-zinc-400">
          {trialQuotaBlocksFirstFlow
            ? '免费体验计费额度不足：完成「画像 + 方向」需要 2 次（共 3 次可用）。已为你弹出会员方案，也可点上方按钮再次打开。'
            : selectedNeeds.length === 0 && !hasResume
              ? '请选择核心诉求并上传简历'
              : selectedNeeds.length === 0
                ? '请先在上方「核心诉求」中至少点选一项（如成长、好平台），再点 AI 推荐方向'
                : '请上传简历、粘贴文本或从简历库载入正文'}
        </p>
      ) : null}
    </div>
    {user?.id && (
      <SavedResumePickModal
        isOpen={resumeLibOpen}
        onClose={() => setResumeLibOpen(false)}
        userId={user.id}
        modes={['resume']}
        title="从简历库载入简历"
        onPick={handleResumeLibraryPick}
      />
    )}
    </>
  );
};

export default ExplorePreferences;
