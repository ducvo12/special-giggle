# Harness Implementation Plan

> Planned October 25, 2026. Pass 1’s original acceptance criteria are supported by the recorded implementation/testing review. Pass 2 is implemented; selected reply, steering, queue and Stop/Continue checks passed in [[Pass 2 Focused Verification Results]]. Broader verification remains pending in [[Pass 2 Tests to Run Later]]. Pass 3 is implemented with basic verification in [[Pass 3 Implementation & Testing]]; passes 4–6 remain planned. Based on the accepted harness decisions through D-067. Automatic restoration of file edits is deferred: Stop, crash recovery and chat deletion keep completed repository edits.

Related: [[Harness Design]] · [[Remaining Harness Decisions]] · [[Decisions & Questions]] · [[Run Lifecycle Design]] · [[Container & Settings Rules]] · [[Things to Optimize]]

## How the passes will work

Audit the existing implementation before changing it, reuse working behavior and preserve existing user data and unrelated changes. Each pass includes the interface needed to use its features; pass 6 checks the whole application together. Features become available once their required behavior is implemented and verified.

Use Granite's existing Electron-based test runner (`npm test`) and type checking (`npm run typecheck`) at each checkpoint. Extend meaningful behavior tests rather than replacing the test setup. Use isolated temporary databases/repositories, simulated model responses, local test servers and a controllable clock. Test destructive operations on disposable fixtures. Real-model checks supplement repeatable automated tests.

## Pass 1 — Data Foundation and Organization

**Planned changes**

Add the Agent → Section → Project → Chat structure, stable identifiers and database migrations. Give each agent one built-in Shared General section containing chats only. Support custom Shared/Closed sections, projects with zero or one repository attachment, and section-level temporary-chat metadata. Establish file locations for identity, memory, notes and agent-local tools. Add basic navigation and backend rules for membership, permanent project placement and permitted chat moves. Create the storage for repository links, without imposing unique ownership across projects. Temporary expiry and destructive lifecycle controls arrive in pass 5.

**Tests**

- Upgrade an existing database and reopen it twice: chats, messages, identity, memory and provider state survive; migration does not create duplicate sections or records.
- Create/reload the full hierarchy. Reject projects in General, direct section repository ownership, project moves and a second simultaneous repository attachment to one project.
- Verify chat movement rules: repository-bound chats cannot leave; Closed chats cannot leave their section until it becomes Shared; eligible moves preserve transcript and ID. Active-run locks are completed in pass 2.
- Verify one-way Closed → Shared conversion, isolation of different agents' data and allowance of duplicate repository references across projects.

## Pass 2 — Basic Run Lifecycle and Scheduling

**Planned changes**

Implement one text-only run from submission through provisional streaming, persistence and completion. Add steering that preserves the original request, one active run per chat, fixed session models, host-capacity queues with live positions, cancellation and approval-state plumbing. Apply permission changes before subsequent requests/actions. Implement model-response validation, the agreed bounded connection retry and Continue behavior. Add basic restart handling for interrupted model work and saved queued messages. Keep/move controls lock during active runs. Repository process cleanup extends this in pass 3; temporary timers arrive in pass 5.

**Tests**

- Simulate complete, empty, malformed, interrupted and tool-bearing responses: persist valid output once, execute no incomplete calls and finalize only a successful completed response without pending tool calls.
- Steer “make it blue” with “make it green”: the next request receives both messages in order. Stop wins over steering; late callbacks cannot restart stopped work.
- Queue several chats behind a single-capacity endpoint: positions update, cancellation removes the right entry and repeated messages do not create duplicate jobs. Independent chats run when capacity permits.
- Verify fixed model binding, active Keep/move locks, next-action permission changes and invalidated approvals. Check one permitted transient retry, no replay after partial output, and explicit restart of queued messages after reopening.
- Run a simulated multi-step task without an artificial whole-run cap. Operation failures and model limits still produce clear outcomes.

## Pass 3 — Repository Tools and Change Visibility

**Planned changes**

Deliver all native repository operations: listing/search/range reads; create/edit/patch/rename/delete; permitted terminal commands, tests and builds; Git inspection and explicitly authorized Git changes. Prefer established implementations behind Granite's scope, permission and cancellation controls. Grant standing local read/write access inside a repository project, eligible read-only access outside it, and serialize runs within each project. Show actual file changes, diffs and added/removed line counts. Add stale-edit protection, process-group cancellation and repository-aware crash/outcome handling. Stop keeps completed edits; no automatic rollback or undo journal is included.

**Tests**

