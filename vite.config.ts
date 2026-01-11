/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    optimizeDeps: {
        exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
    },
    test: {
        globals: true,
        environment: 'jsdom',
    },
    server: {
        headers: {
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Opener-Policy": "same-origin",
        },
        proxy: {
            '/api/netease': {
                target: 'http://music.163.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/netease/, ""),
                headers: {
                    'Referer': 'http://music.163.com/',
                    'Origin': 'http://music.163.com',
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Cookie': 'os=pc; NMTID='
                }
            },
            '/api/qq': {
                target: 'https://c.y.qq.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/qq/, ""),
                headers: {
                    'Referer': 'https://y.qq.com/',
                    'Origin': 'https://y.qq.com'
                }
            },
            '/api/lrclib': {
                target: 'https://lrclib.net',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/lrclib/, "/api"),
            }
        }
    }
})
