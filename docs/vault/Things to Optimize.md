# Things to optimize once the basics are done

> Agreed backlog. Build the basic lifecycle and enforce access/context limits first; improve efficiency after measuring working behavior. This is planning, not implemented functionality.

Related: [[Harness Design]] · [[Run Lifecycle Design]] · [[Memory & Context Policy]] · [[Decisions & Questions]]

## Automatic file restoration — deferred by D-067

- [ ] Evaluate restoring only the interrupted run’s repository edits after Stop or unexpected closure, preserving pre-existing and concurrent changes. The first version cancels/settles work and keeps completed edits, including when deleting a chat.
- [ ] Evaluate the necessary durable before/write records, guarded restoration, conflict handling, command-generated edits, duplicate-project links, restart recovery and snapshot cleanup. Avoid promising reversal of Git history, installations or remote effects.
- [ ] Decide whether automatic Stop restoration or an explicit user-driven Undo interface is preferable after the basic lifecycle is working. Retain visible diffs, stale-edit checks and genuine uncertain-outcome handling in the first version.

Earlier design material: [[Deferred File Restoration]] · [[Deferred File Restoration.canvas]]. This feature is outside step 3 of the initial implementation plan; ordinary repository tools, change visibility and cancellation remain included.

## Large-repository work

- [ ] Measure searches, file reads, latency, context use, and task success on repositories with hundreds or thousands of files.
- [ ] Tune batched reads and bounded output: useful file ranges, shared result budgets, continuation, and dependency/generated-file exclusions.
- [ ] Evaluate incremental file/symbol/import maps and stale-index detection after code changes. Start with ordinary filename/text search; add richer indexing only when it helps.
- [ ] Evaluate semantic retrieval for code questions that ordinary search handles poorly, including its indexing/storage cost and permission filtering.

## Repository concurrency

- [ ] Allow genuinely read-only runs inside a repository project to run concurrently where safe. The first iteration reserves the repository for every run in that project, including questions that make no edits. Evaluate explicit read-only capability enforcement, access to in-progress changes and transition into an editing run while preserving per-project scheduling, cancellation and conflict checks. Automatic Stop restoration is deferred by D-067. D-062 allows separate projects to link/edit the same folder concurrently, so global single-editor exclusion is no longer a guarantee. Do not rely only on the model predicting it will not write. See [[Concurrency & Limits]].

- [ ] Evaluate cross-project coordination when multiple projects/agents link the same folder: stronger overlap/worktree detection, optional isolation and collision-aware scheduling. D-062 allows these links now with stored paths and a warning; do not reintroduce a mandatory unique owner as an unreviewed optimization. Keep edit conflict protection and report actual outcomes; automatic restoration is deferred under D-067.
- [ ] If subagents are introduced later, design explicit delegated repository coordination. Relationship alone does not prevent simultaneous same-file conflicts; there are no subagents in version one.

## Model context

- [ ] Evaluate model-aware tool discovery/ranking, schema caching/eviction and provider-native search for large MCP catalogs. Measure definition-token overhead, actual context/headroom, format compatibility, tool-choice/argument errors and task success; avoid fixed 100k/500k thresholds. Full definition accounting is a basic fit requirement. D-066 accepts a compact direct core plus simple lookup when optional integrations arrive; smarter discovery/routing and per-model tuning remain later optimizations. Agreed starting direction: [[Tool Selection & Context]].

- [ ] Implement automatic context compaction before the model input reaches its budget. Preserve the task, user constraints, decisions, completed tool outcomes, and remaining work; retain the full stored transcript separately and honor context-scope and deletion rules. This is future work, not current functionality.

- [ ] Tune what to include automatically versus retrieve: current chat, local project/section context, user memory, notes, and brief eligible remote directories.
- [ ] Measure and tune compaction thresholds, reply/tool headroom, and what summaries retain. Keep the full stored transcript separate from the model's bounded input.
- [ ] Compare incremental summaries, retrieval-first approaches, and optional cached summaries without requiring a fresh section-wide model summary after every edit/deletion.
- [ ] Evaluate provider caching/stateful continuation and smaller local-model context windows, including LM Studio, while preserving scope, freshness, and deletion rules.

