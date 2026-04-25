import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3001'

// https://vite.dev/config/
export default defineConfig({
  envDir: '..',
  plugins: [tailwindcss(), react()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: ['hookai.kr', 'www.hookai.kr'],
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: true,
    port: 8080,
    allowedHosts: true,
  },
})
