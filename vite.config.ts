import { defineConfig } from 'vitest/config';

// `base: './'` keeps asset URLs relative so the build works under any
// GitHub Pages project path (https://user.github.io/<repo>/).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 900,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
