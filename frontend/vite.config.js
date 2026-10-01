import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The browser only ever talks to the Vite origin; /api is forwarded to Express (no CORS needed).
    proxy: { '/api': `http://localhost:${process.env.PORT || 8787}` },
  },
  test: { environment: 'node' },
});
