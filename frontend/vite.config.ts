import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the API runs on :3000; Vite proxies API and image calls to it
// (same-origin from the browser's point of view, so cookies + CSRF header work).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    hmr: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
      '/img': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  build: { outDir: 'dist', sourcemap: false, target: 'es2020' },
});
