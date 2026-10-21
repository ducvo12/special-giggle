import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMathDelimiters } from '../src/renderer/src/features/chat/math-delimiters.ts'

test('LaTeX inline and display delimiters normalize while existing dollar math remains intact', () => {
  assert.equal(normalizeMathDelimiters('Inline \\(x^2\\) and $y$.'), 'Inline $x^2$ and $y$.')
  assert.equal(normalizeMathDelimiters('\\[\\frac{a}{b}\\]'), '\n\n$$\n\\frac{a}{b}\n$$\n\n')
  assert.equal(normalizeMathDelimiters('$$x^2$$'), '$$x^2$$')
})

test('code examples, incomplete streamed math, and plain text remain literal', () => {
  for (const source of [
    '`\\(x\\)`', '``use `\\(x\\)` here``',
    '```latex\n\\[x\\]\n```', '~~~text\n\\(x\\)\n~~~',
    '```latex\n\\[x\\]', '\\(unfinished', 'plain text and $20'
  ]) assert.equal(normalizeMathDelimiters(source), source)
})
