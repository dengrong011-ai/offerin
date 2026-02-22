import React, { useState, useEffect, useRef } from 'react';
import { X, Download, Check, Loader2, Crown, FileText, QrCode, RefreshCw, Smartphone } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { 
  XORPAY_PRODUCTS,
  createXorPayOrder, 
  queryXorPayOrderStatus,
  handlePaymentSuccess,
  generateQRCodeUrl,
  formatXorPayPrice,
  isXorPayConfigured,
} from '../services/xorpayService';

interface DownloadPayModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;  // 支付成功后执行下载
  onUpgradeVIP?: () => void; // 跳转到升级 VIP
}

type PaymentStep = 'select' | 'qrcode' | 'polling' | 'success' | 'error';

export const DownloadPayModal: React.FC<DownloadPayModalProps> = ({ 
  isOpen, 
  onClose,
  onSuccess,
  onUpgradeVIP
}) => {
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('select');
  
  // 支付相关状态
  const [orderId, setOrderId] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [expiresIn, setExpiresIn] = useState(0);
  const [countdown, setCountdown] = useState(0);
  
  // 轮询相关
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const product = XORPAY_PRODUCTS['resume_download'];

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
    setPaymentStep('select');
    setOrderId('');
    setQrCodeUrl('');
    setExpiresIn(0);
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
      // 获取回调地址（生产环境需要配置真实的 webhook URL）
      const notifyUrl = import.meta.env.VITE_XORPAY_NOTIFY_URL || 
        `${window.location.origin}/api/xorpay/notify`;

      // 创建支付订单
      const result = await createXorPayOrder(user.id, 'resume_download', notifyUrl);

      if (!result.success || !result.qrCode) {
        throw new Error(result.error || '创建订单失败');
      }

      setOrderId(result.orderId || '');
      setQrCodeUrl(generateQRCodeUrl(result.qrCode, 200));
      setExpiresIn(result.expiresIn || 7200);
      setCountdown(result.expiresIn || 7200);
      setPaymentStep('qrcode');

      // 开始倒计时
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

      // 开始轮询支付状态
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
        const result = await queryXorPayOrderStatus(orderIdToCheck);
        
        if (result.success) {
          if (result.status === 'success' || result.status === 'payed') {
            // 支付成功
            clearTimers();
            setPaymentStep('polling');
            
            // 处理支付成功后的业务逻辑
            if (user) {
              await handlePaymentSuccess(orderIdToCheck, user.id, 'resume_download');
            }
            
            setPaymentStep('success');
            
            // 1.5秒后触发下载并关闭
            setTimeout(() => {
              onSuccess();
              handleClose();
            }, 1500);
          } else if (result.status === 'expire') {
            // 订单过期
            clearTimers();
            setPaymentStep('error');
            setError('订单已过期，请重新支付');
          }
          // 其他状态继续轮询
        }
      } catch (err) {
        console.error('查询支付状态失败:', err);
      }
    };

    // 立即执行一次
    poll();
    
    // 每 3 秒轮询一次
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
    
    await handlePaymentSuccess(orderId, user.id, 'resume_download');
    
    setPaymentStep('success');
    
    setTimeout(() => {
      onSuccess();
      handleClose();
    }, 1500);
  };

  // 格式化倒计时
  const formatCountdown = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={paymentStep === 'select' || paymentStep === 'error' ? handleClose : undefined}
      />
      
      {/* 模态框 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[400px] mx-4 overflow-hidden">
        {/* 头部 */}
        <div className="px-6 pt-6 pb-4 border-b border-zinc-100">
          <button
            onClick={handleClose}
            disabled={paymentStep === 'polling'}
            className="absolute top-4 right-4 p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Download size={20} className="text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">下载简历</h2>
              <p className="text-zinc-500 text-sm">导出优化后的简历 PDF</p>
            </div>
          </div>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-5">
          {paymentStep === 'success' ? (
            // 支付成功
            <div className="py-6 text-center">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check size={28} className="text-green-600" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 mb-1">支付成功</h3>
              <p className="text-zinc-500 text-sm">正在为您下载简历...</p>
            </div>
          ) : paymentStep === 'polling' ? (
            // 验证支付中
            <div className="py-6 text-center">
              <Loader2 size={40} className="animate-spin text-blue-500 mx-auto mb-3" />
              <h3 className="text-lg font-semibold text-zinc-900 mb-1">正在确认支付</h3>
              <p className="text-zinc-500 text-sm">请稍候...</p>
            </div>
          ) : paymentStep === 'qrcode' ? (
            // 显示二维码
            <div className="text-center">
              {/* 二维码 */}
              <div className="bg-white border-2 border-zinc-200 rounded-xl p-4 inline-block mb-4">
                <img 
                  src={qrCodeUrl} 
                  alt="支付二维码" 
                  className="w-[180px] h-[180px]"
                />
              </div>
              
              {/* 提示文字 */}
              <div className="flex items-center justify-center gap-2 text-zinc-600 mb-3">
                <Smartphone size={16} />
                <span className="text-sm">请使用微信扫码支付</span>
              </div>
              
              {/* 金额和倒计时 */}
              <div className="flex items-center justify-center gap-4 text-sm">
                <span className="text-zinc-500">支付金额</span>
                <span className="text-xl font-bold text-zinc-900">{formatXorPayPrice(product.priceInCents)}</span>
              </div>
              <div className="text-xs text-zinc-400 mt-2">
                二维码有效期 {formatCountdown(countdown)}
              </div>

              {/* 刷新按钮 */}
              <button
                onClick={handleRefreshQRCode}
                className="mt-4 text-sm text-zinc-500 hover:text-zinc-700 flex items-center gap-1 mx-auto"
              >
                <RefreshCw size={14} />
                刷新二维码
              </button>

              {/* 开发模式：模拟支付成功按钮 */}
              {!isXorPayConfigured() && (
                <button
                  onClick={handleSimulateSuccess}
                  className="mt-3 text-xs text-blue-500 hover:text-blue-600 underline"
                >
                  [开发模式] 模拟支付成功
                </button>
              )}
            </div>
          ) : paymentStep === 'error' ? (
            // 错误状态
            <div className="py-4 text-center">
              <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <X size={28} className="text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-zinc-900 mb-1">支付失败</h3>
              <p className="text-zinc-500 text-sm mb-4">{error || '请重试'}</p>
              <button
                onClick={handleRefreshQRCode}
                className="px-6 py-2.5 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-800 transition-all"
              >
                重新支付
              </button>
            </div>
          ) : (
            // 选择支付方式（默认状态）
            <>
              {/* 单次购买选项 */}
              <div className="bg-zinc-50 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText size={20} className="text-zinc-600" />
                    <div>
                      <div className="font-medium text-zinc-900">单次下载</div>
                      <div className="text-xs text-zinc-500">本次简历 PDF</div>
                    </div>
                  </div>
                  <div className="text-xl font-bold text-zinc-900">
                    {formatXorPayPrice(product.priceInCents)}
                  </div>
                </div>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-red-600 text-sm">
                  {error}
                </div>
              )}

              {/* 单次支付按钮 */}
              <button
                onClick={handleStartPayment}
                disabled={loading}
                className="w-full py-3 bg-zinc-900 text-white rounded-xl font-medium hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    生成支付码...
                  </>
                ) : (
                  <>
                    <QrCode size={18} />
                    微信扫码支付 {formatXorPayPrice(product.priceInCents)}
                  </>
                )}
              </button>

              {/* 分割线 */}
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-zinc-200" />
                <span className="text-xs text-zinc-400">或</span>
                <div className="flex-1 h-px bg-zinc-200" />
              </div>

              {/* VIP 推荐 */}
              <div className="bg-zinc-100 rounded-xl p-4 border border-zinc-200">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Crown size={16} className="text-zinc-700" />
                    <span className="font-medium text-zinc-900">升级 VIP 更划算</span>
                  </div>
                  <span className="text-zinc-900 font-bold">¥19.9/月</span>
                </div>
                <p className="text-xs text-zinc-500 mb-3">
                  无限下载 + 无限诊断 + 无限模拟面试
                </p>
                <button
                  onClick={() => {
                    handleClose();
                    onUpgradeVIP?.();
                  }}
                  className="w-full py-2.5 bg-zinc-900 text-white rounded-lg text-sm font-medium hover:bg-zinc-800 transition-all flex items-center justify-center gap-1.5"
                >
                  <Crown size={14} />
                  升级 VIP 会员
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DownloadPayModal;
