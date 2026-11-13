// Root config only lints files at the repo root. Each app and package has its own eslint.config.mjs.
import baseConfig from './packages/config/eslint/base.mjs';

export default [
  { ignores: ['apps/**', 'packages/**', 'infrastructure/**', 'docs/**'] },
  ...baseConfig,
];
