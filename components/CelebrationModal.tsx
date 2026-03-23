import React, { useEffect, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';

interface CelebrationModalProps {
  totalWeeks: number;
  totalTasks: number;
  onClose: () => void;
}

const CelebrationModal: React.FC<CelebrationModalProps> = ({ totalWeeks, totalTasks, onClose }) => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 300);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
    >
      <style>{`
        @keyframes iconPop {
          0% { transform: scale(0.85); opacity: 0.6; }
          60% { transform: scale(1.08); }
          100% { transform: scale(1); opacity: 1; }
        }
      `}</style>
      <div className="absolute inset-0 bg-black/30" onClick={handleClose} />

      {/* Card - 简洁克制 */}
      <div
        className={`relative bg-white rounded-2xl shadow-xl p-8 max-w-sm mx-4 text-center transition-all duration-500 ${
          visible ? 'scale-100 translate-y-0 opacity-100' : 'scale-95 translate-y-2 opacity-0'
        }`}
      >
        <div
          className="w-14 h-14 mx-auto mb-4 rounded-full bg-zinc-100 flex items-center justify-center"
          style={visible ? { animation: 'iconPop 0.5s ease-out forwards' } : undefined}
        >
          <CheckCircle2 size={28} className="text-zinc-700" strokeWidth={2} />
        </div>

        <h2 className="text-lg font-semibold text-zinc-900 mb-2">
          计划全部完成 ✨
        </h2>

        <p className="text-sm text-zinc-500 mb-6 leading-relaxed">
          共 {totalWeeks} 周、{totalTasks} 项任务。
          <br />
          付出终有回报，祝你拿到心仪的 offer！🎉
        </p>

        <button
          onClick={handleClose}
          className="px-6 py-2 text-zinc-900 text-sm font-medium rounded-lg border border-zinc-200 hover:bg-zinc-50 transition-colors"
        >
          继续
        </button>
      </div>
    </div>
  );
};

export default CelebrationModal;
