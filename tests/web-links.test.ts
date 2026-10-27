import { test } from 'node:test'
import assert from 'node:assert/strict'
import { externalWebUrl } from '../src/main/web-links.ts'

test('chat links accept local preview routes and ordinary absolute web URLs', () => {
  for (const url of ['http://127.0.0.1:5173/', 'http://localhost:3000/settings?tab=profile#name', 'http://[::1]:3000/', 'https://example.com/docs?q=hello%20world']) {
    assert.equal(externalWebUrl(url), url)
  }
  assert.equal(externalWebUrl('HTTPS://Example.com'), 'https://example.com/')
})

test('untrusted links cannot launch files, application protocols or credential-bearing URLs', () => {
  for (const value of [null, {}, '', '#section', '/relative', '//example.com', 'javascript:alert(1)', 'data:text/html,test',
    'file:///Applications/Calculator.app', 'vscode://file/tmp/example', 'mailto:test@example.com',
    'https://user:password@example.com', 'http://localhost:bad/', 'https://',
    ' https://example.com', 'https://example.com\n', 'https://example.com/\0test', 'https://example.com/' + 'x'.repeat(8192)]) {
    assert.equal(externalWebUrl(value), null, String(value))
  }
})
