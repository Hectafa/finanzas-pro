import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // Las pruebas de integración comparten una base de datos: se ejecutan en serie.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
  // SWC emite los metadatos de decoradores que necesita la inyección de dependencias de NestJS.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
