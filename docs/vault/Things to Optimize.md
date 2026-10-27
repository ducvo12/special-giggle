# Things to optimize once the basics are done

> Agreed backlog. Build the basic lifecycle and enforce access/context limits first; improve efficiency after measuring working behavior. This is planning, not implemented functionality.

Related: [[Harness Design]] · [[Run Lifecycle Design]] · [[Memory & Context Policy]] · [[Decisions & Questions]]

Version assignments, October 27 (D-073/D-074): [[Granite Vision & Roadmap]] is the open roadmap. **v0.2** targets broad practical coding-harness capability: worktrees/access, concurrency, platform/terminal support, shared caches, networking, web search and provider tools. **v0.3** targets large-repository/context/tool-discovery/command-tracking efficiency plus subagents, including the user's reaffirmed mixed-model/provider orchestration goal. Neither version is divided into passes. Undo/restoration, allowance meters and optional Codex runtime adoption remain unassigned. Earlier baseline correctness requirements stay in v0.1.

## Automatic file restoration — deferred by D-067

**Version: unassigned.** Retained for later evaluation; not automatically included in v0.2 or v0.3.

- [ ] Evaluate restoring only the interrupted run’s repository edits after Stop or unexpected closure, preserving pre-existing and concurrent changes. The first version cancels/settles work and keeps completed edits, including when deleting a chat.
- [ ] Evaluate the necessary durable before/write records, guarded restoration, conflict handling, command-generated edits, duplicate-project links, restart recovery and snapshot cleanup. Avoid promising reversal of Git history, installations or remote effects.
- [ ] Decide whether automatic Stop restoration or an explicit user-driven Undo interface is preferable after the basic lifecycle is working. Retain visible diffs, stale-edit checks and genuine uncertain-outcome handling in the first version.

Earlier design material: [[Deferred File Restoration]] · [[Deferred File Restoration.canvas]]. This feature is outside step 3 of the initial implementation plan; ordinary repository tools, change visibility and cancellation remain included.

## Large-repository work

**Version: v0.3.** Performance, indexing and retrieval optimization.

- [ ] Measure searches, file reads, latency, context use, and task success on repositories with hundreds or thousands of files.
- [ ] Tune batched reads and bounded output: useful file ranges, shared result budgets, continuation, and dependency/generated-file exclusions.
- [ ] Evaluate incremental file/symbol/import maps and stale-index detection after code changes. Start with ordinary filename/text search; add richer indexing only when it helps.
- [ ] Evaluate semantic retrieval for code questions that ordinary search handles poorly, including its indexing/storage cost and permission filtering.

## Repository concurrency

**Version: v0.2** for independent-session/worktree concurrency and coordination. **Subagent delegation: v0.3**; its coordination requirements are designed with that feature.

October 27 promotion (D-071/D-072): same-section project edit grants, isolated worktree groups and their required checkout/merge coordination are now planned features in [[Repository Access & Worktree Plan]], not merely optional optimizations. The older project-wide reservation baseline below describes the current starting point; the extension must allow independent groups within one project to work concurrently while coordinating shared checkout writers.

- [ ] Allow genuinely read-only runs inside a repository project to run concurrently where safe. The first iteration reserves the repository for every run in that project, including questions that make no edits. Evaluate explicit read-only capability enforcement, access to in-progress changes and transition into an editing run while preserving per-project scheduling, cancellation and conflict checks. Automatic Stop restoration is deferred by D-067. D-062 allows separate projects to link/edit the same folder concurrently, so global single-editor exclusion is no longer a guarantee. Do not rely only on the model predicting it will not write. See [[Concurrency & Limits]].

- [ ] Evaluate coordination/performance improvements beyond the required behavior in [[Repository Access & Worktree Plan]], including more advanced overlapping-folder detection and broader cross-agent workflows. Worktree identity, isolation, destination coordination and recovery needed by D-072 must be implemented with that feature rather than deferred here. Preserve D-062's duplicate-link allowance and D-067's completed-edit retention.
- [ ] **v0.3:** design parent-directed subagents across different models/providers, with explicit delegated repository coordination. Relationship alone does not prevent simultaneous same-file conflicts. D-003 defers subagents from v0.1, not from Granite's long-term goal; see [[Granite Vision & Roadmap]].

## Model context

**Version: v0.3 for efficiency work.** Basic context-fit/compaction handling remains in v0.1 pass 4. The historical automatic-compaction backlog item below does not remove that baseline obligation; tuning, caching and richer retrieval are later optimization.

- [ ] Evaluate model-aware tool discovery/ranking, schema caching/eviction and provider-native search for large MCP catalogs. Measure definition-token overhead, actual context/headroom, format compatibility, tool-choice/argument errors and task success; avoid fixed 100k/500k thresholds. Full definition accounting is a basic fit requirement. D-066 accepts a compact direct core plus simple lookup when optional integrations arrive; smarter discovery/routing and per-model tuning remain later optimizations. Agreed starting direction: [[Tool Selection & Context]].

- [ ] Implement automatic context compaction before the model input reaches its budget. Preserve the task, user constraints, decisions, completed tool outcomes, and remaining work; retain the full stored transcript separately and honor context-scope and deletion rules. This is future work, not current functionality.

