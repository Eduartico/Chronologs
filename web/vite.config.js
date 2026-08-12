import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001',
    },
    // A module is one folder holding both halves of itself — its parser and its
    // card — and that folder lives at the repo root, outside this Vite root.
    // Without this the dev server refuses to read `../modules/*/ui.jsx` and a
    // module's own interface silently never loads.
    fs: { allow: ['..'] },
  },
  build: {
    outDir: 'dist',
  },
});