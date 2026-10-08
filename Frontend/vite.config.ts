import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5500,
    proxy: {
      '/api/v1/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/v1/users': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/v1/sets': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/v1/study': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/v1/posts': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/decks/public/search': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
