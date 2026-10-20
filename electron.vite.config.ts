import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { agentWorkerBuild } from './scripts/agent-worker-build'

export default defineConfig({
  main: {
    ssr: { noExternal: true },
    plugins: [agentWorkerBuild()],
    build: {
      externalizeDeps: false,
      rollupOptions: {
        external: ['better-sqlite3'],
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {},
  renderer: { plugins: [react()] }
})
