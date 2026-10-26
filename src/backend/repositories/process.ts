import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { within } from './paths.ts'

export interface ProcessRecord { pid: number; token: string }
export interface CommandResult { output: string; exitCode: number | null; timedOut: boolean; truncated: boolean }

// The supervisor waits for a durable PID record before starting the command.
// Its stdin is a parent-liveness pipe: a worker/app crash closes it and kills the
// whole process group. No repository script or child inherits that control pipe.
const supervisor = `
const {spawn}=require('node:child_process');const fs=require('node:fs');
const config=JSON.parse(Buffer.from(process.argv[1],'base64').toString());
let started=false;let child;
const stop=()=>{try{process.kill(-process.pid,'SIGKILL')}catch{};process.exit(1)};
process.stdin.on('end',stop);process.stdin.on('error',stop);process.stdin.resume();
process.stdin.once('data',()=>{if(started)return;started=true;
 child=spawn('/usr/bin/sandbox-exec',['-p',config.policy,config.executable,...config.args],{cwd:config.cwd,env:config.env,stdio:['ignore',1,2]});
 child.on('error',()=>{fs.writeSync(3,JSON.stringify({exitCode:null,error:'Could not start sandboxed command'}));stop()});
 child.on('close',code=>{fs.writeSync(3,JSON.stringify({exitCode:code}));stop()});
});`

export function processGroup(record: ProcessRecord) {
  try {
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,stat=,command='], { encoding: 'utf8', maxBuffer: 4_000_000 })
      .split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean)
    return rows.filter(row => Number(row![2]) === record.pid && !row![3].startsWith('Z'))
      .map(row => ({ pid: Number(row![1]), command: row![4] }))
  } catch { throw new Error('Could not verify the repository command process group.') }
}

export function settleProcess(record: ProcessRecord) {
  const members = processGroup(record)
  if (!members.length) return
  const supervisor = members.find(member => member.pid === record.pid)
  if (!supervisor?.command.includes(record.token)) throw new Error('A remaining process could not be identified safely.')
  try { process.kill(-record.pid, 'SIGKILL') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

export async function runRepositoryProcess(options: {
  root: string; privateRoot: string; cwd: string; executable: string; args: string[]
  signal: AbortSignal; writable: boolean; gitWrite?: boolean; network?: boolean
  onStart: (record: ProcessRecord) => void
}) : Promise<CommandResult> {
  if (process.platform !== 'darwin') throw new Error('Repository command execution currently requires the macOS sandbox. File tools remain available.')
  options.signal.throwIfAborted()
  const scratch = await mkdtemp(join(tmpdir(), 'granite-command-'))
  const quote = (s: string) => JSON.stringify(s)
  const privateDeny = within(options.root, options.privateRoot) && options.root !== options.privateRoot
    ? `(deny file-read* file-write* (subpath ${quote(options.privateRoot)}))` : ''
  const policy = `(version 1)
(deny default)
(allow process-fork process-exec sysctl-read mach-lookup)
(allow file-map-executable file-read-metadata)
(allow signal (target self))
(allow file-read* (literal "/") (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/Library") (subpath "/opt") (subpath "/dev") (subpath "/private/var/db/dyld") (subpath ${quote(options.root)}) (subpath ${quote(scratch)}))
(allow file-write* (subpath ${quote(scratch)}) (literal "/dev/null") ${options.writable ? `(subpath ${quote(options.root)})` : ''})
${options.gitWrite ? '' : '(deny file-write* (regex #"(^|/)\\.[gG][iI][tT](/|$)"))'}
${privateDeny}
${options.network ? '(allow network*)' : ''}`
  const env = { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: scratch, TMPDIR: scratch,
    LANG: 'en_US.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
  try {
    return await new Promise<CommandResult>((resolve, reject) => {
      const token = `granite-${randomUUID()}`
      const payload = Buffer.from(JSON.stringify({ policy, executable: options.executable, args: options.args, cwd: options.cwd, env })).toString('base64')
      const child = spawn(process.execPath, ['-e', supervisor, payload, token], {
        detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' }
      })
      let output = '', control = '', truncated = false, timedOut = false
      const stop = () => { if (child.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch {} } }
      const timer = setTimeout(() => { timedOut = true; stop() }, 120_000)
      const append = (chunk: Buffer) => { truncated ||= output.length + chunk.length > 32_000; output = (output + chunk.toString()).slice(0, 32_000) }
      child.stdout!.on('data', append); child.stderr!.on('data', append)
      child.stdio[3]!.on('data', (chunk: Buffer) => { control += chunk.toString() })
      options.signal.addEventListener('abort', stop, { once: true })
      const cleanup = () => { clearTimeout(timer); options.signal.removeEventListener('abort', stop) }
      child.on('error', () => { cleanup(); reject(new Error('The repository command supervisor could not start.')) })
      child.on('close', () => {
        stop(); cleanup()
        if (options.signal.aborted) reject(options.signal.reason)
        else {
          let exitCode: number | null = null
          try { exitCode = JSON.parse(control).exitCode } catch {}
          resolve({ output, exitCode, timedOut, truncated })
        }
      })
      try {
        if (!child.pid) throw new Error('The repository command did not start.')
        options.onStart({ pid: child.pid, token })
        options.signal.throwIfAborted()
        child.stdin!.write('start\n')
      } catch (error) { stop(); cleanup(); reject(error) }
    })
  } finally { await rm(scratch, { recursive: true, force: true }) }
}
