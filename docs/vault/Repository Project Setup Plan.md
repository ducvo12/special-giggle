# Repository Project Setup Plan

> Scope accepted October 26, 2026. Planned as **Pass 3A — Autonomous Project Setup**, before pass 4. The user moved this work out of future optimizations and requested documentation before implementation. The user chose two implementation passes, with the first implemented and verified in [[Pass 3A.1 Implementation & Testing]]. The second pass is implemented October 27; its behavior, real-agent verification and external-package limits are recorded in [[Pass 3A.2 Implementation & Testing]]. Implementation defaults below guide engineering; any change to the existing sharing, approval, Stop or recovery rules requires review.

Related: [[Harness Implementation Plan]] · [[Pass 3 Implementation & Testing]] · [[Tool Permissions]] · [[Run Lifecycle Design]] · [[Concurrency & Limits]] · [[Unexpected Closure Recovery]] · [[Things to Optimize]]

## Goal and expected user experience

The user can ask, “Make this repository a Next.js project,” or provide a complete scaffold command. The agent inspects the repository, asks for meaningful choices it cannot determine from the request or permitted project context, runs the setup, installs the required dependencies, verifies the result with a real build and reports what actually succeeded. It handles routine command prompts itself when the answer is already known.

The user should not need to run the command manually, transfer terminal output back into chat, answer the same choice repeatedly or approve each download in an already authorized installation. The agent may start a local preview whenever useful without a separate request or approval. It must honor explicit instructions not to preview and user Stop actions. Starting a preview does not publish or deploy the project.

Example path: inspect the current repository → resolve missing choices → establish bounded setup/download authorization → scaffold in isolation → answer installer prompts → install dependencies → publish completed changes with conflict checks → build → fix relevant failures → report the verified result and any managed server still running.

## Delivery split and status

| Pass | Scope | Status |
| --- | --- | --- |
| **3A.1 — Command foundation** | Interactive sessions and output; isolated run HOME/cache; safe installer links; guarded checkpoint publication; Stop/crash cleanup; supplied-command framework builds | Implemented; results and limits in [[Pass 3A.1 Implementation & Testing]] |
| **3A.2 — Autonomous workflow** | Question tool and answer UI; bounded setup/retry authorization; managed preview servers after the final answer; real-model complete and underspecified setup acceptance | Implemented; behavior and acceptance evidence in [[Pass 3A.2 Implementation & Testing]] |

The user requested as few passes as safely practical. Two passes keep process/filesystem correctness independently verifiable before adding resumable human choices, broader authorization and sessions that outlive a run. This is an implementation split, not deferred scope or a requirement for another broad design review (D-069).

## Baseline at plan creation versus full target

The table records the baseline before 3A.1. Consult its results above for current availability; 3A.2 now supplies questions, bounded workflow/retry grants and managed previews; see its separate results.

| Area | Baseline before 3A.1 | Full Pass 3A target |
| --- | --- | --- |
| Command execution | Noninteractive commands; no fixed elapsed-time or repository size/count ceiling | Interactive sessions with input, incremental output and explicit lifecycle controls |
| Isolation | Temporary repository copy, macOS sandbox, separate command HOME/TMPDIR and guarded publication | Preserve these boundaries throughout multi-command setup and interactive/background execution |
| npm cache | Canonical temporary-directory fix is implemented with focused verification recorded in [[Pass 3 Implementation & Testing]] | Retain the fixed path handling and preserve a workflow's isolated cache/environment across its related commands |
| Links | Existing relative links are preserved in command copies; new command-created links block publication | Safely track and publish repository-contained relative links, including executable links created by package managers |
| User choices | Ordinary conversation and action approvals | A dedicated question tool and answer interface that resume the task |
| Networking | Repository command networking is already available with explicit authorization | Recognize bounded setup workflows and clear retries without duplicate prompts; keep grants visible and scoped |
| Development servers | No managed persistent interactive/background session workflow | Visible server state, output, local address, termination and recovery |
| Web search | Hosted search is not enabled by this feature | Not a prerequisite: supplied commands and local command help are sufficient for initial tests |

