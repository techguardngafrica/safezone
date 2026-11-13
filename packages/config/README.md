# @safezone/config

Shared configuration only (no runtime code).

| File                                 | Use                                                    |
| ------------------------------------ | ------------------------------------------------------ |
| `tsconfig/base.json`                 | Strict compiler options shared by everything           |
| `tsconfig/library.json`              | Packages compiled to `dist/` (CommonJS + declarations) |
| `tsconfig/react-library.json`        | React (web) packages                                   |
| `tsconfig/react-native-library.json` | React Native packages                                  |
| `tsconfig/nestjs.json`               | `apps/backend-api`                                     |
| `tsconfig/nextjs.json`               | Next.js apps                                           |
| `eslint/base.mjs`                    | ESLint flat config (TypeScript + Prettier)             |

Expo apps extend `expo/tsconfig.base` and add the strict options locally.
