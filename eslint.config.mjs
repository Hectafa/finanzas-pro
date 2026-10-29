// Configuración de ESLint para la API y los paquetes compartidos. La app tiene la suya
// (apps/mobile/eslint.config.mjs) basada en eslint-config-expo.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { moneyRules } from './packages/config/eslint-money.mjs';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.turbo/**',
      'apps/api/src/generated/**',
      'apps/mobile/**',
      '**/coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  moneyRules,
  {
    // NestJS inyecta dependencias por el tipo del constructor: deben ser importaciones de valor.
    files: ['apps/api/src/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts', '**/prisma/seed.ts'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
