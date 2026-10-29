# Things to Optimize

> Future improvement backlog, consolidated October 29, 2026. Version ownership is in [[Granite Vision & Roadmap]]. Pending verification belongs in [[Tests to Run Later]]; required baseline correctness stays in the implementation passes.

## v0.2 — Broader capabilities

These are feature extensions, not a reason to postpone required isolation/recovery work:

- [ ] Implement same-section project edit grants and isolated worktree groups, persistent directly prompted chats, user-requested merge and successful-merge closure under [[Repository Access & Worktree Plan]]. Settle grant lifetime, integration/cleanup and workspace ownership first.
- [ ] Coordinate same-checkout writers, merge destinations, duplicate/overlapping links and independent sessions. Worktree/Git coordination required for the feature ships with it, not as optional later polish.
- [ ] Allow genuinely read-only concurrent runs where enforced. Current v0.1 reserves a project for every run, including text-only questions; a model prediction that it will not write is insufficient.
- [ ] Extend macOS-only commands to additional platforms, Git layouts and terminal capabilities without weakening supervision, scope or recovery.
- [ ] Evaluate scoped cross-project dependency/cache reuse; preserve agent/Closed isolation and credential boundaries. Within-run HOME/cache continuity is already implemented.
- [ ] Add useful domain/proxy/network controls beyond authorized downloads and confined local previews. Downloads, serving, web search and remote publication retain separate permissions.
- [ ] Evaluate hosted web search/provider tools with model/account checks, visible activity, clickable sources and portable fallback for local/incompatible providers. Verify API-key and ChatGPT-plan availability separately; no silent separately billed fallback. Granite currently exposes its own function tools, not hosted search. References: [Responses web search](https://developers.openai.com/api/docs/guides/tools-web-search) and [plan-sharing limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## v0.3 — Efficiency and orchestration

### Large repositories

Basic lexical-search improvements (established search implementation, ignore handling, case/regex options and bounded-result continuation) are now planned for **pass 4**. This backlog covers further scale/quality work after that baseline; it does not postpone those improvements.

- [ ] Measure and tune lexical search, bounded/batched reads, generated/dependency exclusions, response latency, context use and task success on representative large repositories.
- [ ] Evaluate incremental file/symbol/import maps and stale-index detection. Add semantic retrieval only where it improves results relative to its cost and scoped indexing requirements.

### Model context

Basic scoped text retrieval, source tracking, full definition accounting and context-fit/compaction are **pass 4**, not this backlog.

- [ ] Tune automatic local inclusion versus explicit retrieval, brief remote directories and relevant notes.
- [ ] Measure summary quality, reply/tool reserves and compaction thresholds; preserve the original transcript, task/steering, permissions and source scope.
- [ ] Compare incremental/cached summaries and retrieval-first approaches without fresh whole-section summaries on every edit/deletion.
- [ ] **v0.3 — Revisit the best summary/retrieval method before implementation.** Compare per-chat summaries plus retrieval against multi-level, source-backed topic/project/section digests and query-specific assembly across chats. Retain original messages and per-chat summaries as the foundation. If additional derived layers help, track dependencies and refresh/invalidate only affected items. Measure answer quality/recall, stale facts, latency, model-token cost and deletion-maintenance complexity; more summary layers are not automatically better. [RAPTOR](https://arxiv.org/abs/2401.18059) is one research example, not an adopted engine. The user explicitly deferred method selection for later planning; see [[Granite Vision & Roadmap]].
- [ ] Evaluate provider caching/stateful continuation and smaller configured local-model windows while honoring freshness and deletion.

### Optional-tool discovery

Basic permission-filtered core plus portable lookup ships in **pass 5**.

- [ ] Tune ranking, schema caching/eviction and provider-native discovery for large catalogs. Measure schema tokens, remaining headroom, malformed arguments, wrong choices, latency and task success; no fixed advertised-context cutoff.

### Command execution and change tracking

- [ ] Reduce full manifests/copy costs with incremental scans, safe dependency reuse and verified reconciliation; retain confinement and revision checks.
- [ ] Improve incremental change reporting, bounded diff storage and generated/dependency grouping without losing truthful outcomes or pre-existing user edits.

### Mixed-model subagents

- [ ] Design parent-directed delegation across model/provider/local connections, scoped task/context handoff, result inspection, failure/cancellation and capacity.
- [ ] Coordinate actual workspaces/writers explicitly; a parent-child relationship neither prevents same-file collisions nor expands permissions. Separate user-selectable agents are not delegated subagents.

## Unassigned — do not silently add to a release

- [ ] Evaluate automatic file restoration versus explicit Undo after Stop/crash. Preserve pre-existing/concurrent edits, use durable operation-specific records and guarded restoration, handle creations/deletions/renames/commands, retain conflicts and verify actual results. Do not promise reversal of Git history, downloads or external effects. Current Stop/crash/chat deletion **keep completed edits**; no rollback journal is a v0.1 requirement.
- [ ] Evaluate provider-reported account allowance windows, preferably using the existing sign-in. The prior investigation found no compatible reader for the current plan-sharing connection; do not require another login solely for meters. Existing request/token counts are not subscription allowance. [Investigation](../research/chatgpt-usage-meter.md).
- [ ] Evaluate optional Codex app-server adoption as a separate architecture choice, preserving Granite's data/tool scopes and provider portability. Direct Responses access does not supply that runtime. Hosted search does not require replacing Granite's loop. [App-server reference](https://learn.chatgpt.com/docs/app-server).
- [ ] Consider existing-session migration across models/providers and autonomous skill authoring/configuration separately. Current sessions remain bound; pass-5 requested skill import is not autonomous authoring.

Interactive commands, safe package links, normal dependency/framework setup, questions and managed previews are already implemented in pass 3A. Their remaining compatibility testing belongs in [[Tests to Run Later]], not a future-feature checklist.
