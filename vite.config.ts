/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Web Serial needs a secure context: http://localhost is fine, a LAN IP is not.
  server: { host: 'localhost', port: 5173 },
  test: {
    include: ['src/**/*.test.ts', 'bridge/**/*.test.js'],
    environment: 'node',
  },
});