- [ ] Tune what to include automatically versus retrieve: current chat, local project/section context, user memory, notes, and brief eligible remote directories.
- [ ] Measure and tune compaction thresholds, reply/tool headroom, and what summaries retain. Keep the full stored transcript separate from the model's bounded input.
- [ ] Compare incremental summaries, retrieval-first approaches, and optional cached summaries without requiring a fresh section-wide model summary after every edit/deletion.
- [ ] Evaluate provider caching/stateful continuation and smaller local-model context windows, including LM Studio, while preserving scope, freshness, and deletion rules.

Use token use, response time, retrieval quality, and successful tasks to judge improvements. A newer API or research result is a reason to evaluate an approach, not to replace the basic visibility/retention/permission rules.

The starting point remains bounded listing/search/range reads, batching when supported, scoped text/database lookup, and the accepted model-aware context budget. Correct permission checks and basic context-limit handling are required from the start.

## Repository command execution and change tracking

**Version: v0.3 for execution/change-tracking efficiency.** Broader Git layouts and command-platform/terminal capability are v0.2. Required worktree support follows the v0.2 worktree plan.

- [ ] Optimize the initial complete manifest and temporary command-copy approach (see [[Pass 3 Implementation & Testing]]) for larger repositories: incremental scans, safe dependency/cache reuse, bounded diff storage and streaming change publication. Preserve command isolation, revision checks, visible outcomes and the rule that Stop retains already applied edits.
- [ ] Broaden Git metadata layouts and command platforms beyond the linked-worktree support required by [[Repository Access & Worktree Plan]], while keeping authorization and process/outcome tracking enforced. Required worktree metadata handling belongs to D-072; broader compatibility is later extension work.

## Project setup — promoted into the implementation plan

On October 26, the user moved interactive terminal control, missing-choice questions, safe installer-created links, a consistent isolated setup environment/cache, workflow/download/retry authorization and managed local preview sessions out of this deferred backlog. They are now **Pass 3A — Autonomous Project Setup**, to be implemented together before pass 4. See [[Repository Project Setup Plan]] and [[Harness Implementation Plan]] (D-068). The user chose two passes (D-069). The command foundation is now implemented and verified in [[Pass 3A.1 Implementation & Testing]]; 3A.2 now implements questions, bounded setup/retry grants and managed previews, with real-agent verification in [[Pass 3A.2 Implementation & Testing]]. Fixed command timers and repository size/count ceilings were already removed.

The broader optimizations remaining here are:

**Version: v0.2** for the shared-cache, broader-network and platform/terminal capability items below. Existing pass-3A setup/session/preview behavior is retained in v0.1.

- [ ] Evaluate cross-project/shared cache reuse with scope and credential isolation. Within-workflow cache/environment continuity is required by pass 3A and must not wait for this optimization.
- [ ] Evaluate general domain/proxy network-policy controls beyond the bounded installation and local-preview access needed for pass 3A. Preserve existing authorization; public web search does not grant a shell network access.
- [ ] Extend command platforms and advanced terminal tooling beyond the initial macOS supervised setup/session workflow, without weakening isolation or lifecycle ownership.

## Provider tools and Codex reuse

**Version: v0.2 for web search and provider tools**, including capability checks and portable fallbacks. **Optional Codex app-server adoption remains unassigned** as a separate architecture evaluation, not a prerequisite or implied harness replacement.

- [ ] Evaluate OpenAI-hosted `web_search` before building a separate search/fetch stack. Compare implementation effort, source quality, latency, cost, model/account availability and support for live versus cached results. Add provider capability checks, streamed search activity, native search-result continuation and clearly visible clickable citations. Keep a portable provider/MCP fallback for local or incompatible models; do not silently enable a separately billed service.
- [ ] Verify hosted tools separately for API-key connections and ChatGPT-plan sign-in. Current [Sign in with ChatGPT limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) allow web search subject to model/account/workspace policy, while several other hosted tools remain unsupported. Granite currently advertises only its own function tools; this backlog does not claim hosted search is enabled or verified for a particular account. See [Responses web search](https://developers.openai.com/api/docs/guides/tools-web-search).
- [ ] If broader Codex reuse would reduce maintenance, evaluate an optional [Codex app-server](https://learn.chatgpt.com/docs/app-server) integration separately from direct model access. Compare its shell/approval/history/search behavior with Granite’s scope, isolation, memory, retention and provider portability. Calling the Responses API does not start Codex or inherit its harness; adopting app-server would be an explicit architecture change. See [[Tooling Strategy]].

## ChatGPT account usage limits

**Version: unassigned.** The user has not assigned allowance-meter integration to either new release.

- [ ] Add five-hour, weekly and other provider-reported account allowance windows to the sidebar meters when a compatible reader is available. Prefer reusing the same ChatGPT sign-in that provides model access. The October 26 investigation confirmed no compatible allowance reader for the current plan-sharing connection; this does not establish that a separate login is the only possible future approach. See [investigation and live findings](../research/chatgpt-usage-meter.md).
- [ ] If allowance readings still require a separate Codex-authorized usage sign-in, defer that integration until a later optimization pass. User decision on October 26, 2026: do not require another sign-in solely to display limits now. Evaluate it as an optional addition with explicit account association, without replacing Granite's existing model connection or agent loop. Existing API request/token meters do not constitute ChatGPT subscription allowance support.
