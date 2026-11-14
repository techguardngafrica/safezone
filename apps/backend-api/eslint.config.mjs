import base from '@safezone/config/eslint';

export default [
  // Prisma client output (prisma generate); gitignored.
  { ignores: ['src/generated/**'] },
  ...base,
  {
    // NestJS dependency injection needs runtime class references in constructor parameters.
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
];
