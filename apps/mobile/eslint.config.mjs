import expoConfig from 'eslint-config-expo/flat.js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import { moneyRules } from '../../packages/config/eslint-money.mjs';

export default defineConfig([
  expoConfig,
  { ignores: ['dist/**', '.expo/**', 'node_modules/**', 'expo-env.d.ts'] },
  moneyRules,
  {
    // eslint-config-expo registra el plugin de TypeScript solo para estos archivos.
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      eqeqeq: ['error', 'always'],
    },
  },
  prettier,
]);
