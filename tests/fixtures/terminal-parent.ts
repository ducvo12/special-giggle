import { join } from 'node:path'
import { startRepositoryProcess } from '../../src/backend/repositories/process.ts'

const root = process.argv[2]
const command = await startRepositoryProcess({ root, privateRoot: join(root, 'private'), cwd: root,
  executable: '/bin/sh', args: ['-c', 'read answer'], interactive: true, writable: true,
  signal: new AbortController().signal, onStart: record => { process.stdout.write(JSON.stringify({ record }) + '\n') } })
await command.ready
process.stdout.write(JSON.stringify({ ready: true }) + '\n')
await command.done
