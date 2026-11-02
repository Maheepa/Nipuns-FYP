/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Web Serial needs a secure context: http://localhost is fine, a LAN IP is not.
  server: { host: 'localhost', port: 5173 },
  build: {
    rollupOptions: {
      output: {
        // Split the big libraries into their own cached chunks (keeps each under 500 kB).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\/]/.test(id)) return 'react';
          if (/[\/](leaflet|react-leaflet|@react-leaflet)[\/]/.test(id)) return 'map';
          if (/[\/](recharts|d3-[^\/]+|victory-vendor)[\/]/.test(id)) return 'charts';
          return 'vendor';
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'bridge/**/*.test.js'],
    environment: 'node',
  },
});
