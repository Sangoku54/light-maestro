/**
 * Config vitest dédiée au benchmark d'analyse audio (hors suite de tests).
 *   npx vitest run --config scripts/vitest.bench.config.ts
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['scripts/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '..', 'src'),
      '@electron': path.resolve(__dirname, '..', 'electron'),
    },
  },
});
