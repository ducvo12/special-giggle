# Harness Implementation Plan

> v0.1 delivery plan, consolidated October 29, 2026. Passes 1–3 and both 3A passes are implemented with recorded verification; passes 4–6 remain planned. Completion of implementation is separate from exhaustive acceptance. [[Start Here]] indexes the evidence; [[Tests to Run Later]] preserves skipped verification.

Related: [[Start Here]] · [[Harness Design]] · [[Decision Register]] · [[Run Lifecycle Design]] · [[Container & Settings Rules]] · [[Things to Optimize]]

## How the passes will work

The six passes plus 3A define v0.1. v0.2 worktrees/same-section edit grants and v0.3 optimizations/mixed-model subagents remain separate in [[Granite Vision & Roadmap]]. No new pass numbering is assigned to those later versions. Stop/crash/chat deletion keep completed edits; automatic restoration is not a prerequisite for any current pass.

Audit the existing implementation before changing it, reuse working behavior and preserve existing user data and unrelated changes. Each pass includes the interface needed to use its features; pass 6 checks the whole application together. Features become available once their required behavior is implemented and verified.

Use Granite's existing Electron-based test runner (`npm test`) and type checking (`npm run typecheck`) at each checkpoint. Extend meaningful behavior tests rather than replacing the test setup. Use isolated temporary databases/repositories, simulated model responses, local test servers and a controllable clock. Test destructive operations on disposable fixtures. Real-model checks supplement repeatable automated tests.

## Pass 1 — Data Foundation and Organization

**Status:** Implemented. Original criteria reviewed in [[Pass 1 Implementation & Testing]].

**Delivered scope**

Add the Agent → Section → Project → Chat structure, stable identifiers and database migrations. Give each agent one built-in Shared General section containing chats only. Support custom Shared/Closed sections, projects with zero or one repository attachment, and section-level temporary-chat metadata. Establish file locations for identity, memory, notes and agent-local tools. Add basic navigation and backend rules for membership, permanent project placement and permitted chat moves. Create the storage for repository links, without imposing unique ownership across projects. Temporary expiry and destructive lifecycle controls arrive in pass 5.

**Acceptance checks**

- Upgrade an existing database and reopen it twice: chats, messages, identity, memory and provider state survive; migration does not create duplicate sections or records.
- Create/reload the full hierarchy. Reject projects in General, direct section repository ownership, project moves and a second simultaneous repository attachment to one project.
- Verify chat movement rules: repository-bound chats cannot leave; Closed chats cannot leave their section until it becomes Shared; eligible moves preserve transcript and ID. Active-run locks are completed in pass 2.
- Verify one-way Closed → Shared conversion, isolation of different agents' data and allowance of duplicate repository references across projects.

## Pass 2 — Basic Run Lifecycle and Scheduling

**Status:** Implemented. Selected desktop checks passed; broader verification remains in [[Tests to Run Later]]. See [[Pass 2 Implementation & Testing]] and [[Pass 2 Focused Verification Results]].

**Delivered scope**

Implement one text-only run from submission through provisional streaming, persistence and completion. Add steering that preserves the original request, one active run per chat, fixed session models, host-capacity queues with live positions, cancellation and approval-state plumbing. Apply permission changes before subsequent requests/actions. Implement model-response validation, the agreed bounded connection retry and Continue behavior. Add basic restart handling for interrupted model work and saved queued messages. Keep/move controls lock during active runs. Repository process cleanup extends this in pass 3; temporary timers arrive in pass 5.

**Acceptance checks**

- Simulate complete, empty, malformed, interrupted and tool-bearing responses: persist valid output once, execute no incomplete calls and finalize only a successful completed response without pending tool calls.
- Steer “make it blue” with “make it green”: the next request receives both messages in order. Stop wins over steering; late callbacks cannot restart stopped work.
- Queue several chats behind a single-capacity endpoint: positions update, cancellation removes the right entry and repeated messages do not create duplicate jobs. Independent chats run when capacity permits.
- Verify fixed model binding, active Keep/move locks, next-action permission changes and invalidated approvals. Check one permitted transient retry, no replay after partial output, and explicit restart of queued messages after reopening.
- Run a simulated multi-step task without an artificial whole-run cap. Operation failures and model limits still produce clear outcomes.

