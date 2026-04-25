import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3141',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3141',
        ws: true,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: '../server/public',
    emptyOutDir: false   // avoid permission errors on existing files; CI can rm -rf manually
  }
})
