import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import type { User, Session } from '@supabase/supabase-js';
import { supabase, UserProfile, isSupabaseConfigured } from '../services/supabaseClient';
import { getUserProfile, onAuthStateChange, repairSubscriptionAfterPay } from '../services/authService';

export type RefreshProfileOptions = {
  /**
   * 支付成功轮询到订单已 paid 时，服务端可能尚未写完 profiles（竞态）。
   * 为 true 时多次短延迟重拉，直到读到付费档位或达到上限。
   */
  untilPaidMembership?: boolean;
};

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  loading: boolean;
  refreshProfile: (options?: RefreshProfileOptions) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  session: null,
  loading: true,
  refreshProfile: async () => {},
} as AuthContextType);

export const useAuth = () => useContext(AuthContext);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = async (options?: RefreshProfileOptions) => {
    if (!user) return;

    if (options?.untilPaidMembership) {
      await repairSubscriptionAfterPay();
    }

    // GET /api/user/membership 会按已付订单自愈 profiles（订单 paid 但 type 仍为 free 等）
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        await fetch('/api/user/membership', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
      }
    } catch {
      /* ignore */
    }

    const paidTiers = new Set(['vip', 'resume_pass', 'full_monthly', 'pro', 'special']);
    const maxAttempts = options?.untilPaidMembership ? 8 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 400));
      }
      const userProfile = await getUserProfile(user.id);
      if (userProfile) setProfile(userProfile);
      const mt = userProfile?.membership_type || 'free';
      if (!options?.untilPaidMembership || paidTiers.has(mt)) {
        return;
      }
    }
  };

  useEffect(() => {
    // 如果 Supabase 未配置，直接设置 loading 为 false
    if (!isSupabaseConfigured) {
      console.warn('Supabase 未配置，认证功能不可用');
      setLoading(false);
      return;
    }

    // 获取初始会话
    const initAuth = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          if (session.access_token) {
            try {
              await fetch('/api/user/membership', {
                headers: { Authorization: `Bearer ${session.access_token}` },
              });
            } catch {
              /* ignore */
            }
          }
          const userProfile = await getUserProfile(session.user.id);
          setProfile(userProfile);
        }
      } catch (error) {
        console.error('初始化认证失败:', error);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    // 监听认证状态变化
    const { data: { subscription } } = onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event);
      setSession(session);
      setUser(session?.user ?? null);

      if (session?.user) {
        // 获取 profile，带重试机制（新用户触发器创建可能需要时间）
        const fetchProfileWithRetry = async (userId: string, retries = 3, delay = 500) => {
          if (session.access_token) {
            try {
              await fetch('/api/user/membership', {
                headers: { Authorization: `Bearer ${session.access_token}` },
              });
            } catch {
              /* ignore */
            }
          }
          for (let i = 0; i < retries; i++) {
            const userProfile = await getUserProfile(userId);
            if (userProfile) {
              setProfile(userProfile);
              return;
            }
            // 等待后重试
            if (i < retries - 1) {
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
          console.warn('获取用户 profile 失败，已达最大重试次数');
        };
        fetchProfileWithRetry(session.user.id).catch(err => {
          console.error('获取用户 profile 异常:', err);
        });
      } else {
        setProfile(null);
      }
      
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, session, loading, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
};
