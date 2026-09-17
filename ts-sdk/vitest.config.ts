import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000, // 30s default
    hookTimeout: 30000,
    include: ['tests/**/*.test.ts'],
  },
});
