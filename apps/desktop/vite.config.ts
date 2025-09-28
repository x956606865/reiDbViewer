import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
const enableSourceMap = process.env.BUILD_SOURCEMAP !== '0';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: enableSourceMap,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@rei-db-view/shared': path.resolve(__dirname, '../shared'),
    },
  },
});