- Exercise every file operation against disposable repositories, including new files, deletions, renames and binary changes. Diff/count displays distinguish run changes from pre-existing edits.
- Test the repository access matrix: Shared versus Closed, member versus outside chat, temporary versus permanent and same versus different agent. Reject traversal, symlink escapes and protected app storage; terminal/Git paths cannot bypass those rules.
- Verify ordinary member edits need no per-edit prompt. Git mutations, installations/network access and remote actions require their agreed authorization, while clear existing authorization avoids duplicate prompts.
- Change a file between read and edit: reject the stale write, allow the agreed fresh-read correction and preserve another writer's contents. Same-project runs queue; different linked projects are not forced into a global lock.
- Stop or crash after one completed edit and during a long command: settle owned writers, retain edits, show actual outcomes and the crash popup where applicable. Unknown effects are checked without blind replay.

## Pass 4 — Context, Memory and Retrieval

**Planned changes**

Assemble bounded context from current history, richer local section/project information, eligible user memory and brief remote directories. Implement native context listing, indexed text search and detailed reads with source references. Add selective automatic memory/notes updates, incremental meaningful-turn summaries and basic context-fit/compaction handling. Refresh permitted file contents on every model request, treating manual and agent edits equally. Enforce Shared/Closed/Temporary boundaries across prompts, search, tools and caches. Add exact-change identity approval with next-run personality timing, plus deleted-source cleanup that preserves other chats and independently supported facts.

**Tests**

- Build a multi-agent, Shared/Closed/temporary fixture and inspect assembled requests, listings, snippets and direct reads. Ineligible content and even its titles/counts must remain unavailable; repository-file access follows its separate rules.
- Retrieve a fact omitted from a summary using original saved messages. Verify source links, bounded output/pagination and rejection of guessed, deleted or newly inaccessible source IDs.
- Edit memory/notes manually between model requests: the next eligible request uses the current version. Concurrent updates cannot overwrite a newer edit; temporary chats cannot make durable contributions.
- Mention a fact in five chats and delete one: the other four chats remain unchanged and support the fact. Remove its sole source: unsupported generated memory/caches become unavailable without treating cached echoes as independent evidence.
- Exercise a small context window: count tool definitions, preserve task/steering and permissions during compaction, retain the stored transcript and report when mandatory input cannot fit. Test identity approval, denial, stale previews and next-run activation.

## Pass 5 — Chat/Container Lifecycle and Extensions

**Planned changes**

Complete temporary-chat creation, one-hour inactivity expiry, Keep and the separately approved permanent move into a repository project. Implement deletion of chats/projects/sections/agents and associated source cleanup. Add missing-folder warnings, relinking to the same or different codebase, and duplicate-link warnings. Install requested existing skills under `agent/tools/skills/`, preserve their resources and load relevant enabled skills. Integrate scoped MCP capabilities and compact core tools plus optional-tool lookup. Keep automatic file restoration deferred.

**Tests**

- Use a controllable clock: active or queued work holds 1:00:00, responses/actions refresh it, approval-only waiting counts down, and an old timer cannot delete protected work. Verify offline deadlines and one-time restart recovery without waiting a real hour.
- Test Keep → separately approved move → edit, including declining either step. Temporary chats cannot enter projects or edit code; active chats cannot be kept/moved. Deleted/expired chats cannot be recreated by late callbacks.
- Delete disposable chats and nested containers during queued/active work. Settle writers; remove owned folders, descendant database rows and derived state. Chat deletion keeps code, container deletion removes internal code, and externally linked folders survive.
- Remove/move a linked folder, then relink to a different repository. Check warnings, preserved history, refreshed permissions/caches, an explicit repository-change notice and fresh inspection. Duplicate links warn without being rejected; failed first attachment leaves a usable chat-only project.
- Import a fixture skill with references/scripts and discover a fixture MCP tool. Verify resources survive, imports execute no scripts, disabled/ineligible tools stay undiscoverable, discovered schemas are usable, and current permissions still govern execution.

## Pass 6 — Integration and Release Verification

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

Automatic restoration/undo snapshots, subagents, semantic retrieval, advanced large-repository/context tuning, cross-project/worktree coordination and cross-provider session migration remain deferred. See [[Things to Optimize]] and [[Deferred File Restoration]].

October 26 clarification: pass 3 already includes repository terminal commands and explicitly authorized installation/network actions. Interactive terminal control, persistent/background sessions, fuller dependency/framework installation support and richer scoped network controls are future extensions in [[Things to Optimize]]. Granite currently owns the harness and calls model APIs directly; it does not inherit Codex's harness. Hosted web search and optional broader Codex reuse are separate evaluations in [[Tooling Strategy]] and [[Things to Optimize]], not currently enabled features.
