import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // The Rust game server (docker compose up, or cargo run) listens on 8080.
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // The game and the separate admin page (/admin, served as admin.html).
      input: { index: 'index.html', admin: 'admin.html' },
    },
  },
});