## Pass 3 — Repository Tools and Change Visibility

**Status:** Implemented with basic verification in [[Pass 3 Implementation & Testing]]. Pass 3A extends command/setup support; do not use historical terminal limits as current behavior.

**Delivered scope**

Deliver all native repository operations: listing/search/range reads; create/edit/patch/rename/delete; permitted terminal commands, tests and builds; Git inspection and explicitly authorized Git changes. Prefer established implementations behind Granite's scope, permission and cancellation controls. Grant standing local read/write access inside a repository project, eligible read-only access outside it, and serialize runs within each project. Show actual file changes, diffs and added/removed line counts. Add stale-edit protection, process-group cancellation and repository-aware crash/outcome handling. Stop keeps completed edits; no automatic rollback or undo journal is included.

**Acceptance checks**

- Exercise every file operation against disposable repositories, including new files, deletions, renames and binary changes. Diff/count displays distinguish run changes from pre-existing edits.
- Test the repository access matrix: Shared versus Closed, member versus outside chat, temporary versus permanent and same versus different agent. Reject traversal, symlink escapes and protected app storage; terminal/Git paths cannot bypass those rules.
- Verify ordinary member edits need no per-edit prompt. Git mutations, installations/network access and remote actions require their agreed authorization, while clear existing authorization avoids duplicate prompts.
- Change a file between read and edit: reject the stale write, allow the agreed fresh-read correction and preserve another writer's contents. Same-project runs queue; different linked projects are not forced into a global lock.
- Stop or crash after one completed edit and during a long command: settle owned writers, retain edits, show actual outcomes and the crash popup where applicable. Unknown effects are checked without blind replay.

## Pass 3A — Autonomous Project Setup

**Status:** Both passes implemented. 3A.1 supplies interactive commands, safe package links and run HOME/cache; 3A.2 adds questions, bounded setup/retry grants and managed previews. Recorded framework builds, real-model and desktop results: [[Pass 3A.1 Implementation & Testing]] · [[Pass 3A.2 Implementation & Testing]]. Full contract: [[Repository Project Setup Plan]]. Results do not guarantee every future installer/provider.

**Delivered scope**

Support requests such as “Make this repository a Next.js project” and complete supplied scaffold commands. Add supervised interactive terminal sessions, incremental output and session/input/stop controls; a dedicated question tool and answer interface for missing choices; safe publication/use of repository-contained relative package-manager links; a consistent isolated setup environment/cache across related commands; bounded setup/retry authorization; and managed local preview-server status/termination. The agent inspects existing work, resolves necessary choices, scaffolds, installs dependencies, verifies a production build and reports actual results. Preserve repository-copy/macOS isolation, scope, revision guards, user-controlled terminal enablement and Stop/crash retention. No web-search implementation or Codex runtime adoption is required.

**Acceptance checks**

- Exercise an interactive fixture with both agent-known answers and user-required choices; resume once, reject stale answers and release model capacity during waits.
- Give full recorded commands for disposable Vite and Next.js projects; run scaffold → dependency installation → actual successful build. Verify generated executable links in subsequent commands. Offline fixtures supplement, but do not replace, real download/install acceptance.
- Test nonempty repositories, conflict-safe checkpoints, escaping/protected/cyclic links, disabled networking and cross-chat/session access. Do not turn an actual user repository into a test project.
- Verify bounded authorization from the task and clear retries avoids duplicate download prompts without enabling unrelated remote actions. Preserve denial/revocation and current permission checks.
- Stop/crash while waiting for input, installing, publishing and serving. Keep applied edits, discard unfinished staged work, settle owned processes and invalidate old questions; no automatic process restart or tool replay.
- Verify agent-chosen previews need no separate authorization, with readiness/status/output, explicit termination, later-code refresh and release of model/project capacity when only a managed idle preview remains. Finish a real-model walkthrough, type check, build and relevant automated/desktop checks; record evidence separately from this plan.

