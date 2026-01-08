import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://backend-psi-six-61.vercel.app',
        changeOrigin: true
      }
    }
  }
});