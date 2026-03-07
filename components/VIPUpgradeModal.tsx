import React, { useState, useEffect, useRef } from 'react';
import { X, Crown, Check, Loader2, Sparkles, FileText, MessageSquare, QrCode, RefreshCw, Smartphone, Globe, Download } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { 
  XORPAY_PRODUCTS,
  createXorPayOrder, 
  handlePaymentSuccess,
  formatXorPayPrice,
  generateQRCodeUrl,
} from '../services/xorpayService';
import type { XorPayProductType } from '../services/xorpayService';
import { supabase, isSupabaseConfigured } from '../services/supabaseClient';

interface VIPUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type PaymentStep = 'info' | 'qrcode' | 'polling' | 'success' | 'error';
type PlanType = 'vip_sprint' | 'vip_monthly';

export const VIPUpgradeModal: React.FC<VIPUpgradeModalProps> = ({ 
  isOpen, 
  onClose,
  onSuccess 
}) => {
  const { user, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('info');
  const [selectedPlan, setSelectedPlan] = useState<PlanType>('vip_sprint');
  
  // 支付相关状态
  const [orderId, setOrderId] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [countdown, setCountdown] = useState(0);
  
  // 轮询相关
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const sprintProduct = XORPAY_PRODUCTS['vip_sprint'];
  const monthlyProduct = XORPAY_PRODUCTS['vip_monthly'];

  // 清理定时器
  const clearTimers = () => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  // 关闭时清理
  useEffect(() => {
    return () => clearTimers();
  }, []);

  // 重置状态
  const resetState = () => {
    clearTimers();
    setPaymentStep('info');
    setOrderId('');
    setQrCodeUrl('');
    setCountdown(0);
    setError('');
    setLoading(false);
  };

  // 关闭弹窗
  const handleClose = () => {
    resetState();
    onClose();
  };

  // 开始支付流程
  const handleStartPayment = async () => {
    if (!user) {
      setError('请先登录');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const notifyUrl = import.meta.env.VITE_XORPAY_NOTIFY_URL || 
        `${window.location.origin}/api/xorpay/notify`;

      const result = await createXorPayOrder(user.id, selectedPlan as XorPayProductType, notifyUrl);

      if (!result.success) {
        throw new Error(result.error || '创建订单失败');
      }

      setOrderId(result.orderId || '');
      setQrCodeUrl(result.qrCode ? generateQRCodeUrl(result.qrCode, 180) : '');
      setCountdown(300);
      setPaymentStep('qrcode');

      countdownRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearTimers();
            setPaymentStep('error');
            setError('二维码已过期，请重新生成');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      startPolling(result.orderId || '');
    } catch (err: any) {
      console.error('创建支付订单失败:', err);
      setError(err.message || '创建订单失败，请重试');
      setPaymentStep('error');
    } finally {
      setLoading(false);
    }
  };

  // 轮询支付状态
  const startPolling = (orderIdToCheck: string) => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
    }

    const poll = async () => {
      try {
        if (isSupabaseConfigured) {
          const { data, error } = await supabase
            .from('payment_orders')
            .select('status')
            .eq('id', orderIdToCheck)
            .single();

          if (!error && data && data.status === 'paid') {
            clearTimers();
            setPaymentStep('polling');
            await refreshProfile();
            setPaymentStep('success');
            setTimeout(() => {
              onSuccess?.();
              handleClose();
            }, 2000);
          }
        }
      } catch (err) {
        console.error('查询支付状态失败:', err);
      }
    };

    poll();
    pollingRef.current = setInterval(poll, 3000);
  };

  // 重新生成二维码
  const handleRefreshQRCode = () => {
    resetState();
    handleStartPayment();
  };

  // 模拟支付成功（仅开发测试用）
  const handleSimulateSuccess = async () => {
    if (!user || !orderId) return;
    clearTimers();
    setPaymentStep('polling');
    await handlePaymentSuccess(orderId, user.id, selectedPlan as XorPayProductType);
    await refreshProfile();
    setPaymentStep('success');
    setTimeout(() => {
      onSuccess?.();
      handleClose();
    }, 2000);
  };

  // 格式化倒计时
  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const currentProduct = selectedPlan === 'vip_sprint' ? sprintProduct : monthlyProduct;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={paymentStep === 'info' || paymentStep === 'error' ? handleClose : undefined}
      />
      
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[460px] mx-4 overflow-hidden">
        {/* 头部 */}
        <div className="bg-zinc-900 px-6 py-5 text-white relative overflow-hidden">
          <button
            onClick={handleClose}
            disabled={paymentStep === 'polling'}
            className="absolute top-4 right-4 p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50 z-10"
          >
            <X size={18} />
          </button>
          
          <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/5 rounded-full" />
          <div className="absolute -right-4 top-12 w-16 h-16 bg-white/5 rounded-full" />
          
          <div className="relative">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-11 h-11 bg-white/10 rounded-xl flex items-center justify-center">
                <Crown size={24} />
              </div>
              <div>
                <h2 className="text-lg font-bold">升级 VIP 会员</h2>
                <p className="text-white/60 text-sm">解锁全部功能，高效求职</p>
              </div>
            </div>
          </div>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-5">
          {paymentStep === 'success' ? (
            <div className="py-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-zinc-900 mb-2">开通成功！</h3>
              <p className="text-zinc-500">恭喜您成为 VIP 会员，尽享全部权益</p>
            </div>
          ) : paymentStep === 'polling' ? (
            <div className="py-8 text-center">
              <Loader2 size={48} className="animate-spin text-zinc-700 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-zinc-900 mb-2">正在确认支付...</h3>
              <p className="text-zinc-500 text-sm">请稍候，正在验证支付结果</p>
            </div>
          ) : paymentStep === 'qrcode' ? (
            <div className="text-center">
              <div className="bg-white border-2 border-zinc-200 rounded-xl p-4 inline-block mb-4">
                <img src={qrCodeUrl} alt="支付二维码" className="w-[180px] h-[180px]" />
              </div>
              <div className="flex items-center justify-center gap-2 text-zinc-600 mb-3">
                <Smartphone size={16} />
                <span className="text-sm">请使用支付宝扫码支付</span>
              </div>
              <div className="flex items-center justify-center gap-4 text-sm">
                <span className="text-zinc-500">支付金额</span>
                <span className="text-xl font-bold text-zinc-900">{formatXorPayPrice(currentProduct.priceInCents)}</span>
              </div>
              <div className="text-xs text-zinc-400 mt-2">
                二维码有效期 {formatCountdown(countdown)}
              </div>
              <button onClick={handleRefreshQRCode} className="mt-4 text-sm text-zinc-500 hover:text-zinc-700 flex items-center gap-1 mx-auto">
                <RefreshCw size={14} /> 刷新二维码
              </button>
              {(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && (
                <button onClick={handleSimulateSuccess} className="mt-3 text-xs text-blue-500 hover:text-blue-600 underline">
                  [开发模式] 模拟支付成功
                </button>
              )}
            </div>
          ) : paymentStep === 'error' ? (
            <div className="py-4 text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <X size={28} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 mb-1">支付失败</h3>
              <p className="text-zinc-500 text-sm mb-4">{error || '请重试'}</p>
              <button onClick={handleRefreshQRCode} className="px-6 py-2.5 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-800 transition-all">
                重新支付
              </button>
            </div>
          ) : (
            <>
              {/* 套餐选择 */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                {/* 冲刺计划 */}
                <button
                  onClick={() => setSelectedPlan('vip_sprint')}
                  className={`relative rounded-xl p-4 border-2 transition-all text-left ${
                    selectedPlan === 'vip_sprint' 
                      ? 'border-zinc-900 bg-zinc-50 shadow-sm' 
                      : 'border-zinc-200 hover:border-zinc-300'
                  }`}
                >
                  <span className="absolute -top-2.5 left-3 px-2 py-0.5 bg-zinc-900 text-white text-[10px] font-medium rounded-full">
                    热门
                  </span>
                  <div className="text-sm font-semibold text-zinc-900 mb-1">冲刺计划</div>
                  <div className="text-xs text-zinc-500 mb-3">10 天有效</div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-zinc-900">{formatXorPayPrice(sprintProduct.priceInCents)}</span>
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-1">
                    <span className="line-through">¥29.9</span>
                    <span className="ml-1 text-zinc-600 font-medium">省33%</span>
                  </div>
                  {selectedPlan === 'vip_sprint' && (
                    <div className="absolute top-3 right-3 w-5 h-5 bg-zinc-900 rounded-full flex items-center justify-center">
                      <Check size={12} className="text-white" />
                    </div>
                  )}
                </button>

                {/* 月度会员 */}
                <button
                  onClick={() => setSelectedPlan('vip_monthly')}
                  className={`relative rounded-xl p-4 border-2 transition-all text-left ${
                    selectedPlan === 'vip_monthly' 
                      ? 'border-zinc-900 bg-zinc-50 shadow-sm' 
                      : 'border-zinc-200 hover:border-zinc-300'
                  }`}
                >
                  <span className="absolute -top-2.5 left-3 px-2 py-0.5 bg-zinc-600 text-white text-[10px] font-medium rounded-full">
                    更划算
                  </span>
                  <div className="text-sm font-semibold text-zinc-900 mb-1">月度会员</div>
                  <div className="text-xs text-zinc-500 mb-3">30 天有效</div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold text-zinc-900">{formatXorPayPrice(monthlyProduct.priceInCents)}</span>
                  </div>
                  <div className="text-[10px] text-zinc-400 mt-1">
                    <span className="line-through">¥39.9</span>
                    <span className="ml-1 text-zinc-600 font-medium">省25%</span>
                  </div>
                  {selectedPlan === 'vip_monthly' && (
                    <div className="absolute top-3 right-3 w-5 h-5 bg-zinc-900 rounded-full flex items-center justify-center">
                      <Check size={12} className="text-white" />
                    </div>
                  )}
                </button>
              </div>

              {/* VIP 权益列表 */}
              <div className="space-y-3 mb-5">
                <h4 className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                  <Sparkles size={14} className="text-zinc-600" />
                  会员专属权益
                </h4>
                <div className="space-y-2">
                  {[
                    { icon: FileText, text: '简历诊断 无限次', desc: '智能分析，精准优化' },
                    { icon: MessageSquare, text: '模拟面试 无限次', desc: '多轮面试，全真模拟' },
                    { icon: Download, text: 'PDF 导出无限', desc: '一键下载，随时使用' },
                    { icon: Globe, text: '英文简历翻译无限', desc: '专业翻译，助力海外求职' },
                    { icon: Crown, text: '面试记录导出', desc: '保存复盘，持续提升' },
                  ].map((item, index) => (
                    <div key={index} className="flex items-center gap-3 p-2.5 bg-zinc-50 rounded-lg">
                      <div className="w-7 h-7 bg-zinc-200 rounded-lg flex items-center justify-center flex-shrink-0">
                        <item.icon size={14} className="text-zinc-700" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-zinc-900 text-sm">{item.text}</div>
                      </div>
                      <Check size={14} className="text-zinc-600 flex-shrink-0" />
                    </div>
                  ))}
                </div>
              </div>

              {/* 对比免费版 */}
              <div className="bg-zinc-100 rounded-lg p-3 mb-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">免费版</span>
                  <span className="text-zinc-400">诊断3次 · 面试1次 · 导出免费</span>
                </div>
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-sm">
                  {error}
                </div>
              )}

              {/* 支付按钮 */}
              <button
                onClick={handleStartPayment}
                disabled={loading}
                className="w-full py-3.5 bg-zinc-900 text-white rounded-xl font-semibold hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    生成支付码...
                  </>
                ) : (
                  <>
                    <QrCode size={18} />
                    支付宝扫码开通 {formatXorPayPrice(currentProduct.priceInCents)}{selectedPlan === 'vip_sprint' ? '/10天' : '/月'}
                  </>
                )}
              </button>

              <p className="text-xs text-zinc-400 text-center mt-3">
                支付即表示同意《VIP会员服务协议》，开通后不支持退款
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default VIPUpgradeModal;
