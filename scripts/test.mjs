import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// SQLite is rebuilt for Electron. Use its Node runtime for backend tests too,
// so packaging never leaves tests with an incompatible native module ABI.
const result = spawnSync(
  require('electron'),
  [
    '--experimental-strip-types',
    '--test',
    ...readdirSync('tests')
      .filter(name => name.endsWith('.test.ts'))
      .map(name => `tests/${name}`)
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  }
)

if (result.error) {
  console.error(result.error.message)
}

process.exit(result.status ?? 1)
