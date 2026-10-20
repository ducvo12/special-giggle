import { readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { build, type Plugin } from 'vite'

// Build the utility process independently. Sharing entry-point chunks can make
// Electron main evaluate the worker's parentPort handler during app startup.
export function agentWorkerBuild(): Plugin {
  function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name)

      return entry.isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
    })
  }

  return {
    name: 'granite-agent-worker',
    buildStart() {
      for (const path of [...sources(resolve('src/backend')), ...sources(resolve('src/shared'))]) {
        this.addWatchFile(path)
      }
    },
    async closeBundle() {
      await build({
        configFile: false,
        logLevel: 'warn',
        ssr: { noExternal: true },
        build: {
          ssr: true,
          target: 'node24',
          outDir: resolve('out/main'),
          emptyOutDir: false,
          rollupOptions: {
            input: resolve('src/backend/agents/worker.ts'),
            external: ['better-sqlite3'],
            output: {
              format: 'cjs',
              entryFileNames: 'agent-worker.js',
              chunkFileNames: 'worker-chunks/[name]-[hash].js'
            }
          }
        }
      })
    }
  }
}
