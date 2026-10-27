import { chmodSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// node-pty 1.1.0 ships the macOS prebuilt helper without its executable bit.
// Prepare it before development/testing/packaging, never mutate app resources
// at runtime. The native module uses N-API and is loaded outside the sandbox.
const root = dirname(createRequire(import.meta.url).resolve('node-pty/package.json'))
if (process.platform === 'darwin') for (const dir of ['build/Release', 'prebuilds/darwin-arm64', 'prebuilds/darwin-x64']) {
  const helper = join(root, dir, 'spawn-helper')
  if (existsSync(helper)) chmodSync(helper, 0o755)
}
