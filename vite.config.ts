import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    // 注意：不要在此处注入 API Key 到客户端！
    // 所有 AI API 调用都通过 /api/gemini/proxy 服务端代理
    const env = loadEnv(mode, process.cwd(), '');
    /** 本地 npm run dev 时 Vite 没有 /api；设为线上根地址可把 /api/* 转发到已部署的 Vercel（仅开发） */
    const devApiProxy = (env.VITE_DEV_API_PROXY || '').trim().replace(/\/$/, '');

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        ...(devApiProxy
          ? {
              proxy: {
                '/api': {
                  target: devApiProxy,
                  changeOrigin: true,
                  secure: true,
                },
              },
            }
          : {}),
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
