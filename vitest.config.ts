import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The reference consumer runs against the packed package with its own runner.
    exclude: [...configDefaults.exclude, 'fixtures/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/email/templates/**'],
    },
  },
});
