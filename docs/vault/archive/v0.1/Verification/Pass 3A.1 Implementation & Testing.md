# Pass 3A.1 Implementation & Testing

> Dated verification record. Counts, environments and limitations below describe their recorded checkpoints. For current behavior use [the harness guide](../../harness.md); for delivery status use [[Start Here]]. Temporary evidence paths may no longer exist.

> Implemented and verified October 26, 2026. This is the first of the two passes selected by the user in D-069. The interactive command/filesystem foundation works, including real supplied-command Vite and Next.js installs and production builds. **Full autonomous project setup remains incomplete:** question/answer UI, bounded workflow/retry grants, managed preview lifetimes and real-model acceptance belong to 3A.2.

**Subsequent extension:** October 27 implements the second pass in [[Pass 3A.2 Implementation & Testing]]. Statements below about second-pass work being pending and all sessions closing at run end record the first-pass checkpoint; ready managed previews now have their own lifetime.

Related: [[Repository Project Setup Plan]] · [[Harness Implementation Plan]] · [[Pass 3 Implementation & Testing]] · [[Tools & Permissions#Action authorization]] · [[Run Lifecycle Design#Stop and unexpected closure]]

## Implemented behavior

| Area | Delivered |
| --- | --- |
| Model tools | Existing `repo_command` remains blocking/noninteractive. New `repo_command_start`, `repo_command_read`, `repo_command_input`, `repo_command_stop` support asynchronous interactive commands, terminal resize, incremental output and explicit status. |
| Ownership | Opaque session IDs belong to one run/agent/chat/project. Only eligible permanent repository chats with terminal enabled receive the tools. Subsequent calls recheck permission. Input requires the current revision so duplicate/stale answers are rejected. |
| Terminal | Microsoft’s MIT-licensed `node-pty` 1.1.0 supplies a real PTY. Granite retains its own supervisor and model loop. Native helpers are prepared on installation/dev/build/test and unpacked in the desktop application. |
| Setup state | Commands in one run share a canonical isolated HOME/TMPDIR and npm/XDG cache, never the user's home or credentials. Every command copies the latest live repository; published dependencies survive into its next command. A persistent shell preserves its own cwd and exports; a new command uses its specified cwd and fresh minimal process environment. |
| Installer outputs | Contained relative executable/package-manager links can be created, replaced and removed. Their targets are recorded, never followed for copying external contents. Targets and every parent/hop are checked; absolute, escaping, protected/Git, cyclic and special-file targets are rejected. Contained staged hard links become independent regular live files; hard links outside the staged tree remain rejected. |
| Checkpoints | One command at a time per run; native mutations wait until it finishes. After owned writers settle, validate the staged tree and all candidate live revisions, then import changes with checked parents, exclusive creation and streamed file copies. Batch final reconciliation rather than saving a complete installation after every file. |
| Stop/recovery | Durable supervisor and PTY ownership is recorded before user code starts. Stop, owner death and run closure settle known descendants, including separate job-control groups; discard unfinished staged work; retain already published edits. An unidentifiable process or failed reconciliation remains an attention/recovery outcome. No automatic rollback/replay. |
| Interface | Repository change details show recent command status, bounded sanitized output and staged/applied/discarded/partial publication. Real source/configuration diffs precede summarized generated/dependency outputs. Large change lists page rather than mounting an entire dependency tree. |

The command has no elapsed-time or repository-size/count kill limit. The output ring retains 512,000 characters, tools read up to 16,000 at a time, the initial result preview is 32,000, and the interface tail is 8,000. These are memory/context limits; they do not stop commands. ANSI/OSC sequences are stripped across chunk boundaries. Input frames are bounded to 16,000 characters. Poll waits are at most ten seconds per read, not command deadlines.

## Isolation and lifecycle details

Commands still run under macOS `sandbox-exec`, in a temporary repository copy. They cannot write to the live repository, read the user's home/model secrets, change controlled Git metadata without its separate grant, or bypass project membership. The minimal environment does not inherit application credentials. Command networking remains off unless the existing authorization/approval path permits that command.

Two narrow runtime allowances make real tools work: a command can use terminal control operations on its own PTY, and signal processes within its own confined sandbox. Host process signals remain denied. Scaffold tools also check their destination's parent for writability; only the validated disposable per-command container is permitted, never the live repository's parent. No trusted control data is placed in that writable container.

The supervisor's private liveness/control channel is separate from terminal stdin. PTY and supervisor identities are durably acknowledged before sandboxed code starts. The token is checked before cleanup uses numeric process/group identities. Job-control descendants are enumerated rather than assuming every child stays in one group. Arbitrarily detached or externally uncertain effects cannot be promised transactional cleanup; they remain confined to disposable storage and unresolved outcomes remain visible for review.

Staged work is published only after process settlement, not when a session handle returns. Complete live-path preflight prevents a known concurrent edit from starting publication; per-item rechecks protect later writes. Cross-process filesystem edits are not a global transaction. If Stop/error occurs after an item is applied, its recorded outcome is partial and the applied item remains. This follows D-067.

All command sessions and isolated run caches close before the run finishes. A final model reply while a session remains active is rejected honestly and the session is settled. This pass does not keep preview servers alive after the reply. The single project reservation stays held throughout active command work under the existing scheduler.

## Verification results

- **123 automated checks passed, zero failed**, including real PTY stdin/stdout, resize/`stty`, multiple known prompt answers, stale input, persistent shell cwd/exports, shared cache, executable links used by later commands, contained hard-link import, unsafe link rejection, concurrent-edit conflict, Stop while publishing, process death, separate job-control cleanup, cross-run IDs, terminal revocation, output sanitizing/paging and model-loop completion enforcement. Full log: `/tmp/granite-3a1-tests.log`.
- Type checking and production build passed. Final `npm run package` passed with the native terminal module/helper included. The local package is unsigned because no valid Developer ID signing identity is configured; no release publication was performed. Package log: `/tmp/granite-3a1-package-final.log`.
- The desktop walkthrough passed against the packaged `app.asar` entry, including actual worker → PTY → input → publication → renderer status/output, ordinary edit/diff, project entry, queue release on Stop, and actual worker SIGKILL/recovery without replay. It uses a deterministic simulated model and an isolated profile, not a hosted-model account. Log: `/tmp/granite-3a1-packaged-desktop.log`. Screenshots/profile evidence: `/private/var/folders/p9/m26dt3sj2_s59n7tbqp8r82r0000gn/T/granite-repository-ui-25oEJK`; the expanded command-output screenshot was visually checked.
- Native helper startup was also exercised from the packaged Electron executable and produced `packaged-pty` with TTY input. The module resolves through its normal ASAR path; node-pty itself locates the unpacked helper.
- Real registry downloads and framework builds passed below. These use RepositorySession and the production confinement/import path in disposable repositories; they are not mock package-manager executions and do not modify Granite into a framework project.

### Real Vite acceptance

Run `node scripts/verify-project-setup.mjs vite` with network/local process access available. The script runs these supplied commands through a repository session:

```sh
npm create --yes vite@latest . -- --template react-ts --no-interactive
npm install --no-audit --no-fund
npm run build
```

Result: **passed scaffold, dependency installation, guarded publication and production build**. Resolved create-vite 9.3.1, Vite 8.3.5, React/React DOM 19.3.1, React TypeScript template. Published 811 changed items including six symbolic links. Log: `/tmp/granite-3a1-vite.log`.

### Real Next.js acceptance

Run `node scripts/verify-project-setup.mjs next`. Supplied commands:

```sh
npx --yes create-next-app@latest . --ts --eslint --app --src-dir --use-npm --no-tailwind --import-alias "@/*" --disable-git --webpack --yes
NEXT_TELEMETRY_DISABLED=1 npm run build
```

Result: **passed scaffold with installation, guarded publication and production build**. Resolved Next.js 16.4.3, React/React DOM 19.3.0, TypeScript/App Router/src/ESLint, no Tailwind. The supplied command included `--webpack`, but the observed build reported **Turbopack**; the result records actual behavior rather than claiming webpack was used. Published 23,501 changed items including 23 symbolic links. Log: `/tmp/granite-3a1-next.log`.

Verification host: macOS arm64, Node 26.3.0 and npm 11.16.0 on the command PATH; Electron 44.9.0 runs Granite/the SQLite-based fixture. Latest package versions are the versions observed on this date, not pinned future expectations. The commands and assertions are retained in `scripts/verify-project-setup.mjs`; it removes its disposable repositories/profiles and sessions afterward. Repeatable download tests require network authorization; offline checks alone do not establish online install success.

## Remaining second pass and current limits

- Add a dedicated question tool and answer UI, waiting/continuation association, stale answer invalidation and capacity behavior. The first pass handles terminal answers already known from the request/context; it does not implement the planned human-choice workflow.
- Replace exact-current-run network matching with bounded user-intent/setup/retry grants, preserve denial/revocation and verify clear retries without redundant prompts. Existing command authorization remains in force meanwhile.
- Add requested locally bound managed previews, readiness/address/output, ownership beyond a final answer, explicit stop, code refresh/restart, and crash reconciliation without replay.
- Run full configured real-model supplied-command and underspecified “make Next.js” journeys through those features. The current simulated-model integration and real command acceptance are recorded separately; they do not count as real-model autonomous acceptance.
- Native file tools continue rejecting symbolic-link traversal. Command-created links are supported only through the validated manifest/publication path. Arbitrary external caches, host credentials, absolute host links and other platforms remain outside this pass.

Use the accepted full scope and acceptance matrix in [[Repository Project Setup Plan]] for 3A.2. No additional broad planning pass is required. Restart/relaunch Granite after updating so the new native terminal support and rebuilt worker are loaded. No commit is created automatically by this implementation task.
