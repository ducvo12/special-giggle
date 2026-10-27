import { spawn, execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { within } from './paths.ts'
import { createRequire } from 'node:module'
import { StringDecoder } from 'node:string_decoder'
import { TerminalOutput } from './terminal-output.ts'

export interface ProcessRecord { pid: number; token: string; pty?: { pid: number; token: string } }
export interface CommandResult { output: string; exitCode: number | null; timedOut: boolean; truncated: boolean; stopped?: boolean }

// The outer supervisor owns the PTY master and parent-liveness pipe. The PTY
// leader waits for a second durable PID acknowledgement before starting code.
// Neither the terminal leader nor sandboxed commands inherit the control pipe.
const terminalLeader = `
const {spawn,execFileSync}=require('node:child_process');
const c=JSON.parse(Buffer.from(process.argv[1],'base64').toString());
process.stdin.setRawMode(true);process.stdin.resume();
process.stdout.write(c.token+'\\n');
process.stdin.once('data',()=>{
 process.stdin.setRawMode(false);process.stdin.pause();
 process.on('SIGINT',()=>{});
 const tty=execFileSync('/usr/bin/tty',[],{encoding:'utf8',stdio:['inherit','pipe','pipe']}).trim();
 if(!/^\\/dev\\/ttys[0-9]+$/.test(tty))process.exit(127);
 const policy=c.policy+'\\n(allow file-ioctl (literal '+JSON.stringify(tty)+'))';
 const child=spawn('/usr/bin/sandbox-exec',['-p',policy,c.executable,...c.args],{cwd:c.cwd,env:c.env,stdio:'inherit'});
 child.on('spawn',()=>process.stdout.write(c.token+'-started\\n'));
 child.on('error',()=>process.exit(127));
 child.on('exit',(code,signal)=>process.exit(code??(signal==='SIGINT'?130:1)));
});`

const supervisor = `
const {spawn,execFileSync}=require('node:child_process');const fs=require('node:fs');const readline=require('node:readline');
const c=JSON.parse(Buffer.from(process.argv[1],'base64').toString());
let started=false,child,ready=false,booted=false,initial='';
const send=data=>fs.writeSync(3,JSON.stringify(data)+'\\n');
const stop=()=>{
 try{
  const rows=execFileSync('/bin/ps',['-axo','pid=,ppid='],{encoding:'utf8',maxBuffer:4000000}).trim().split('\\n').map(line=>line.trim().split(/\\s+/).map(Number));
  const owned=new Set([process.pid]);let changed=true;
  while(changed){changed=false;for(const [pid,parent]of rows)if(owned.has(parent)&&!owned.has(pid)){owned.add(pid);changed=true}}
  for(const pid of [...owned].reverse())if(pid!==process.pid){try{process.kill(pid,'SIGKILL')}catch{}}
 }catch{}
 if(c.interactive&&child){try{process.kill(-child.pid,'SIGKILL')}catch{}}
 try{process.kill(-process.pid,'SIGKILL')}catch{};process.exit(1)
};
process.stdin.on('end',stop);process.stdin.on('error',stop);
readline.createInterface({input:process.stdin}).on('line',line=>{
 try{
 const m=JSON.parse(line);
 if(m.type==='start'&&!started){started=true;
  if(c.interactive){
   const pty=require(c.ptyModule);
   child=pty.spawn(process.execPath,['-e',c.leader,Buffer.from(JSON.stringify(c)).toString('base64'),c.token],{cwd:c.cwd,env:{...c.env,ELECTRON_RUN_AS_NODE:'1'},name:'xterm-256color',cols:c.columns,rows:c.rows});
   child.onData(data=>{
    if(ready){process.stdout.write(data);return}initial+=data;
    if(!booted){const end=initial.indexOf(c.token+'\\r\\n');if(end<0)return;booted=true;initial=initial.slice(end+c.token.length+2);send({type:'pty',pid:child.pid})}
    const marker=c.token+'-started\\r\\n',end=initial.indexOf(marker);
    if(end>=0){ready=true;send({type:'ready'});const rest=initial.slice(end+marker.length);initial='';if(rest)process.stdout.write(rest)}
   });
   child.onExit(e=>{send({type:'exit',exitCode:e.exitCode});stop()});
  }else{
   child=spawn('/usr/bin/sandbox-exec',['-p',c.policy,c.executable,...c.args],{cwd:c.cwd,env:c.env,stdio:['pipe',1,2]});
   child.on('error',()=>{send({type:'exit',exitCode:null});stop()});
   child.on('close',code=>{send({type:'exit',exitCode:code});stop()});send({type:'ready'});
  }
 }else if(m.type==='begin'&&c.interactive){child.write('\\r')}
 else if(m.type==='input'&&child){if(c.interactive)child.write(m.data);else child.stdin.write(m.data)}
 else if(m.type==='resize'&&c.interactive&&child)child.resize(m.columns,m.rows);
 else if(m.type==='stop')stop();
 }catch{send({type:'exit',exitCode:null});stop()}
});`

export function processGroup(record: ProcessRecord) {
  try {
    const rows = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,stat=,command='], { encoding: 'utf8', maxBuffer: 4_000_000 })
      .split('\n').map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/)).filter(Boolean)
      .map(row => ({ pid: Number(row![1]), parent: Number(row![2]), group: Number(row![3]), state: row![4], command: row![5] }))
    const owned = new Set([record.pid, ...(record.pty ? [record.pty.pid] : [])])
    for (const row of rows) if (owned.has(row.group)) owned.add(row.pid)
    let changed = true
    while (changed) {
      changed = false
      for (const row of rows) if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); changed = true }
    }
    return rows.filter(row => owned.has(row.pid) && !row.state.startsWith('Z')).map(({ pid, command }) => ({ pid, command }))
  } catch { throw new Error('Could not verify the repository command process tree.') }
}

