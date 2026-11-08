import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface CredentialProtection {
  available: () => boolean
  encrypt: (text: string) => Buffer
  decrypt: (data: Buffer) => string
}

export async function atomicJson(directory: string, name: string, value: unknown, signal?: AbortSignal) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `${name}-${randomUUID()}.tmp`)
  try {
    signal?.throwIfAborted()
    await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 })
    signal?.throwIfAborted()
    await rename(temporary, join(directory, name))
  } finally {
    try { await unlink(temporary) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
}

export async function readJson(directory: string, name: string) {
  try {
    return JSON.parse(await readFile(join(directory, name), 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }

    throw new Error('Could not read local account storage. The existing file has been kept.')
  }
}

export function seal(protection: CredentialProtection, value: unknown) {
  if (!protection.available()) {
    throw new Error(
      'Secure credential storage is unavailable. Unlock your system credential store before signing in.'
    )
  }

  return protection.encrypt(JSON.stringify(value)).toString('base64')
}

export function unseal(protection: CredentialProtection, value: string) {
  if (!protection.available()) {
    throw new Error(
      'Secure credential storage is unavailable. Unlock your system credential store.'
    )
  }

  try {
    return JSON.parse(protection.decrypt(Buffer.from(value, 'base64')))
  } catch {
    throw new Error('Could not unlock this account. Sign in again in Settings.')
  }
}
