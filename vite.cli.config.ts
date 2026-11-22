import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// The `wiremock-ui` command (src/cli): one Node module next to the built server, its npm dependencies left as imports
// (they are in the image's production node_modules). `npm run build` builds it after the app.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    ssr: 'src/cli/main.ts',
    outDir: 'dist/cli',
    emptyOutDir: true,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'wiremock-ui.mjs' } },
  },
})