export function settleProcess(record: ProcessRecord) {
  const members = processGroup(record)
  if (!members.length) return
  const supervisor = members.find(member => member.pid === record.pid)
  const terminal = record.pty && members.find(member => member.pid === record.pty!.pid)
  const knownSupervisor = supervisor?.command.includes(record.token)
  if (supervisor && !knownSupervisor || terminal && !terminal.command.includes(record.pty!.token) || !knownSupervisor && (!terminal || !terminal.command.includes(record.pty!.token))) throw new Error('A remaining process could not be identified safely.')
  for (const member of [...members].reverse()) if (member.pid !== record.pid) {
    try { process.kill(member.pid, 'SIGKILL') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  if (record.pty) {
    try { process.kill(-record.pty.pid, 'SIGKILL') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    }
  }
  try { process.kill(-record.pid, 'SIGKILL') } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
  }
}

export interface RepositoryProcessOptions {
  root: string; privateRoot: string; cwd: string; executable: string; args: string[]
  signal: AbortSignal; writable: boolean; gitWrite?: boolean; network?: boolean
  home?: string; interactive?: boolean; columns?: number; rows?: number
  loopbackPort?: number
  previewEnvironment?: { PORT: string; HOST: string; HOSTNAME: string }
  container?: string
  onStart: (record: ProcessRecord) => void
  onOutput?: (text: string) => void
}

function commandEnvironment(options: RepositoryProcessOptions, scratch: string) {
  const quote = (s: string) => JSON.stringify(s)
  const executionRoot = options.container ?? options.root
  const privateDeny = within(options.root, options.privateRoot) && options.root !== options.privateRoot
    ? `(deny file-read* file-write* (subpath ${quote(options.privateRoot)}))` : ''
  const policy = `(version 1)
(deny default)
(allow process-fork process-exec sysctl-read mach-lookup)
(allow file-map-executable file-read-metadata)
(allow signal (target same-sandbox))
(allow file-read* (literal "/") (subpath "/System") (subpath "/usr") (subpath "/bin") (subpath "/sbin") (subpath "/Library") (subpath "/opt") (subpath "/dev") (subpath "/private/var/db/dyld") (subpath ${quote(executionRoot)}) (subpath ${quote(scratch)}))
(allow file-write* (subpath ${quote(scratch)}) (literal "/dev/null") ${options.writable ? `(subpath ${quote(executionRoot)})` : ''})
${options.gitWrite ? '' : '(deny file-write* (regex #"(^|/)\\.[gG][iI][tT](/|$)"))'}
${privateDeny}
${options.network ? '(allow network*)' : options.loopbackPort ? `(allow network-bind (local ip "localhost:${options.loopbackPort}"))
(allow network-inbound (local ip "localhost:${options.loopbackPort}"))
(allow network-outbound (remote ip "localhost:${options.loopbackPort}"))` : ''}`
  const env = { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', HOME: scratch, TMPDIR: scratch,
    TERM: options.interactive ? 'xterm-256color' : 'dumb', npm_config_cache: join(scratch, '.npm'), XDG_CACHE_HOME: join(scratch, '.cache'), LANG: 'en_US.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }
  return { policy, env: { ...env, ...options.previewEnvironment } }
}

export async function startRepositoryProcess(options: RepositoryProcessOptions) {
  if (process.platform !== 'darwin') throw new Error('Repository commands currently require the macOS sandbox.')
  options.signal.throwIfAborted()
  if (options.loopbackPort !== undefined && (!Number.isInteger(options.loopbackPort) || options.loopbackPort < 1024 || options.loopbackPort > 65535 || options.network)) throw new Error('Invalid local preview network scope.')
  // Scaffolding tools check the destination's parent. Only the disposable,
  // metadata-free per-command container may be granted, never the live parent.
  if (options.container && (await realpath(options.container) !== options.container || dirname(options.root) !== options.container || !basename(options.container).startsWith('granite-repository-command-'))) throw new Error('Invalid isolated command container.')
  const scratch = options.home ?? await realpath(await mkdtemp(join(tmpdir(), 'granite-command-')))
  if (await realpath(scratch) !== scratch) throw new Error('Command HOME must be a canonical directory.')
  const { policy, env } = commandEnvironment(options, scratch)
  const token = `granite-${randomUUID()}`
  // Resolve the installed library outside the command sandbox; packaged native
  // helpers are explicitly unpacked. No host/module path is granted to commands.
  const ptyModule = options.interactive
    ? createRequire(typeof __filename === 'string' ? __filename : import.meta.url).resolve('node-pty') : ''
  const payload = Buffer.from(JSON.stringify({ policy, executable: options.executable, args: options.args, cwd: options.cwd, env,
    interactive: options.interactive ?? false, columns: options.columns ?? 100, rows: options.rows ?? 30,
    ptyModule, leader: terminalLeader, token })).toString('base64')
  const child = spawn(process.execPath, ['-e', supervisor, payload, token], {
    detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env: { ...env, ELECTRON_RUN_AS_NODE: '1' }
  })
  let stopped = false, exited = false, control = '', exitCode: number | null = null
  let settlementError: string | undefined
  const output = new TerminalOutput(), record: ProcessRecord = { pid: child.pid!, token }
  const send = (message: unknown) => { if (!exited && !child.stdin!.destroyed) child.stdin!.write(JSON.stringify(message) + '\n') }
  const stop = () => {
    stopped = true
    try { settleProcess(record); settlementError = undefined }
    catch { settlementError = 'Could not verify command process settlement. Review its outcome before continuing.' }
    // The ChildProcess handle can retire its own still-live supervisor. Never
    // fall back to unverified numeric process groups after identity checks fail.
    child.kill('SIGKILL')
  }
  let resolveReady!: () => void
  const ready = new Promise<void>(resolve => { resolveReady = resolve })
  const decoder = new StringDecoder('utf8')
  const append = (chunk: Buffer) => { const clean = output.append(decoder.write(chunk)); if (clean) options.onOutput?.(clean) }
  child.stdout!.on('data', append); child.stderr!.on('data', append)
  child.stdin!.on('error', () => {})
  const done = new Promise<CommandResult>((resolve, reject) => {
    child.stdio[3]!.on('data', (chunk: Buffer) => {
      control += chunk.toString()
      let end: number
      while ((end = control.indexOf('\n')) >= 0) {
        const line = control.slice(0, end); control = control.slice(end + 1)
        try {
          const message = JSON.parse(line)
          if (message.type === 'pty') {
            record.pty = { pid: message.pid, token }
            options.onStart(record) // durable PTY ownership BEFORE command starts
            send({ type: 'begin' })
          } else if (message.type === 'ready') resolveReady()
          else if (message.type === 'exit') exitCode = message.exitCode
        } catch { stop() }
      }
    })
    const cleanup = () => { exited = true; resolveReady(); options.signal.removeEventListener('abort', stop) }
    child.on('error', () => { cleanup(); reject(new Error('The repository command supervisor could not start.')) })
    child.on('close', () => {
      // Retire all descendants including the PTY's separate foreground group.
      const wasStopped = stopped; stop(); cleanup()
      if (options.signal.aborted) reject(options.signal.reason)
      else if (settlementError) reject(new Error(settlementError))
      else resolve({ ...output.preview(), exitCode, timedOut: false, ...(wasStopped ? { stopped: true } : {}) })
    })
    options.signal.addEventListener('abort', stop, { once: true })
    try {
      if (!child.pid) throw new Error('Command supervisor did not start.')
      options.onStart(record); options.signal.throwIfAborted(); send({ type: 'start' })
    } catch { stop() }
  }).finally(async () => { if (!options.home) await rm(scratch, { recursive: true, force: true }) })
  // A session may be returned before its caller polls it. Keep errors observed.
  void done.catch(() => {})
  return { done, ready, output, stop, settlementError: () => settlementError,
    write(data: string) { if (exited || stopped) throw new Error('Command session is no longer running.'); send({ type: 'input', data }) },
    resize(columns: number, rows: number) { if (exited || stopped) throw new Error('Command session is no longer running.'); send({ type: 'resize', columns, rows }) }
  }
}

export async function runRepositoryProcess(options: RepositoryProcessOptions): Promise<CommandResult> {
  return (await startRepositoryProcess(options)).done
}
