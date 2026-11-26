import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({plugins:[react()],build:{rollupOptions:{input:{main:'index.html',machine:'machine-harness.html'}},outDir:'machine-dist'}})
