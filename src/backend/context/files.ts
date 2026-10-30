import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { lstat, mkdir, readFile, writeFile, rename, link, unlink } from 'node:fs/promises'
import { AgentFilesystem } from '../workspace/filesystem.ts'
import { revision } from './store.ts'

const locks = new Map<string, Promise<unknown>>()

export async function locked<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(action)
  locks.set(key, next)
  try { return await next }
  finally { if (locks.get(key) === next) locks.delete(key) }
}

export async function textFile(root: string, path: string): Promise<string | null> {
  const fs = new AgentFilesystem(root)
  await fs.check(path)
  try {
    const file = join(root, path)
    const info = await lstat(file)
    if (!info.isFile() || info.nlink > 1 || info.size > 1_000_000) throw new Error('Context files must be regular text files of at most 1 MB.')
    const data = await readFile(file)
    if (data.includes(0) || Buffer.from(data.toString()).compare(data) !== 0) throw new Error('Context files must contain UTF-8 text.')
    return data.toString()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function publishText(root: string, path: string, content: string, expected: string | null, signal?: AbortSignal) {
  if (Buffer.byteLength(content) > 1_000_000) throw new Error('Context file exceeds 1 MB; narrow the update.')
  const check = async () => {
    signal?.throwIfAborted()
    const current = await textFile(root, path)
    if ((current === null ? null : revision(current)) !== expected) throw new Error('Saved content changed. Read the current revision and propose a fresh update.')
  }
  await check()
  await mkdir(dirname(join(root, path)), { recursive: true, mode: 0o700 })
  await new AgentFilesystem(root).check(path)
  const temporary = join(dirname(join(root, path)), `.granite-context-${randomUUID()}`)
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
    await check()
    if (expected === null) await link(temporary, join(root, path))
    else await rename(temporary, join(root, path))
  } finally { await unlink(temporary).catch(() => {}) }
  return revision(content)
}
