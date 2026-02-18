import React, { useState, useEffect } from 'react';
import { Mail, Loader2, X, Check, Crown, User, LogOut, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { sendOTP, verifyOTP, signOut } from '../services/authService';

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose }) => {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendOTP = async () => {
    if (!email || !email.includes('@')) {
      setError('请输入有效的邮箱地址');
      return;
    }

    setLoading(true);
    setError('');

    const result = await sendOTP(email);
    
    setLoading(false);
    
    if (result.success) {
      setStep('otp');
      setCountdown(60);
    } else {
      setError(result.error || '发送验证码失败');
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp || otp.length < 6) {
      setError('请输入6位验证码');
      return;
    }

    setLoading(true);
    setError('');

    const result = await verifyOTP(email, otp);
    
    setLoading(false);
    
    if (result.success) {
      onClose();
      setEmail('');
      setOtp('');
      setStep('email');
    } else {
      setError(result.error || '验证码错误');
    }
  };

  const handleResendOTP = async () => {
    if (countdown > 0) return;
    await handleSendOTP();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* 模态框 */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-[380px] mx-4 overflow-hidden border border-zinc-200">
        {/* 头部 */}
        <div className="px-6 pt-6 pb-4">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors"
          >
            <X size={18} />
          </button>
          <h2 className="text-[18px] font-semibold text-zinc-900">登录</h2>
          <p className="text-zinc-500 text-[13px] mt-1">使用邮箱验证码登录 Offerin</p>
        </div>

        {/* 内容区 */}
        <div className="px-6 pb-6">
          {step === 'email' ? (
            <>
              <div className="mb-4">
                <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">
                  邮箱地址
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full pl-10 pr-4 py-2.5 border border-zinc-200 rounded-lg text-[14px] focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all"
                    onKeyDown={(e) => e.key === 'Enter' && handleSendOTP()}
                  />
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-[13px]">
                  {error}
                </div>
              )}

              <button
                onClick={handleSendOTP}
                disabled={loading || !email}
                className="w-full py-2.5 bg-zinc-900 text-white rounded-lg text-[14px] font-medium hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    发送中...
                  </>
                ) : (
                  '发送验证码'
                )}
              </button>
            </>
          ) : (
            <>
              <div className="mb-1.5 text-[13px] text-zinc-500">
                验证码已发送至 <span className="font-medium text-zinc-700">{email}</span>
              </div>
              
              <div className="mb-4">
                <label className="block text-[13px] font-medium text-zinc-700 mb-1.5">
                  验证码
                </label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="00000000"
                  className="w-full px-4 py-2.5 border border-zinc-200 rounded-lg text-[18px] focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent transition-all text-center tracking-[0.3em] font-mono"
                  maxLength={8}
                  onKeyDown={(e) => e.key === 'Enter' && handleVerifyOTP()}
                />
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-[13px]">
                  {error}
                </div>
              )}

              <button
                onClick={handleVerifyOTP}
                disabled={loading || otp.length < 8}
                className="w-full py-2.5 bg-zinc-900 text-white rounded-lg text-[14px] font-medium hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    验证中...
                  </>
                ) : (
                  '登录'
                )}
              </button>

              <div className="mt-3 flex items-center justify-between text-[13px]">
                <button
                  onClick={() => setStep('email')}
                  className="text-zinc-500 hover:text-zinc-900 transition-colors"
                >
                  ← 修改邮箱
                </button>
                <button
                  onClick={handleResendOTP}
                  disabled={countdown > 0}
                  className="text-zinc-500 hover:text-zinc-900 disabled:text-zinc-300 transition-colors"
                >
                  {countdown > 0 ? `${countdown}s 后重发` : '重新发送'}
                </button>
              </div>
            </>
          )}

          {/* 权益说明 */}
          <div className="mt-5 pt-5 border-t border-zinc-100">
            <p className="text-[12px] text-zinc-400 mb-2">登录后可享受：</p>
            <div className="grid grid-cols-2 gap-1.5 text-[12px]">
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Check size={12} className="text-zinc-400" />
                每日3次免费诊断
              </div>
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Check size={12} className="text-zinc-400" />
                简历导出功能
              </div>
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Check size={12} className="text-zinc-400" />
                模拟面试练习
              </div>
              <div className="flex items-center gap-1.5 text-zinc-500">
                <Crown size={12} className="text-zinc-400" />
                VIP 无限使用
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// 用户头像/登录按钮组件
interface UserAvatarProps {
  onLoginClick: () => void;
}

export const UserAvatar: React.FC<UserAvatarProps> = ({ onLoginClick }) => {
  const { user, profile, loading } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    setShowDropdown(false);
  };

  if (loading) {
    return (
      <div className="w-8 h-8 rounded-full bg-zinc-100 animate-pulse" />
    );
  }

  if (!user) {
    return (
      <button
        onClick={onLoginClick}
        className="px-4 py-2 border border-zinc-200 text-zinc-700 rounded-md text-[13px] font-medium hover:bg-zinc-50 hover:border-zinc-300 transition-all flex items-center gap-2"
      >
        <User size={14} />
        登录
      </button>
    );
  }

  const membershipLabel = {
    free: '免费版',
    vip: 'VIP',
    pro: 'Pro',
  };

  const membershipColor = {
    free: 'bg-zinc-100 text-zinc-600',
    vip: 'bg-zinc-900 text-white',
    pro: 'bg-zinc-900 text-white',
  };

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 p-1 rounded-lg hover:bg-zinc-100 transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-zinc-900 flex items-center justify-center text-white font-medium text-[13px]">
          {profile?.nickname?.charAt(0).toUpperCase() || user.email?.charAt(0).toUpperCase()}
        </div>
        <ChevronDown size={14} className="text-zinc-400" />
      </button>

      {showDropdown && (
        <>
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setShowDropdown(false)}
          />
          <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-xl border border-zinc-200 overflow-hidden z-50">
            {/* 用户信息 */}
            <div className="p-4 border-b border-zinc-100">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-zinc-900 flex items-center justify-center text-white font-medium text-[14px]">
                  {profile?.nickname?.charAt(0).toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[14px] text-zinc-900 truncate">
                    {profile?.nickname || '用户'}
                  </div>
                  <div className="text-[12px] text-zinc-400 truncate">
                    {user.email}
                  </div>
                </div>
              </div>
              <div className="mt-2">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${membershipColor[profile?.membership_type || 'free']}`}>
                  {profile?.membership_type === 'vip' || profile?.membership_type === 'pro' ? (
                    <Crown size={10} />
                  ) : null}
                  {membershipLabel[profile?.membership_type || 'free']}
                </span>
              </div>
            </div>

            {/* 菜单项 */}
            <div className="p-1.5">
              {profile?.membership_type === 'free' && (
                <button className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-zinc-600 hover:bg-zinc-50 rounded-md transition-colors">
                  <Crown size={14} />
                  升级 VIP
                </button>
              )}
              <button
                onClick={handleSignOut}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] text-zinc-600 hover:bg-zinc-50 rounded-md transition-colors"
              >
                <LogOut size={14} />
                退出登录
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default LoginModal;
