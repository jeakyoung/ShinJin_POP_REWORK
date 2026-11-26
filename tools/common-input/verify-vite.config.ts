import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({plugins:[react()],build:{outDir:'verify-dist',rollupOptions:{input:{main:'index.html',modes:'numeric-modes.html'}}}})