## Pass 4 — Context, Memory and Retrieval

**Status:** Implemented; ready for user verification. [[Pass 4 Implementation & Testing]] records 169 passing automated checks, desktop/package evidence and remaining live-provider acceptance.

Detailed implementation and reuse proposal: [[Pass 4 Implementation Plan]].

**Planned changes**

- **Prepare useful context:** current task/history and personality, richer relevant local project/section context, eligible user memory and brief remote directories. Do not attach every chat or repository file.
- **Retrieve evidence:** native scoped list/search/read over original saved messages, titles, summaries and notes; indexed text search, stable source references, bounded snippets and pagination. No vector database required initially.
- **Improve basic repository search:** prefer an established fast lexical-search implementation behind Granite's access checks; add explicit case/regex options, sensible ignore rules for dependencies/generated output and an explicit scoped override when those files are needed. Return useful file/line excerpts with clear truncation and a way to narrow or continue. Preserve read-only cross-project access and cancellation. This extends the existing repository tools; it does not add embeddings, semantic ranking or code-relationship indexes.
- **Maintain memory selectively:** durable confirmed user facts in memory, reusable knowledge in notes, incremental chat/project/section continuity after meaningful completed turns. No separate summary call after every greeting or full-section regeneration after each deletion.
- **Honor current files and boundaries:** refresh eligible manual/agent memory/notes equally for each model request; revision-guard concurrent updates; enforce Shared/Closed/temporary and agent boundaries across prompts, metadata, tools, indexes and cached provider state. Enable Closed execution only when isolation is enforced. Temporary context/write rules are established here; full temporary lifecycle remains pass 5.
- **Fit the selected model:** count instructions, schemas, history and tool output; reserve reply/tool headroom and compact older input before exhaustion, preserving task/steering/permissions and the full saved transcript. Initial tuning defaults live in [[Memory & Context Policy]].
- **Approve identity and clean sources:** exact-change identity approval with next-run activation; remove deleted-source support and invalidate unsupported generated memory/index/cache state without rewriting surviving chats or removing independently supported facts.

**Tests**

- Build a fixture with separate user-selectable agents and Shared/Closed/temporary scopes and inspect assembled requests, listings, snippets and direct reads. Ineligible content and even its titles/counts must remain unavailable; repository-file access follows its separate rules.
- Retrieve a fact omitted from a summary using original saved messages. Verify source links, bounded output/pagination and rejection of guessed, deleted or newly inaccessible source IDs.
- Search disposable repositories by filename, literal text and regex/case options. Verify default ignore behavior and explicit inclusion of normally ignored files; useful bounded results and continuation; cancellation; and rejection of link/protected-path or cross-scope escapes. An outside readable repository remains read-only. Record representative search timings without claiming optimized large-repository performance.
- Edit memory/notes manually between model requests: the next eligible request uses the current version. Concurrent updates cannot overwrite a newer edit; temporary chats cannot make durable contributions.
- Mention a fact in five chats and delete one: the other four chats remain unchanged and support the fact. Remove its sole source: unsupported generated memory/caches become unavailable without treating cached echoes as independent evidence.
- Exercise a small context window: count tool definitions, preserve task/steering and permissions during compaction, retain the stored transcript and report when mandatory input cannot fit. Test identity approval, denial, stale previews and next-run activation.

## Pass 5 — Chat/Container Lifecycle and Extensions

**Status:** Planned. Complete the lifecycle around existing agent/chat deletion, skills and MCP; project/section cascade deletion and temporary expiry are not already delivered.

**Planned changes**

