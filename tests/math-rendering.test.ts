import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const rendererRequire = createRequire(require.resolve('rehype-katex'))

test('math styles and rehype renderer resolve the same KaTeX version', () => {
  // Different releases rename layout classes, breaking boxes and other math
  // even though the equation text still parses successfully.
  assert.equal(
    require('katex/package.json').version,
    rendererRequire('katex/package.json').version
  )
})
