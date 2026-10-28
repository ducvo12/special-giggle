import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentLimit, messageLimit, readAttachments, messageWithAttachments, sentAttachments } from '../src/renderer/src/features/chat/attachments.ts'

test('text files are sent with the message and can be recovered from saved chat history', async () => {
  const files = await readAttachments([new File(['hello\nworld'], 'notes.md')], [])
  assert.equal(files.length, 1)
  assert.equal(files[0].content, 'hello\nworld')
  assert.ok(files[0].id)
  const message = messageWithAttachments('Summarize this', files)
  assert.ok(message.startsWith('Summarize this\n\n'))
  assert.deepEqual(sentAttachments(message), [{ name: 'notes.md', size: 11, content: 'hello\nworld' }])
  assert.equal(messageWithAttachments('hello', []), 'hello')
  assert.equal(messageWithAttachments('', files).startsWith('### Attached file:'), true)
})

test('attachment names and nested code fences round trip without ending an attachment early', async () => {
  const content = '```ts\nconst a = `hi`\n```\n````\n### Attached file: fake'
  const files = await readAttachments([new File([content], 'a"b\nc.md'), new File(['second'], 'second.txt')], [])
  assert.deepEqual(sentAttachments(messageWithAttachments('', files)), files.map(({ name, size, content }) => ({ name, size, content })))
  assert.deepEqual(sentAttachments('ordinary message'), [])
})

test('attachment limits reject binary data, invalid UTF-8, oversized batches and oversized messages', async () => {
  await assert.rejects(readAttachments([new File([new Uint8Array([0, 1])], 'image.png')], []), /text or code file/)
  await assert.rejects(readAttachments([new File([new Uint8Array([255])], 'invalid.txt')], []), /UTF-8/)
  await assert.rejects(readAttachments([new File(['a'.repeat(attachmentLimit + 1)], 'large.txt')], []), /24 KB/)
  const existing = await readAttachments([new File(['a'.repeat(attachmentLimit)], 'full.txt')], [])
  await assert.rejects(readAttachments([new File(['b'], 'extra.txt')], existing), /24 KB/)
  await assert.rejects(readAttachments(Array.from({ length: 6 }, (_, index) => new File(['a'], `${index}.txt`)), []), /5 text or code files/)
  assert.throws(() => messageWithAttachments('a'.repeat(messageLimit), existing), /too long/)
  assert.equal(existing.length, 1)
})
