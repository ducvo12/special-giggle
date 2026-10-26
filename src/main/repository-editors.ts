import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { RepositoryEditorChoices } from '../shared/repository-editor.ts'

const execute = promisify(execFile)
const definitions = [
  { id: 'vscode', name: 'Visual Studio Code', app: 'Visual Studio Code', command: 'code', windows: 'Microsoft VS Code/Code.exe', args: ['--new-window'] },
  { id: 'cursor', name: 'Cursor', app: 'Cursor', command: 'cursor', windows: 'cursor/Cursor.exe', args: ['--new-window'] },
  { id: 'windsurf', name: 'Windsurf', app: 'Windsurf', command: 'windsurf', windows: 'Windsurf/Windsurf.exe', args: ['--new-window'] },
  { id: 'vscodium', name: 'VSCodium', app: 'VSCodium', command: 'codium', windows: 'VSCodium/VSCodium.exe', args: ['--new-window'] },
  { id: 'zed', name: 'Zed', app: 'Zed', command: 'zed', windows: 'Zed/zed.exe', args: ['--new'] },
  { id: 'sublime', name: 'Sublime Text', app: 'Sublime Text', command: 'subl', windows: 'Sublime Text/sublime_text.exe', args: ['--new-window'] },
  { id: 'idea', name: 'IntelliJ IDEA', app: 'IntelliJ IDEA', command: 'idea', args: [] },
  { id: 'webstorm', name: 'WebStorm', app: 'WebStorm', command: 'webstorm', args: [] },
  { id: 'pycharm', name: 'PyCharm', app: 'PyCharm', command: 'pycharm', args: [] }
]

interface EditorTarget { id: string; name: string; path: string; args: string[] }
interface Preference { id: string; application?: string }
interface EditorEnvironment {
  platform: NodeJS.Platform
  applicationDirectories: string[]
  variables: NodeJS.ProcessEnv
  launch: (executable: string, args: string[]) => Promise<void>
}

async function launch(executable: string, args: string[]) {
  // Editor launchers must not inherit Granite's Electron/Node launch settings
  // or a terminal's remote VS Code connection.
  const env = { ...process.env }
  for (const key of ['ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'NODE_REPL_EXTERNAL_MODULE', 'VSCODE_IPC_HOOK_CLI']) delete env[key]
  if (executable === '/usr/bin/open') await execute(executable, args, { env, timeout: 15_000, maxBuffer: 32_000, windowsHide: true })
  else await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { env, detached: true, stdio: 'ignore', windowsHide: true })
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

export class RepositoryEditors {
  private directory: string
  private file: string
  private environment: EditorEnvironment

  constructor(directory: string, environment: Partial<EditorEnvironment> = {}) {
    this.directory = directory
    this.file = join(directory, 'repository-editor.json')
    this.environment = { platform: process.platform, applicationDirectories: ['/Applications', join(homedir(), 'Applications')], variables: process.env, launch, ...environment }
  }

  private async available(path: string) {
    if (!isAbsolute(path) || path.includes('\0')) return false
    try {
      const info = await stat(path)
      if (this.environment.platform === 'darwin') return path.endsWith('.app') && info.isDirectory() && (await stat(join(path, 'Contents', 'Info.plist'))).isFile()
      if (!info.isFile()) return false
      if (this.environment.platform === 'win32') return path.toLowerCase().endsWith('.exe')
      await access(path, constants.X_OK)
      return true
    } catch { return false }
  }

  private async preference(): Promise<Preference | null> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8'))
      return value && typeof value.id === 'string' && (value.application === undefined || typeof value.application === 'string') ? value : null
    } catch { return null }
  }

  private async targets(): Promise<{ targets: EditorTarget[]; selectedId: string | null }> {
    const { platform, applicationDirectories, variables } = this.environment
    const preference = await this.preference()
    const targets: EditorTarget[] = []
    for (const definition of definitions) {
      const candidates = platform === 'darwin'
        ? applicationDirectories.map(root => join(root, definition.app + '.app'))
        : platform === 'win32'
          ? definition.windows ? [variables.LOCALAPPDATA && join(variables.LOCALAPPDATA, 'Programs', definition.windows), variables.ProgramFiles && join(variables.ProgramFiles, definition.windows)].filter((path): path is string => Boolean(path)) : []
          : (variables.PATH ?? '').split(delimiter).filter(isAbsolute).map(root => join(root, definition.command))
      for (const path of candidates) {
        if (await this.available(path)) { targets.push({ id: definition.id, name: definition.name, path, args: definition.args }); break }
      }
    }
    if (preference?.id === 'custom' && preference.application && await this.available(preference.application)) targets.push(this.custom(preference.application))
    return { targets, selectedId: targets.find(target => target.id === preference?.id)?.id ?? targets[0]?.id ?? null }
  }

  async choices(): Promise<RepositoryEditorChoices> {
    const { targets, selectedId } = await this.targets()
    return { editors: targets.map(({ id, name }) => ({ id, name })), selectedId }
  }

  private custom(path: string): EditorTarget {
    const name = basename(path).replace(/\.(app|exe)$/i, '')
    const known = definitions.find(definition => [definition.app, definition.command, definition.windows?.split('/').at(-1)?.replace(/\.exe$/i, '')].some(value => value?.toLowerCase() === name.toLowerCase()))
    return { id: 'custom', name, path, args: known?.args ?? [] }
  }

  private async openTarget(folder: string, target: EditorTarget) {
    if (!isAbsolute(folder) || !(await stat(folder)).isDirectory()) throw new Error('The repository folder cannot be found.')
    if (!await this.available(target.path)) throw new Error('This editor is no longer available. Choose another application.')
    try {
      if (this.environment.platform === 'darwin') {
        // A new application instance forwards new-window arguments even when
        // an editor already has another workspace open.
        const args = target.args.length ? ['-n', '-a', target.path, '--args', ...target.args, folder] : ['-n', '-a', target.path, folder]
        await this.environment.launch('/usr/bin/open', args)
      } else await this.environment.launch(target.path, [...target.args, folder])
    } catch { throw new Error(`Could not open ${target.name}. Try another application from Open with…`) }
    await mkdir(this.directory, { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify({ id: target.id, ...(target.id === 'custom' ? { application: target.path } : {}) }), { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.file)
    } finally { await rm(temporary, { force: true }) }
    return this.choices()
  }

  async open(folder: string, editorId?: string) {
    const { targets, selectedId } = await this.targets()
    const target = targets.find(target => target.id === (editorId ?? selectedId))
    if (!target) throw new Error('No selected editor is available. Choose an application from Open with…')
    return this.openTarget(folder, target)
  }

  // Application paths come only from the native picker, never from a model or
  // a renderer-supplied command string.
  async openApplication(folder: string, application: string) {
    const { targets } = await this.targets()
    return this.openTarget(folder, targets.find(target => target.path === application) ?? this.custom(application))
  }
}
