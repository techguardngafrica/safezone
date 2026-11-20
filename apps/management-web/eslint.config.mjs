import base from '@safezone/config/eslint';

// The e2e harness builds into .next-e2e and writes logs, traces and reports under e2e/.run.
export default [{ ignores: ['.next-e2e/**', 'e2e/.run/**'] }, ...base];