Terminal enablement remains an explicit agent setting. A request cannot bypass a disabled capability. Existing repository membership, Shared/Closed boundaries and permanent-chat requirements continue to apply. Initial delivery stays on macOS; additional command platforms remain separate work.

## 1. Interactive command sessions

- Reuse a maintained terminal/PTY implementation after checking its license, Electron/native-runtime compatibility and ability to preserve Granite's supervisor and sandbox. Do not invent a terminal emulator or replace the agent loop as part of this feature.
- Expose small model tools for starting a session, reading output/status, supplying input and stopping it. Exact names are implementation choices. Session identifiers are opaque and bound to their owning agent, chat, run and repository; knowing another identifier never grants access.
- Give commands a real terminal when needed, including stdin, terminal size and control-key handling. Preserve a noninteractive path for commands with complete options. The model chooses answers from the known task and output rather than relying on fragile prompt-string matching alone.
- Return control to the agent while a command remains running so it can inspect progress or ask a question. Waiting for a process is not model generation and must not occupy a model-capacity lease. Do not reintroduce a hard command or whole-run deadline.
- Stream output to the interface and retain bounded, pageable output for tools. Output limits protect memory/context; they must not kill the command. Sanitize terminal control sequences before display. Never present terminal output as trusted instructions or authorization.
- Keep one owner and controlled sequential input per session. Prevent stale/double input, cross-chat input and writes to exited/stopped sessions. Permission changes apply at subsequent command/input actions under D-064; Stop remains the way to halt already-running work.

## 2. Questions and task continuation

- Add a model-callable question tool separate from the permission-approval mechanism. Support concise questions, suggested choices and free-text answers. Display the pending choice in chat and return the answer as user input associated with that exact question/task.
- Ask only about information that matters and cannot be inferred safely: target folder, framework/language choices, styling choices or preservation/replacement of existing files. Reuse the user's exact command and earlier answers. If the user requests defaults, apply them rather than asking every wizard question.
- Inspect a nonempty repository before running a scaffold that may replace files. A general setup request does not by itself authorize arbitrary deletion of existing work. Resolve a consequential overwrite/migration choice with the user unless their request already settles it.
- While a process waits for a genuine user choice, keep its session available and mark the task as waiting for input. Do not busy-loop model requests or consume a model slot. Retain the active setup run's project reservation so another same-project run cannot write through its checkpoint; other projects retain their existing concurrency behavior.
- Persist question/answer association in ordinary task history, not global memory. Stop, deletion and closure invalidate pending answers. Steering refreshes or withdraws an obsolete question; late answers must not revive a stopped task or feed the wrong terminal prompt. Reopening must not automatically answer or resume a process.
- Credentials should use an appropriate secure sign-in path, not be requested as plain chat or logged terminal input. If that flow is unavailable, report the specific blocker without widening host-secret access.

## 3. Safe package-manager links

- Extend filesystem state, diffs and publication to represent the link target itself. Never dereference a link to copy outside file contents into the repository.
- Support repository-contained relative links used by ordinary installations, such as `node_modules/.bin`. Resolve chains with containment checks and cycle detection; do not assume a relative-looking string stays inside the repository.
- Reject escaping links, absolute host targets and targets entering protected application storage or controlled Git metadata. Validate link parents and every target hop. Unsupported special files and unsafe hard links retain their current rejection behavior.
- Inspect existing links and revalidate source, destination and expected live revisions before publication. Creating/replacing/deleting links must have the same stale-edit and exclusive-creation protections as regular files. Preserve executable permissions on the regular targets.
- Ensure command copying, native repository access and recovery agree on link semantics. Permit only explicitly validated contained access where needed; never globally disable the existing symlink checks. Add clear link-change reporting without invented text-line counts.

## 4. Workflow environment and publication

