import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests against real PostgreSQL 17 (Testcontainers) with RLS on. Needs a Docker daemon.
export default defineConfig({
  test: {
    globals: false,
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    hookTimeout: 180_000,
    testTimeout: 30_000,
    // One container per file; run files one at a time to keep CI memory flat.
    fileParallelism: false,
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
