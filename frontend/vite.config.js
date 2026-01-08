import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
<<<<<<< Updated upstream
        target:  'https://backend-psi-six-61.vercel.app' || 'http://localhost:3000',
=======
        target: 'https://backend-psi-six-61.vercel.app',
>>>>>>> Stashed changes
        changeOrigin: true
      }
    }
  }
});


