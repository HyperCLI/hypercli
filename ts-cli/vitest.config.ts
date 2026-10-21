import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    minWorkers: 4,
    maxWorkers: 4,
  },
});
