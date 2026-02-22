import React, { useState, useEffect, useRef } from 'react';
import { X, Crown, Check, Loader2, Sparkles, Zap, FileText, MessageSquare, QrCode, RefreshCw, Smartphone, Globe, Download } from 'lucide-react';
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

interface VIPUpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type PaymentStep = 'info' | 'qrcode' | 'polling' | 'success' | 'error';

export const VIPUpgradeModal: React.FC<VIPUpgradeModalProps> = ({ 
  isOpen, 
  onClose,
  onSuccess 
}) => {
  const { user, refreshProfile } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [paymentStep, setPaymentStep] = useState<PaymentStep>('info');
  
  // 支付相关状态
  const [orderId, setOrderId] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [expiresIn, setExpiresIn] = useState(0);
  const [countdown, setCountdown] = useState(0);
  
  // 轮询相关
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);

  const product = XORPAY_PRODUCTS['vip_monthly'];
  const originalPrice = 2990; // 原价 29.9
  const discount = Math.round((1 - product.priceInCents / originalPrice) * 100);

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
      // 获取回调地址
      const notifyUrl = import.meta.env.VITE_XORPAY_NOTIFY_URL || 
        `${window.location.origin}/api/xorpay/notify`;

      // 创建支付订单
      const result = await createXorPayOrder(user.id, 'vip_monthly', notifyUrl);

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
              await handlePaymentSuccess(orderIdToCheck, user.id, 'vip_monthly');
              await refreshProfile();
            }
            
            setPaymentStep('success');
            
            // 2秒后关闭
            setTimeout(() => {
              onSuccess?.();
              handleClose();
            }, 2000);
          } else if (result.status === 'expire') {
            // 订单过期
            clearTimers();
            setPaymentStep('error');
            setError('订单已过期，请重新支付');
          }
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
    
    await handlePaymentSuccess(orderId, user.id, 'vip_monthly');
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={paymentStep === 'info' || paymentStep === 'error' ? handleClose : undefined}
      />
      
      {/* 模态框 */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-[420px] mx-4 overflow-hidden">
        {/* 头部装饰 */}
        <div className="bg-zinc-900 px-6 py-6 text-white relative overflow-hidden">
          <button
            onClick={handleClose}
            disabled={paymentStep === 'polling'}
            className="absolute top-4 right-4 p-1.5 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-50 z-10"
          >
            <X size={18} />
          </button>
          
          {/* 装饰性图案 */}
          <div className="absolute -right-8 -top-8 w-32 h-32 bg-white/5 rounded-full" />
          <div className="absolute -right-4 top-12 w-16 h-16 bg-white/5 rounded-full" />
          
          <div className="relative">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-12 h-12 bg-white/10 rounded-xl flex items-center justify-center">
                <Crown size={26} />
              </div>
              <div>
                <h2 className="text-xl font-bold">VIP 月度会员</h2>
                <p className="text-white/70 text-sm">解锁全部功能，高效求职</p>
              </div>
            </div>
            
            {/* 价格展示 */}
            <div className="flex items-baseline gap-2 mt-4">
              <span className="text-4xl font-bold">{formatXorPayPrice(product.priceInCents)}</span>
              <span className="text-white/60">/月</span>
              <span className="text-white/40 line-through text-lg ml-2">
                {formatXorPayPrice(originalPrice)}
              </span>
              <span className="px-2 py-0.5 bg-white/20 text-white text-xs font-medium rounded-full">
                省{discount}%
              </span>
            </div>
          </div>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-5">
          {paymentStep === 'success' ? (
            // 支付成功
            <div className="py-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-zinc-900 mb-2">开通成功！</h3>
              <p className="text-zinc-500">恭喜您成为 VIP 会员，尽享全部权益</p>
            </div>
          ) : paymentStep === 'polling' ? (
            // 验证支付中
            <div className="py-8 text-center">
              <Loader2 size={48} className="animate-spin text-zinc-700 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-zinc-900 mb-2">正在确认支付...</h3>
              <p className="text-zinc-500 text-sm">请稍候，正在验证支付结果</p>
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
            // 权益展示（默认状态）
            <>
              {/* VIP 权益列表 */}
              <div className="space-y-3 mb-5">
                <h4 className="text-sm font-medium text-zinc-700 flex items-center gap-2">
                  <Sparkles size={14} className="text-zinc-600" />
                  会员专属权益
                </h4>
                
                <div className="space-y-2.5">
                  {[
                    { icon: FileText, text: '简历诊断 50次/天', desc: '智能分析，精准优化' },
                    { icon: MessageSquare, text: '模拟面试 50次/天', desc: '多轮面试，全真模拟' },
                    { icon: Download, text: 'PDF 导出无限', desc: '一键下载，随时使用' },
                    { icon: Globe, text: '英文简历翻译无限', desc: '专业翻译，助力海外求职' },
                    { icon: Crown, text: '面试记录导出', desc: '保存复盘，持续提升' },
                  ].map((item, index) => (
                    <div key={index} className="flex items-start gap-3 p-3 bg-zinc-50 rounded-lg">
                      <div className="w-8 h-8 bg-zinc-200 rounded-lg flex items-center justify-center flex-shrink-0">
                        <item.icon size={16} className="text-zinc-700" />
                      </div>
                      <div>
                        <div className="font-medium text-zinc-900 text-sm">{item.text}</div>
                        <div className="text-xs text-zinc-500">{item.desc}</div>
                      </div>
                      <Check size={16} className="text-zinc-600 ml-auto mt-1" />
                    </div>
                  ))}
                </div>
              </div>

              {/* 对比免费版 */}
              <div className="bg-zinc-100 rounded-lg p-3 mb-5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-500">免费版</span>
                  <span className="text-zinc-400">共3次体验 · PDF单次付费</span>
                </div>
              </div>

              {/* 错误提示 */}
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
                    微信扫码开通 {formatXorPayPrice(product.priceInCents)}/月
                  </>
                )}
              </button>

              {/* 支付说明 */}
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
