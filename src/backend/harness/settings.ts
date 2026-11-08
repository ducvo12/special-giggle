import { readFile, writeFile, rename, mkdir, readdir, lstat, cp, realpath } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { defaultHarnessSettings, type HarnessSettings } from '../../shared/harness.ts'
import type { AgentFilesystem } from '../workspace/filesystem.ts'

const schema = z.object({
  contextWindow: z.number().int().min(4096).max(2000000).optional(),
  maxOutputTokens: z.number().int().min(256).max(128000).optional(),
  instructions: z.string().max(32_000),
  terminal: z.boolean(),
  approveWrites: z.boolean(),
  skills: z.boolean(),
  mcpServers: z
    .array(
      z.object({
        id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
        name: z.string().min(1).max(80),
        transport: z.enum(['stdio', 'http']),
        command: z.string().max(4096),
        args: z.array(z.string().max(4096)).max(40),
        url: z.string().max(2048),
        enabled: z.boolean()
      })
    )
    .max(12)
})

export function validateHarnessSettings(value: unknown): HarnessSettings {
  const parsed = schema.safeParse(value)

  if (!parsed.success) {
    throw new Error(
      'Check the instruction length, server names, commands, and argument limits before saving.'
    )
  }

  const settings = parsed.data

  if (new Set(settings.mcpServers.map(server => server.id)).size !== settings.mcpServers.length) {
    throw new Error('MCP server identifiers must be unique.')
  }

  for (const server of settings.mcpServers) {
    if (
      server.transport === 'stdio' &&
      (!server.command.trim() || /[\0\r\n]/.test(server.command))
    ) {
      throw new Error('Enter an MCP server executable.')
    }

    if (server.transport === 'http') {
      const url = new URL(server.url)

      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
        throw new Error('Use an HTTP or HTTPS MCP address without embedded credentials.')
      }

      if (url.protocol === 'http:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
        throw new Error('Remote MCP servers require HTTPS.')
      }
    }
  }

  return settings
}

export async function readHarnessSettings(workspace: AgentFilesystem) {
  await workspace.check('/harness.json')

  try {
    return validateHarnessSettings(
      JSON.parse(await readFile(join(workspace.root, 'harness.json'), 'utf8'))
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return structuredClone(defaultHarnessSettings)
    }

    throw new Error('Could not read agent tool settings. Existing settings have been kept.')
  }
}

export async function saveHarnessSettings(workspace: AgentFilesystem, value: unknown) {
  const settings = validateHarnessSettings(value)
  await workspace.check('/harness.json')
  const temporary = join(workspace.root, `harness-${randomUUID()}.tmp`)
  await writeFile(temporary, JSON.stringify(settings, null, 2), { mode: 0o600 })
  await rename(temporary, join(workspace.root, 'harness.json'))

  return settings
}

export async function listSkills(workspace: AgentFilesystem) {
  const dirs = [join(workspace.root, 'tools', 'skills'), join(workspace.root, 'skills')]
  const seen = new Set<string>()
  const skills: { name: string; content: string }[] = []

  for (const dir of dirs) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }

    for (const entry of entries.slice(0, 30)) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.name) || seen.has(entry.name)) {
        continue
      }
      seen.add(entry.name)
      const relativePath = dir.endsWith('tools/skills') ? `/tools/skills/${entry.name}/SKILL.md` : `/skills/${entry.name}/SKILL.md`
      await workspace.check(relativePath)

      const fullPath = join(workspace.root, relativePath)
      if ((await lstat(fullPath)).size > 32_000) {
        throw new Error('A skill is too large. Limit each skill to 32,000 bytes.')
      }

      skills.push({ name: entry.name, content: await readFile(fullPath, 'utf8') })
    }
  }

  return skills
}

export async function saveSkill(workspace: AgentFilesystem, name: string, content: string) {
  if (
    !/^[a-zA-Z0-9_-]{1,64}$/.test(name) ||
    typeof content !== 'string' ||
    Buffer.byteLength(content) > 32_000
  ) {
    throw new Error(
      'Use a short skill name with letters, numbers, dashes, or underscores, and up to 32,000 bytes of instructions.'
    )
  }

  await workspace.check(`/tools/skills/${name}/SKILL.md`)
  await mkdir(join(workspace.root, 'tools', 'skills', name), { recursive: true })
  const temporary = join(workspace.root, 'tools', 'skills', name, `${randomUUID()}.tmp`)
  await writeFile(temporary, content, { mode: 0o600 })
  await rename(temporary, join(workspace.root, 'tools', 'skills', name, 'SKILL.md'))
}

export async function importSkill(workspace: AgentFilesystem, sourceDir: string): Promise<{ name: string }> {
  const canonicalSource = await realpath(sourceDir)
  const skillMdPath = join(canonicalSource, 'SKILL.md')
  const skillStat = await lstat(skillMdPath).catch(() => { throw new Error('A skill package must contain a SKILL.md file.') })
  if (!skillStat.isFile() || skillStat.size > 32_000) {
    throw new Error('A skill is too large. Limit SKILL.md to 32,000 bytes.')
  }
  const name = basename(canonicalSource)
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw new Error('Use a short skill name with letters, numbers, dashes, or underscores.')
  }
  const targetDir = join(workspace.root, 'tools', 'skills', name)
  try {
    const existing = await lstat(targetDir)
    if (existing.isDirectory()) throw new Error(`A skill named "${name}" already exists. Do not overwrite existing skills.`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await mkdir(targetDir, { recursive: true, mode: 0o700 })
  await cp(canonicalSource, targetDir, { recursive: true })
  return { name }
}