- Keep the isolated HOME, writable cache, installed dependencies, working directory and necessary environment state consistent across the related scaffold/install/build commands. This is scoped workflow state, not access to the user's real home or global credentials/configuration.
- Store session files outside model-accessible application data and keep ownership/recovery records durable before starting processes. Caches must not leak between agents or Closed scopes. Cross-project/global cache sharing is not part of this delivery.
- Define explicit publication checkpoints after completed commands or a safely settled group of commands. Settle owned writers, inspect the staged tree and validate the complete candidate live-file set before applying its changes. Never publish an actively changing terminal tree just because a tool returned a session handle.
- Keep staged and published effects distinct in the interface. Already applied edits survive Stop/crash under D-067. Unfinished staged changes are not silently applied or replayed. Partial publication records the files actually applied and preserves newer live user edits.
- Do not attribute all existing dependencies or dirty files to this task. Keep real source/configuration diffs inspectable and summarize large generated/dependency changes accurately. Avoid repeatedly rescanning and saving the entire installation for every imported file; batch reconciliation where it preserves the same guards and truthful outcomes.
- On a publication conflict, report the conflict and inspect fresh state; do not overwrite the user, reset the repository or blindly rerun an installer with uncertain effects.

## 5. Bounded authorization and networking

- Reuse [[Tool Permissions]]: a clear request to create a project and install its necessary dependencies can authorize that setup's downloads. The grant covers the stated repository, operation and necessary related commands, not all future network use.
- Replace dependence on exact current-run command text with an explicit bounded intent/action record derived only from direct user messages or approvals. Track its origin, target, scope, state and revocation. Repository files, tool output and model arguments cannot grant permissions.
- For “try again” or Continue, identify the earlier user-requested action and inspect known effects before proceeding. Derive fresh authorization for the clearly repeated bounded action when justified; do not copy every old grant into a new run. Ambiguous retries or changed targets require clarification/approval. Denial or explicit revocation wins.
- Avoid per-download approval inside an authorized installation. Show any new network request with its actual action and scope. Keep Git mutations, push, publication/deployment, unrelated remote writes and access to credentials under their separate authorization rules.
- Treat loopback preview-server access separately from registry downloads and public web search. Bind development servers locally; do not silently expose it to the LAN. Implement only the network capability needed for this workflow. General domain/proxy policy tooling remains future work unless required for enforcement.
- Keep the current network boundary effective for command children. Do not disable the sandbox or enable arbitrary host networking as an automatic workaround for an installer failure.

## 6. Development-server lifecycle

- October 27 user revision: the agent may start a local preview at its own discretion without preview authorization or an approval dialog. Terminal enablement, owning-repository scope, isolation, local-only networking, explicit user opt-outs and Stop controls remain. A running server does not prove a successful installation/build. Report starting, ready, failed and stopped states, its local address and accessible output; verify readiness rather than treating a successful spawn as a working app.
- Ordinary setup shells end when their task finishes. A ready managed preview server may remain as a visibly managed chat/project-owned session after the answer. It does not consume a model lease or indefinitely reserve the repository project while idle. Persist enough ownership/status data to stop/reconcile it without pretending it is still a live agent run.
- A server runs against its isolated copy and never receives direct write access to the live repository. Label the published revision it previews. After later edits, refresh or restart it against a newly synchronized, revision-checked copy at a safe boundary; do not claim a stale preview reflects current code.
- User Stop/explicit server stop and deletion of the owning chat/container terminate its owned sessions. App/worker closure invokes liveness supervision, settlement and recovery; reopening reports interruption and requires explicit restart. Do not introduce an unattended daemon or automatic replay on app launch.
- Retain genuine unknown external/process outcomes for review. Detached descendants must remain confined even if they escape a process group; a cleanup failure must never give them live-repository access.

## Implementation checkpoints

These are dependency checkpoints, not six separate delivery passes. Checkpoints 1, 3 and 4 are implemented in 3A.1, together with supplied-command CLI/framework evidence from checkpoint 6. Checkpoints 2 and 5, plus real-model acceptance, are recorded separately in [[Pass 3A.2 Implementation & Testing]]. The complete acceptance matrix still applies to the full feature.

