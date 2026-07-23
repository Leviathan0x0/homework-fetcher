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
});
