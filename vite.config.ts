import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Adds a strict Content-Security-Policy to the production build only
 *  (the dev server needs inline scripts for hot reload). */
function productionCsp(): Plugin {
  return {
    name: 'a3-production-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" />`,
      );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), productionCsp()],
  server: { port: 5173, strictPort: false },
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
