import { z } from 'zod'
import Ajv from 'ajv'
import type { AgentFilesystem } from '../../workspace/filesystem.ts'
import type { ApprovalRequest, HarnessSettings } from '../../../shared/harness.ts'
import type { ToolActivity } from '../../../shared/agent.ts'
import type { ToolCall, ToolDefinition } from '../types.ts'
import { fileTools } from './workspace.ts'
import { terminalTool } from './terminal.ts'
import { listSkills } from '../settings.ts'
import { repositoryTools, type RepositoryTools } from './repository.ts'
import { StaleRepositoryEdit } from '../../repositories/session.ts'
import { connectMcp } from './mcp.ts'

export async function createToolRegistry(options: {
  workspace: AgentFilesystem
  settings: HarnessSettings
  signal: AbortSignal
  approve: (kind: ApprovalRequest['kind'], title: string, detail: string) => Promise<boolean>
  onTool: (tool: ToolActivity) => void
  getSettings?: () => Promise<HarnessSettings>
  hasSteering?: () => boolean
  repository?: RepositoryTools
}) {
  const { workspace, settings, signal, approve } = options
  const skills = settings.skills ? await listSkills(workspace) : []
  const definitions = fileTools(workspace)

  if (options.repository) definitions.push(...repositoryTools(options.repository).filter(tool => tool.name !== 'repo_command' || settings.terminal))

  if (settings.terminal && !options.repository?.owner) {
    definitions.push(terminalTool(workspace, signal))
  }

  if (skills.length) {
    const schema = z.object({ name: z.string().max(64) })
    definitions.push({
      name: 'load_skill',
      description: 'Load the instructions of a skill listed in the available skills catalog.',
      parameters: z.toJSONSchema(schema, { target: 'draft-7' }),
      permission: 'read',
      run: async raw => {
        const { name } = schema.parse(raw)
        const skill = skills.find(skill => skill.name === name)

        if (!skill) {
          throw new Error('Skill not found.')
        }

        return { name, instructions: skill.content }
      }
    })
  }

  const mcp = await connectMcp(settings.mcpServers, workspace.root, signal, (title, detail) =>
    approve('mcp', title, detail)
  )
  definitions.push(...mcp.tools)
  const registry = new Map(definitions.map(tool => [tool.name, tool]))
  const validator = new Ajv({ strict: false, validateFormats: false, addUsedSchema: false, useDefaults: true })
  const schemas = new Map(definitions.map(tool => [tool.name, validator.compile<Record<string, any>>(tool.parameters)]))

  const permitted = (tool: ToolDefinition, current: HarnessSettings) => {
    if ((tool.permission === 'terminal' || tool.name === 'repo_command') && !current.terminal) return false
    if (tool.name === 'load_skill' && !current.skills) return false
    if (tool.permission === 'mcp') {
      const before = settings.mcpServers.find(server => server.id === tool.serverId)
      const after = current.mcpServers.find(server => server.id === tool.serverId)
      return Boolean(after?.enabled && JSON.stringify(before) === JSON.stringify(after))
    }
    return true
  }

  return {
    definitions,
    catalog: skills.map(skill => ({
      name: skill.name,
      description:
        skill.content
          .split('\n')
          .find(line => line.trim() && line !== '---')
          ?.slice(0, 180) ?? ''
    })),
    close: mcp.close,
    async execute(call: ToolCall) {
      signal.throwIfAborted()
      const activity: ToolActivity = {
        id: call.id,
        name: call.name,
        label: registry.get(call.name)?.label,
        input: call.arguments.slice(0, 4000),
        status: 'running'
      }
      options.onTool(activity)
      let result: unknown
      let success = true
      let validationError = false
      let stalePath: string | undefined

      try {
        if (call.namespace && call.namespace !== 'granite') {
          validationError = true
          throw new Error('Unknown tool namespace.')
        }

        const tool = registry.get(call.name)

        if (!tool) {
          validationError = true
          throw new Error('Unknown or disabled tool.')
        }

        if (call.arguments.length > 100_000) {
          validationError = true
          throw new Error('Tool arguments are too large.')
        }

        let args: any
        try { args = JSON.parse(call.arguments) }
        catch { validationError = true; throw new SyntaxError('Invalid JSON') }

        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          validationError = true
          throw new Error('Tool arguments must be an object.')
        }
        if (!schemas.get(call.name)!(args)) {
          validationError = true
          throw new Error('Invalid tool arguments. This action did not run.')
        }
        const current = await options.getSettings?.() ?? settings
        if (!permitted(tool, current)) throw new Error('This tool is no longer permitted. This action did not run.')
        if (options.hasSteering?.()) throw new Error('Superseded by a new user message. This action did not run.')

        const preview = await tool.approval?.(args)
        if (preview && !(await approve(preview.kind, preview.title, preview.detail))) throw new Error('Permission denied by the user. This action did not run.')

        if (!tool.approval && (
          tool.permission === 'terminal' ||
          tool.permission === 'mcp' ||
          (tool.permission === 'write' && current.approveWrites)
        )) {
          let title = `Run ${tool.label ?? tool.name.replaceAll('_', ' ')}?`
          let detail = JSON.stringify(args, null, 2)

          if (tool.name === 'write_file') {
            title = `Create ${args.file_path}?`
            detail = `File contents:\n${args.content}`
          } else if (tool.name === 'edit_file') {
            title = `Edit ${args.file_path}?`
            detail = `Replace${args.replace_all ? ' all occurrences of' : ''}:\n${args.old_string}\n\nWith:\n${args.new_string}`
          } else if (tool.name === 'terminal') {
            title = 'Run this terminal command?'
            detail = `Working directory: ${args.cwd ?? '/'}\n\n${args.command}`
          }

          const allowed = await approve(tool.permission as ApprovalRequest['kind'], title, detail)

          if (!allowed) {
            throw new Error(
              'Permission denied by the user. Do not repeat this action unless the user asks.'
            )
          }
        }

        signal.throwIfAborted()
        const latest = await options.getSettings?.() ?? settings
        if (!permitted(tool, latest)) throw new Error('Tool permissions changed. This action did not run.')
        if (tool.permission === 'write' && latest.approveWrites && !current.approveWrites) {
          throw new Error('Write approval is now required. Propose this action again with current permissions.')
        }
        if (options.hasSteering?.()) throw new Error('Superseded by a new user message. This action did not run.')
        result = await tool.run(args)
        success = !(
          result &&
          typeof result === 'object' &&
          (('error' in result && Boolean(result.error)) ||
            ('isError' in result && result.isError === true) ||
            ('exitCode' in result && result.exitCode !== 0))
        )
      } catch (error) {
        signal.throwIfAborted()
        success = false
        if (error instanceof StaleRepositoryEdit) {
          try { stalePath = JSON.parse(call.arguments).path } catch {}
        }
        result = {
          error:
            error instanceof z.ZodError
              ? 'Invalid tool arguments.'
              : error instanceof SyntaxError
                ? 'Tool arguments were not valid JSON.'
                : error instanceof Error
                  ? error.message
                  : 'Tool failed.'
        }
      }

      const raw = typeof result === 'string' ? result : JSON.stringify(result)
      const output =
        raw.length > 32_000
          ? raw.slice(0, 32_000) + '\n[Output truncated; read a smaller range if necessary.]'
          : raw
      options.onTool({
        ...activity,
        output: output.slice(0, 4000),
        status: success ? 'complete' : 'error'
      })

      return { output, success, validationError, stalePath }
    }
  }
}
