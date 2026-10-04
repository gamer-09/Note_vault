import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const developmentCspRemoval = {
  name: 'quiet-notes-development-csp-removal',
  apply: 'serve',
  transformIndexHtml: {
    order: 'pre',
    handler(html) {
      return html.replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[^>]*\/?\s*>/i, '');
    },
  },
};

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), developmentCspRemoval],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