Use token use, response time, retrieval quality, and successful tasks to judge improvements. A newer API or research result is a reason to evaluate an approach, not to replace the basic visibility/retention/permission rules.

The starting point remains bounded listing/search/range reads, batching when supported, scoped text/database lookup, and the accepted model-aware context budget. Correct permission checks and basic context-limit handling are required from the start.

## Repository command execution and change tracking

- [ ] Optimize the initial complete manifest and temporary command-copy approach (see [[Pass 3 Implementation & Testing]]) for larger repositories: incremental scans, safe dependency/cache reuse, bounded diff storage and streaming change publication. Preserve command isolation, revision checks, visible outcomes and the rule that Stop retains already applied edits.
- [ ] Broaden supported Git/worktree metadata layouts and command platforms while keeping authorization and process/outcome tracking enforced. This is implementation optimization/extension work, not the separate pending verification backlog.

## Interactive terminal control and network access

Basic repository commands and bounded authorization for installations/network access are already included in pass 3 and [[Tool Permissions]]. The following extensions were added October 26, 2026; they remain future work. Fixed command timers and repository size/count ceilings have already been removed, not deferred.

- [ ] Add interactive terminal sessions: PTY/stdin support for answering scaffold/installer prompts, streamed output, session status and explicit termination. Evaluate persistent sessions and background development servers without holding the entire model/tool loop open. Preserve the isolated command environment, owned-process cleanup, repository membership and Stop/crash outcome handling; define when files from a still-running session become visible in the live repository.
- [ ] Complete dependency/framework installation workflows, including safe publication of repository-contained relative symbolic links (such as `node_modules/.bin`), isolated reusable caches and environment persistence. Reject escaping/protected targets and never grant installers access to host secrets. Verify a disposable Vite scaffold → dependency install → build → development-server flow. Existing relative links are preserved in command copies; newly created links currently block publication.
- [ ] Improve authorized command networking: scoped grants that cover the requested installation/workflow without repeated download prompts, visible/revocable grants, and evaluation of domain/proxy controls, loopback development-server access and credential handling. Keep downloads, remote writes/deployments and local file edits distinct; public web search does not grant a shell network access. Preserve existing authorization rules and isolate all command children.

## Provider tools and Codex reuse

- [ ] Evaluate OpenAI-hosted `web_search` before building a separate search/fetch stack. Compare implementation effort, source quality, latency, cost, model/account availability and support for live versus cached results. Add provider capability checks, streamed search activity, native search-result continuation and clearly visible clickable citations. Keep a portable provider/MCP fallback for local or incompatible models; do not silently enable a separately billed service.
- [ ] Verify hosted tools separately for API-key connections and ChatGPT-plan sign-in. Current [Sign in with ChatGPT limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) allow web search subject to model/account/workspace policy, while several other hosted tools remain unsupported. Granite currently advertises only its own function tools; this backlog does not claim hosted search is enabled or verified for a particular account. See [Responses web search](https://developers.openai.com/api/docs/guides/tools-web-search).
- [ ] If broader Codex reuse would reduce maintenance, evaluate an optional [Codex app-server](https://learn.chatgpt.com/docs/app-server) integration separately from direct model access. Compare its shell/approval/history/search behavior with Granite’s scope, isolation, memory, retention and provider portability. Calling the Responses API does not start Codex or inherit its harness; adopting app-server would be an explicit architecture change. See [[Tooling Strategy]].

## ChatGPT account usage limits

- [ ] Add five-hour, weekly and other provider-reported account allowance windows to the sidebar meters when a compatible reader is available. Prefer reusing the same ChatGPT sign-in that provides model access. The October 26 investigation confirmed no compatible allowance reader for the current plan-sharing connection; this does not establish that a separate login is the only possible future approach. See [investigation and live findings](../research/chatgpt-usage-meter.md).
- [ ] If allowance readings still require a separate Codex-authorized usage sign-in, defer that integration until a later optimization pass. User decision on October 26, 2026: do not require another sign-in solely to display limits now. Evaluate it as an optional addition with explicit account association, without replacing Granite's existing model connection or agent loop. Existing API request/token meters do not constitute ChatGPT subscription allowance support.
