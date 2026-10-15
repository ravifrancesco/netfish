import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The downloads page's player (src/offline-player.tsx), built into the apps as one file,
// apps/common/player.js: code, styles and font together, nothing to fetch.
// npm run build:player; scripts/release.sh checks the committed copy is current.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  publicDir: false,
  build: {
    outDir: '../apps/common',
    emptyOutDir: false,
    target: ['chrome85', 'safari15', 'firefox100', 'edge88'],
    cssTarget: ['chrome85', 'safari15', 'firefox100', 'edge88'],
    assetsInlineLimit: 100_000_000,
    reportCompressedSize: false,
    lib: { entry: 'src/offline-player.tsx', formats: ['iife'], name: 'NetfishPlayerBundle', fileName: () => 'player.js' },
  },
});
