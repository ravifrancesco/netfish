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
    // TV browsers lag behind: Samsung TVs from 2022 run Chromium 85, so code and CSS are
    // written down to that (e.g. "inset" becomes top/right/bottom/left).
    target: ['chrome85', 'safari15', 'firefox100', 'edge88'],
    cssTarget: ['chrome85', 'safari15', 'firefox100', 'edge88'],
    chunkSizeWarningLimit: 900,
  },
});
