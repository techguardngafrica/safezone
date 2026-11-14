import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Unit and in-process tests. Database tests live in test/integration (vitest.integration.config.ts).
// SWC is needed so NestJS decorator metadata works under Vitest.
export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['test/integration/**', '**/node_modules/**'],
    environment: 'node',
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
