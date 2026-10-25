# Things to optimize once the basics are done

> Agreed backlog. Build the basic lifecycle and enforce access/context limits first; improve efficiency after measuring working behavior. This is planning, not implemented functionality.

Related: [[Harness Design]] · [[Run Lifecycle Design]] · [[Memory & Context Policy]] · [[Decisions & Questions]]

## Large-repository work

- [ ] Measure searches, file reads, latency, context use, and task success on repositories with hundreds or thousands of files.
- [ ] Tune batched reads and bounded output: useful file ranges, shared result budgets, continuation, and dependency/generated-file exclusions.
- [ ] Evaluate incremental file/symbol/import maps and stale-index detection after code changes. Start with ordinary filename/text search; add richer indexing only when it helps.
- [ ] Evaluate semantic retrieval for code questions that ordinary search handles poorly, including its indexing/storage cost and permission filtering.

## Repository concurrency

- [ ] Allow genuinely read-only runs inside a repository project to run concurrently where safe. The first iteration reserves the repository for every run in that project, including questions that make no edits. Evaluate explicit read-only capability enforcement, access to in-progress changes and transition into an editing run while preserving per-project scheduling and the guarded Stop/undo boundary. D-062 allows separate projects to link/edit the same folder concurrently, so global single-editor exclusion is no longer a guarantee. Do not rely only on the model predicting it will not write. See [[Concurrency & Limits]].

- [ ] Evaluate cross-project coordination when multiple projects/agents link the same folder: stronger overlap/worktree detection, optional isolation and collision-aware scheduling. D-062 allows these links now with stored paths and a warning; do not reintroduce a mandatory unique owner as an unreviewed optimization. Keep conflict protection and report incomplete Stop restoration honestly.
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
