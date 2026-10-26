import { spawn } from 'node:child_process'
import { realpath } from 'node:fs/promises'
import { z } from 'zod'
import type { AgentFilesystem } from '../../workspace/filesystem.ts'
import type { ToolDefinition } from '../types.ts'

export function terminalTool(workspace: AgentFilesystem, signal: AbortSignal): ToolDefinition {
  const schema = z.object({
    command: z.string().min(1).max(16_000),
    cwd: z.string().max(1024).default('/')
  })

  return {
    name: 'terminal',
    description:
      'Run a shell command in the agent workspace after user approval. Files outside this workspace and network access are unavailable. Each command has a 30-second limit.',
    parameters: z.toJSONSchema(schema, { target: 'draft-7' }),
    permission: 'terminal',
    async run(raw) {
      const args = schema.parse(raw)

      if (process.platform !== 'darwin') {
        throw new Error(
          'Granite’s terminal sandbox currently requires macOS. File and MCP tools remain available.'
        )
      }

      await workspace.check(args.cwd)
      const root = await realpath(workspace.root)
      const cwd = await realpath(`${root}/${args.cwd.replace(/^\/+/, '')}`)
      const quoted = JSON.stringify(root)
      const policy = `(version 1)
(deny default)
(allow process* sysctl-read mach-lookup)
(allow file-map-executable)
(allow file-read* (literal "/"))
(allow signal (target self))
(allow file-read-metadata)
(allow file-read* (subpath ${quoted}) (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/Library") (subpath "/opt") (subpath "/dev") (subpath "/private/var/db/dyld"))
(allow file-write* (subpath ${quoted}) (literal "/dev/null"))
${['identity.md', 'agent.json', 'harness.json', 'skills', 'tools', 'sections', 'projects'].map(name => `(deny file-write* (subpath ${JSON.stringify(`${root}/${name}`)}))`).join('\n')}
${workspace.excludeOrganization ? `(deny file-read* (subpath ${JSON.stringify(`${root}/sections`)}) (subpath ${JSON.stringify(`${root}/projects`)}))` : ''}`
      signal.throwIfAborted()

      return new Promise((resolve, reject) => {
        const child = spawn(
          '/usr/bin/sandbox-exec',
          ['-p', policy, '/bin/sh', '-c', args.command],
          {
            cwd,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
              HOME: root,
              TMPDIR: root,
              LANG: 'en_US.UTF-8'
            }
          }
        )
        let output = '',
          truncated = false,
          timedOut = false
        const stop = () => {
          if (child.pid) {
            try {
              process.kill(-child.pid, 'SIGKILL')
            } catch {}
          }
        }
        const abort = () => stop()
        const timer = setTimeout(() => {
          timedOut = true
          stop()
        }, 30_000)
        signal.addEventListener('abort', abort, { once: true })
        const append = (chunk: Buffer) => {
          if (output.length < 32_000) {
            output += chunk.toString('utf8').slice(0, 32_000 - output.length)
          } else {
            truncated = true
          }
        }
        child.stdout.on('data', append)
        child.stderr.on('data', append)
        const cleanup = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
        }
        child.on('error', () => {
          cleanup()
          reject(new Error('The terminal sandbox could not start.'))
        })
        child.on('close', (code, exitSignal) => {
          stop() // kill any descendants that outlived the shell
          cleanup()

          if (signal.aborted) {
            reject(signal.reason)
          } else {
            resolve({ output, exitCode: code, signal: exitSignal, truncated, timedOut })
          }
        })
      })
    }
  }
}
