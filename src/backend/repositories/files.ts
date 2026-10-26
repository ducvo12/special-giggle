import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, rm } from 'node:fs/promises'

// Hash and copy in bounded chunks so dependency trees and generated artifacts
// need no arbitrary size ceiling and cannot exhaust memory with one large file.
export async function inspectFile(path: string, signal?: AbortSignal, includeText = true) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new Error('Expected a regular file.')
    const hash = createHash('sha256'), decoder = new TextDecoder('utf-8', { fatal: true })
    let size = 0, binary = false, chunks: Buffer[] = []
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      signal?.throwIfAborted()
      const data = chunk as Buffer
      hash.update(data); size += data.length
      binary ||= data.includes(0)
      if (!binary) { try { decoder.decode(data, { stream: true }) } catch { binary = true } }
      if (includeText && size <= 1_000_000) chunks.push(data)
      else chunks = []
    }
    if (!binary) { try { decoder.decode() } catch { binary = true } }
    const large = size > 1_000_000
    return { hash: hash.digest('hex'), binary, large, mode: info.mode & 0o777,
      ...(!includeText || binary || large ? {} : { text: Buffer.concat(chunks).toString('utf8') }) }
  } finally { await file.close() }
}

export async function copyVerifiedFile(source: string, destination: string, expected: string, mode: number, signal?: AbortSignal) {
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  let created = false
  try {
    if (!(await input.stat()).isFile()) throw new Error('Command output must be a regular file.')
    const output = await open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode)
    created = true
    try {
      const hash = createHash('sha256')
      for await (const chunk of input.createReadStream({ autoClose: false })) {
        signal?.throwIfAborted()
        hash.update(chunk)
        await output.writeFile(chunk)
      }
      signal?.throwIfAborted()
      if (hash.digest('hex') !== expected) throw new Error('Command output changed during publication; remaining changes were not applied.')
    } finally { await output.close() }
  } catch (error) {
    if (created) await rm(destination, { force: true })
    throw error
  } finally { await input.close() }
}
