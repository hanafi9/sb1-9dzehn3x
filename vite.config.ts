import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    port: 3000,        // ← change ici (ex: 3000, 4000, 8080…)
    host: '0.0.0.0',  // accès réseau local (utile si hébergé sur Pi/NAS)
  },
});
