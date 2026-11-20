import { configDefaults, defineConfig } from 'vitest/config';

// Unit tests only; Playwright owns e2e/ (pnpm e2e).
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, 'e2e/**', '.next-e2e/**'] },
});
