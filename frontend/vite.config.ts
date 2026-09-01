import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the Vite dev server proxies API, asset and websocket traffic
// to the FastAPI backend on port 8001. In production the FastAPI server serves
// the built files directly, so the app always talks to same-origin URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8001', changeOrigin: true },
      '/c': { target: 'http://localhost:8001', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8001', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
