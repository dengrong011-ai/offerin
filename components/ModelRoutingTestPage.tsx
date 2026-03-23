import React, { useState, useCallback } from 'react';
import { ArrowLeft, Loader2, FlaskConical } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { translateResume, rewriteSelectedText } from '../services/geminiService';
import {
  FALLBACK_RESUME_EDIT,
  FALLBACK_TRANSLATION,
  MODEL_PRIMARY_RESUME_EDIT,
  MODEL_PRIMARY_TRANSLATION,
} from '../services/geminiModelRouting';

interface Props {
  onClose: () => void;
}

/**
 * 本地/预发验证混合模型路由：访问 ?modeltest=1
 * 实际命中模型见浏览器 Network → gemini/proxy → Response Headers「X-Gemini-Model」
 */
const ModelRoutingTestPage: React.FC<Props> = ({ onClose }) => {
  const { user } = useAuth();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const append = useCallback((line: string) => {
    setLog((prev) => [...prev, `${new Date().toISOString().slice(11, 19)}  ${line}`]);
  }, []);

  const runTranslation = useCallback(async () => {
    if (!user) {
      append('请先登录主站后再测（右上角头像登录）');
      return;
    }
    setBusy(true);
    append(
      `翻译：主 ${MODEL_PRIMARY_TRANSLATION} → ${[...FALLBACK_TRANSLATION].join(' → ')}`
    );
    try {
      const out = await translateResume('# 测试\n\n- 负责产品增长');
      append(`翻译成功，返回约 ${out.length} 字符（看 Network 响应头 X-Gemini-Model）`);
    } catch (e: any) {
      append(`翻译失败：${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [user, append]);

  const runResumeEditStream = useCallback(async () => {
    if (!user) {
      append('请先登录主站后再测');
      return;
    }
    setBusy(true);
    append(
      `局部编辑流式：主 ${MODEL_PRIMARY_RESUME_EDIT} → ${[...FALLBACK_RESUME_EDIT].join(' → ')}`
    );
    try {
      await rewriteSelectedText(
        '- 负责运营工作',
        'rewrite',
        undefined,
        { fullResume: '# 张三\n\n## 工作经历\n- 负责运营工作', jd: '产品经理' },
        {
          onChunk: () => {},
          onComplete: (t) => {
            append(`局部重写完成，约 ${t.length} 字符（看 Network X-Gemini-Model）`);
          },
          onError: (err) => append(`流式错误：${err}`),
        }
      );
    } catch (e: any) {
      append(`局部编辑失败：${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  }, [user, append]);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 text-sm text-zinc-600 hover:text-zinc-900"
        >
          <ArrowLeft size={16} />
          返回主站
        </button>
        <div className="flex items-center gap-2 text-sm font-medium">
          <FlaskConical size={16} className="text-amber-600" />
          模型路由自测（modeltest=1）
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-[13px] text-zinc-600 leading-relaxed space-y-2">
          <p>
            <strong className="text-zinc-800">期望路由</strong>：翻译主 <code className="text-xs bg-zinc-100 px-1 rounded">2.5-pro</code>
            ；局部编辑/精简主 <code className="text-xs bg-zinc-100 px-1 rounded">2.5-flash</code>
            ；诊断/重构/面试/职业探索仍为 <code className="text-xs bg-zinc-100 px-1 rounded">3.1-pro</code>。
          </p>
          <p>
            本地需能打到代理：配置 <code className="text-xs bg-zinc-100 px-1 rounded">VITE_REMOTE_PROXY_URL</code>
            指向已部署环境，或使用 <code className="text-xs bg-zinc-100 px-1 rounded">vercel dev</code>。
          </p>
          <p>
            打开开发者工具 → Network → 筛选 <code className="text-xs bg-zinc-100 px-1 rounded">proxy</code> → 查看响应头{' '}
            <code className="text-xs bg-zinc-100 px-1 rounded">X-Gemini-Model</code>。
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={runTranslation}
            className="px-4 py-2 rounded-md bg-zinc-900 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? <Loader2 className="animate-spin inline mr-1" size={14} /> : null}
            测翻译（translation）
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={runResumeEditStream}
            className="px-4 py-2 rounded-md border border-zinc-300 bg-white text-sm font-medium disabled:opacity-50"
          >
            测局部编辑流式（resume_edit）
          </button>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-zinc-900 text-zinc-100 p-4 font-mono text-[11px] whitespace-pre-wrap min-h-[120px]">
          {log.length === 0 ? '日志…' : log.join('\n')}
        </div>
      </div>
    </div>
  );
};

export default ModelRoutingTestPage;
