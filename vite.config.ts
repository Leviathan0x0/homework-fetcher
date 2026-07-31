import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

function expressApiDevPlugin() {
  return {
    name: 'express-api-dev',
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        if (req.url && (req.url.startsWith('/api') || req.url.startsWith('/fetch-homework'))) {
          try {
            const expressApp = require('./server.js');
            return expressApp(req, res, next);
          } catch (err) {
            console.error('Express Dev Server Error:', err);
            return next(err);
          }
        }
        next();
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    expressApiDevPlugin(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    // Keep the rarely-changing framework and heavyweight widget libraries in
    // their own chunks so a normal deploy does not invalidate them, and so a
    // student who never opens a chart never downloads the charting library.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (/node_modules\/(recharts|d3-|victory-|internmap|robust-predicates|delaunator)/.test(id)) return 'charts';
          if (/node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 900,
  },
});
