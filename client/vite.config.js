import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy /api -> Express so the client can call same-origin in dev without CORS
// fuss. The lib/api.js helper prefixes calls with /api.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
