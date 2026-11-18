import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Unit and in-process tests; no Docker needed. Database and cross-tenant isolation tests need Testcontainers
// and run with `test:integration` (vitest.integration.config.ts), which CI runs on every PR and on main.
// SWC is needed so NestJS decorator metadata works under Vitest.
export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/integration/**', 'test/isolation/**', '**/node_modules/**'],
    environment: 'node',
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
