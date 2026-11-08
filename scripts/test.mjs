import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
const supported = /^--(?:test-name-pattern|test-skip-pattern|test-reporter|test-concurrency|test-timeout)=.+$/

if (args.some(argument => !supported.test(argument))) {
  console.error('Use --test-name-pattern=..., --test-skip-pattern=..., --test-reporter=..., --test-concurrency=..., or --test-timeout=...')
  process.exit(1)
}

const files = readdirSync('tests', { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && /\.test\.(?:ts|mjs)$/.test(entry.name))
  .map(entry => join(entry.parentPath, entry.name))
  .sort()

if (!files.length) {
  console.error('No test files found under tests/.')
  process.exit(1)
}

// SQLite is rebuilt for Electron. Use its Node runtime for backend tests too,
// so packaging never leaves tests with an incompatible native module ABI.
const result = spawnSync(
  require('electron'),
  [
    '--experimental-strip-types',
    '--test',
    ...args,
    ...files
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
