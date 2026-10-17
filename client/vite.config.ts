// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'

export default defineConfig({
  base: '/',
  plugins: [
    react(),
    {
      name: 'serve-exe-binary-headers',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/Concord-Setup.exe')) {
            res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
            res.setHeader('Content-Disposition', 'attachment; filename="Concord-Setup.exe"');
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.startsWith('/Concord-Setup.exe')) {
            res.setHeader('Content-Type', 'application/vnd.microsoft.portable-executable');
            res.setHeader('Content-Disposition', 'attachment; filename="Concord-Setup.exe"');
          }
          next();
        });
      }
    },
    process.env.ELECTRON === 'true' ? electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: {
          preload: 'electron/preload.ts',
          'streaming-preload': 'electron/streaming-preload.ts',
        },
      }
    }) : null,
  ],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (
            id.includes('emoji-picker-react') ||
            id.includes('@giphy') ||
            id.includes('plyr') ||
            id.includes('plyr-react')
          ) {
            return 'vendor-media';
          }
          if (id.includes('@supabase')) {
            return 'vendor-supabase';
          }
          if (
            id.includes('react-router-dom') ||
            id.includes('react-router') ||
            id.includes('/react/') ||
            id.includes('/react-dom/') ||
            id.includes('\\react\\') ||
            id.includes('\\react-dom\\')
          ) {
            return 'vendor-react';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
