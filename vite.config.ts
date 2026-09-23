import { defineConfig } from 'vite';

/**
 * Production/dev build config (ADR-002).
 * Kept deliberately minimal: no plugins, static `dist/` output, no server runtime.
 */
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    // Budget guard (ARCH §36.4): warn when the initial bundle grows past ~4 MB
    // (uncompressed) — the 8 MB cold-download ceiling is measured on the wire.
    chunkSizeWarningLimit: 4096
  },
  server: {
    open: false
  }
});