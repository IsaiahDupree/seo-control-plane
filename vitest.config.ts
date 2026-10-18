import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'lib/**/*.test.ts',
      'app/**/*.test.ts',
      'packages/seo-adapter/src/**/*.test.ts',
    ],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'lib/**/*.ts',
        'app/api/**/*.ts',
        'app/logout/**/*.ts',
        'packages/seo-adapter/src/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/node_modules/**',
        '.next/**',
        'next-env.d.ts',
        'lib/testing/**',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
