import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is needed so NestJS decorator metadata works under Vitest.
export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
  },
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
