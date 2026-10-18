import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  // Bundle the agent SDKs: some ship internal dist/node_modules/.pnpm chunks
  // that desktop packagers otherwise omit. Keep the native SQLite addon external.
  main: {
    ssr: { noExternal: true },
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ['better-sqlite3'],
        input: { index: resolve('src/main/index.ts'), 'agent-worker': resolve('src/backend/agent-worker.ts') }
      }
    }
  },
  preload: {},
  renderer: { plugins: [react()] }
})
