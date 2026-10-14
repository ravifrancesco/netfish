import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the UI runs on Vite and talks to the Netfish server on :7777.
// In production the Netfish server serves this build itself.
const server = process.env.NETFISH_DEV_SERVER ?? 'http://127.0.0.1:7777';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': server,
      '/jellyfin': server,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
