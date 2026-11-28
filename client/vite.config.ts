import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './', // relative asset paths so the build works inside the Android app
  plugins: [react()],
  server: {
    host: true, // reachable from a phone on the same Wi-Fi during development
    port: 5173,
    fs: { allow: [path.resolve(here, '..')] }, // the client imports ../shared
  },
  build: {
    outDir: path.resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'es2020',
  },
});