| Order | Deliverable | Required evidence before continuing |
| --- | --- | --- |
| 1 | Session ownership, PTY process supervision, start/read/input/stop tools and transport types | Disposable interactive command accepts input, produces incremental output, stops and remains confined |
| 2 | Question tool, waiting-input state and answer UI/IPC | A simulated model asks for a missing choice, resumes with the answer once and rejects stale answers |
| 3 | Link-aware manifests, access and guarded publication | Real executable links work; escaping/protected/cyclic links and publication races are rejected |
| 4 | Shared setup environment, cache and checkpoint publication | Scaffold/install/build commands see consistent state and preserve concurrent live edits |
| 5 | Bounded workflow/retry grants and managed preview sessions | No duplicate approval for authorized downloads; revocation, local-only readiness, stop and recovery work |
| 6 | Real framework and real-model acceptance, documentation/status reconciliation | The end-to-end matrix below passes or reports an explicit external blocker; no claim of completion from scaffold files alone |

Reuse existing workspace tools, scheduling, repository records and validation where their behavior fits. Add the necessary types, worker/main/preload messages, persistence and renderer states together. Engineering details such as exact tool names, tables and PTY package are chosen during implementation and recorded with results. This feature does not require Codex embedding, hosted search, a new model provider or subagents.

## Acceptance and verification

Use disposable repositories/profiles and the existing Electron test runner, type check and production build. Run simulated-model integration tests as well as real commands. No test may modify the user's actual application repository into a framework project.

| Case | Required result |
| --- | --- |
| Complete supplied command | The agent runs the given command with its stated flags/target, reports its real exit/output and does not substitute unsupported assumptions |
| Interactive fixture | A disposable CLI requires multiple answers; the agent supplies known answers, asks the user for a genuinely unknown choice and resumes the same task |
| Vite and Next.js | Record the full supplied scaffold commands, resolved tool/runtime versions and configuration; scaffold, install dependencies and finish a successful production build in disposable repositories |
| Missing choices | “Make this repository a Next.js project” produces only necessary questions; prior answers and an explicit request for defaults are honored |
| Existing work | Nonempty/dirty fixtures preserve unrelated content; overwrite choices are resolved, concurrent edits cause a truthful conflict and no blind reset/replay occurs |
| Installed links | Package-manager executable links survive publication and work in a subsequent isolated build command |
| Unsafe links | Escapes, absolute external targets, protected/Git destinations, cycles and changed target/parent races cannot bypass containment |
| Authorization | The original setup request and a clear retry avoid redundant prompts; changed targets, denied/revoked permissions and unrelated deployment requests retain the proper boundary |
| Process control | Long-running commands remain controllable without fixed kill timers; a requested server becomes ready, has visible ownership/output and can be stopped |
| Stop and restart | Stop while awaiting input, installing, publishing and serving; retain already applied edits, settle processes, invalidate old questions/grants and require explicit restart after closure |
| Scope and isolation | A different chat/agent/project cannot use another session; commands cannot read host secrets or write outside permitted storage; disabled command networking still denies network operations |
| Live agent behavior | A configured real model uses session/question tools, completes supplied-command setup and handles an underspecified setup request; record which live cases were actually run |

Begin with full user-supplied commands and deterministic local interactive fixtures; hosted web search is not needed. Real package downloads use bounded authorized command networking. Offline fixtures verify session/input/cache/link behavior but do not count as evidence that a real online framework install works. Read exact framework flags from the supplied command or its recorded help; do not freeze an assumed latest CLI syntax into the plan.

Completion requires the interactive path, questions, safe links, installation, successful build, visible outcomes and lifecycle/isolation cases to work together. A scaffold-only success, a passed mock, an unverified “done” response or a ready server without a build does not satisfy the goal. Report unavailable network, runtime, registry or model access as specific blockers.

## Scope remaining outside Pass 3A

Automatic rollback/undo, new command platforms, cross-project shared caches, advanced repository indexing, general domain/proxy configuration, hosted web search, broader Codex reuse and cross-provider session migration remain separate work. Normal dependency installation and build support must not be deferred under those broader optimization labels. Record actual implementation and verification results separately from this plan.
