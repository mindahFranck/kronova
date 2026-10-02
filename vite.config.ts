import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          // Bibliothèques dans des fichiers séparés : mises en cache indépendamment de l'app,
          // elles ne sont pas retéléchargées à chaque déploiement.
          codeSplitting: {
            groups: [
              {
                name(moduleId: string) {
                  if (!moduleId.includes('node_modules')) return null;
                  if (/[\\/](react|react-dom|scheduler)[\\/]/.test(moduleId)) return 'react';
                  if (/[\\/](recharts|d3-[^\\/]+|victory-vendor)[\\/]/.test(moduleId)) return 'charts';
                  if (/[\\/]ogl[\\/]/.test(moduleId)) return 'webgl';
                  return 'vendor';
                },
              },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
