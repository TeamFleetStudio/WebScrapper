import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'https://gab-on-scraper-backend-latest.onrender.com/api/scrape',
        changeOrigin: true
      }
    }
  }

});
