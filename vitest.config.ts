import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: { name: 'server', include: ['tests/server/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          include: ['tests/ui/**/*.test.{ts,tsx}'],
          environment: 'happy-dom',
          environmentOptions: { happyDOM: { url: 'http://localhost:3000/' } },
          setupFiles: ['tests/ui/setup.ts'],
        },
      },
    ],
  },
})
