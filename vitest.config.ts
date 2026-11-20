import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
    // node:sqlite needs the flag on Node 22.12; later versions accept and ignore it.
    execArgv: ['--experimental-sqlite'],
    projects: [
      {
        extends: true,
        test: { name: 'server', include: ['tests/server/**/*.test.ts'], environment: 'node' },
      },
      {
        // The HTTP tests again, on a runtime backed by SQLite instead of Redis.
        extends: true,
        test: {
          name: 'server-sqlite',
          include: ['tests/server/http/**/*.test.ts'],
          environment: 'node',
          env: { TEST_STORE_DRIVER: 'sqlite' },
        },
      },
      {
        // The mocks, mocks-paging, session, catalog, config, scenarios, scenario-builder, import, requests, test-request, export, binary-body, postman, quick-mocks and recordings HTTP tests again, in WireMock-only mode (STORE_DRIVER=none, spec A10).
        extends: true,
        test: {
          name: 'server-none',
          include: ['tests/server/http/{mocks,mocks-paging,session,catalog,config,scenarios,scenario-builder,import,requests,test-request,export,binary-body,postman,quick-mocks,recordings}.test.ts'],
          environment: 'node',
          env: { TEST_STORE_DRIVER: 'none' },
        },
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
