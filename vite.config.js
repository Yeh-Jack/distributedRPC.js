import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    // Vitest configuration
    environment: 'node',
    globals: true,
    setupFiles: ['./test/setup.js'],
    coverage: {
      provider: 'c8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*'],
      exclude: ['test/', 'src/main.js']
    }
  },
});