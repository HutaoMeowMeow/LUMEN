import { defineConfig } from 'vite';

// Deployed as a GitHub Pages project site at https://<owner>.github.io/LUMEN/.
// An absolute base keeps HTML, JS, CSS, workers and public assets under /LUMEN/.
export default defineConfig({
  base: '/LUMEN/',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