Complete temporary-chat creation, one-hour inactivity expiry, Keep and the separately approved permanent move into a repository project. Complete deletion of chats/projects/sections/agents and associated source cleanup, including cancel/settle during active or queued work; preserve the existing basic agent/chat deletion paths. Add missing-folder warnings, relinking to the same or different codebase, and duplicate-link warnings. Install requested existing skills under `agent/tools/skills/`, preserve their resources and load relevant enabled skills. Integrate scoped MCP capabilities and compact core tools plus optional-tool lookup. Keep automatic file restoration deferred.

**Tests**

- Use a controllable clock: active or queued work holds 1:00:00, responses/actions refresh it, approval-only waiting counts down, and an old timer cannot delete protected work. Verify offline deadlines and one-time restart recovery without waiting a real hour.
- Test Keep → separately approved move → edit, including declining either step. Temporary chats cannot enter projects or edit code; active chats cannot be kept/moved. Deleted/expired chats cannot be recreated by late callbacks.
- Delete disposable chats and nested containers during queued/active work. Settle writers; remove owned folders, descendant database rows and derived state. Chat deletion keeps code, container deletion removes internal code, and externally linked folders survive.
- Remove/move a linked folder, then relink to a different repository. Check warnings, preserved history, refreshed permissions/caches, an explicit repository-change notice and fresh inspection. Duplicate links warn without being rejected; failed first attachment leaves a usable chat-only project.
- Import a fixture skill with references/scripts and discover a fixture MCP tool. Verify resources survive, imports execute no scripts, disabled/ineligible tools stay undiscoverable, discovered schemas are usable, and current permissions still govern execution.

## Pass 6 — Integration and Release Verification

**Status:** Planned. Earlier packaging/provider checks are useful evidence, not completion of the integrated acceptance sweep.

**Planned changes**

Finish navigation and status consistency across frontend/backend: preparing, streaming, queued, approval, stopping, interrupted, missing-folder and deleted states. Check all earlier features together, fix regressions and complete migrations/documentation. Build and locally package the application, then verify launch/relaunch. Exercise a configured hosted model and an LM Studio/local endpoint when available; report unavailable or unsupported capabilities explicitly. Packaging is a local verification step, not publication.

**Tests**

- Run the full automated suite, type checking and production build; locally package and launch the resulting app. Retest upgrading a copy of existing user data and reopening it repeatedly.
- Walk through complete user journeys: ordinary chat; steering; outside-project read → approved move → edit; temporary Keep → move; memory lookup; requested skill installation; optional-tool discovery.
- Run concurrent chats, permission changes and manual file edits, then interrupt network/process/app activity at controlled points. Check for duplicate messages/tools, stale access, stuck queues, surviving owned processes and deleted data reappearing.
- Check hosted and local-model streaming/tool loops, capacity-one queueing, malformed calls and context-limit errors. Use deterministic simulated equivalents for unavailable real hosts; record which live checks were actually completed.
- Confirm interface states and outcomes agree, completed edits survive Stop/crash, external folders survive container deletion, and deferred features remain outside the first version.

## Completion and deferred work

A pass is complete when its planned behavior and relevant interface work are implemented, its meaningful tests pass and any existing baseline failures or external blockers are documented. Fix regressions introduced by that pass before moving on. These are planned checks, not results already obtained.

Automatic restoration/Undo and cross-provider session migration remain unassigned. v0.2 includes same-section repository grants, isolated worktree groups and their required coordination in [[Repository Access & Worktree Plan]], plus broader platform/network/provider capabilities. v0.3 includes large-repository/context/tool-discovery/command-tracking efficiency and mixed-model subagents. [[Things to Optimize]] tracks the follow-up work without deferring basic context, scope or lifecycle correctness.

Both 3A passes already deliver interactive commands, questions, safe installer links, setup/download/retry authorization and managed previews. Do not put ordinary install/build support back into the optimization queue. Granite owns its harness and calls model APIs directly.
