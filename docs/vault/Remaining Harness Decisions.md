# Remaining Harness Decisions

> Behavior review complete at the initial-version level, October 25, 2026. D-059–D-066 settle the final four main groups and both optional proposals; D-067 subsequently defers automatic file restoration. This is planning, not a claim that the functionality is implemented. Exact engineering choices and stated deferrals remain below.

Related: [[Harness Design]] · [[Run Lifecycle Design]] · [[Container & Settings Rules]] · [[Container & Settings.canvas]] · [[Decisions & Questions]] · [[Things to Optimize]]

## Reviewed behavior groups

- [x] **R-01 — Tool permissions and instruction authority.** D-050/D-051 settle execution defaults, MCP capabilities, instruction precedence and the action/recovery boundary (D-067 defers automatic restoration). D-065 now also permits a user-requested existing skill import under the agent’s tools folder, without automatically executing scripts or enabling capabilities. Tool-package selection is an engineering choice within these controls.

- [x] **R-02 — Concurrent work, queues and limits.** D-052/D-053/D-054 settle one active run per chat, sequential tools, host/model capacity queues with reason/position, shared-file conflict checks, no whole-run budgets and held queued-temporary timers. D-062 revises global repository ownership: serialize within a project, allow duplicate folder links across projects with a warning, and defer stronger cross-project coordination. See [[Concurrency & Limits]].

- [x] **R-03 — Restart and uncertain-outcome recovery.** D-055/D-056/D-057 settle Stop-equivalent crash recovery and popup, explicit restart of saved pending messages, state-aware temporary timers, malformed replies, uncertain effects without blind replay, recovery-record cleanup and deferral of a dedicated old-run Undo interface. Durable transactions and connector-specific mechanisms remain engineering work.

- [x] **R-04 — Deleting projects, sections and agents.** D-059 deletes the actual Granite-owned folder tree and all descendant database chats after stopping/settling work. Physically contained code is deleted; external linked targets survive. Remove owned context/index state, preserve surviving chats/fact support and never discard unresolved recovery data. See [[Container & Settings Rules]].

- [x] **R-05 — User-edited memory/notes and source cleanup.** D-060 gives current eligible manual/agent file contents equal standing on every model request, within the accepted access and context bounds. Refresh revisions instead of stale cached copies. D-029 still limits deletion to the chosen source/unsupported managed state; surviving evidence remains. File removal is not permanent suppression across historical chats. Source-reference representation, synchronization and cleanup transactions remain implementation work. Temporary cleanup reuses existing expiry/deletion rules without durable contributions.

- [x] **R-06 — Repository attachment and path recovery.** D-061 warns on unavailable folders and offers relinking, even to different code, after work settles. Retain one current attachment and bound chats; invalidate repository caches, keep old operation records bound to their original resource and give a change notice before fresh inspection. No detach-to-chat-only. D-062 allows duplicate links with a warning; advanced overlap/worktree coordination is deferred. First-attachment failure leaves the project chat-only and must not delete existing user code. Protected app/context storage remains excluded from generic tools.

- [x] **R-07 — Model/settings changes and scope transitions.** D-063 fixes model/provider within the existing chat/model session and defers session migration. D-064 applies changed permissions at subsequent model requests/tool executions without automatically interrupting generation or an already-started action. Closed-to-Shared visibility follows those boundaries with cache refresh; Keep/move locks and next-run personality timing remain. Passive UI activity classification is a small implementation default under the existing explicit-action timer rules.

## Optional proposals now decided

- **P-012 accepted in D-065:** install an identified existing skill package on user request under `agent/tools/skills/<skill-name>/`, preserving instructions/resources. Installation does not itself execute scripts, install dependencies or enable tools. See [[Skills & MCP Policy]].
- **P-016 accepted in D-066:** use a Codex-style compact direct core plus discovery of optional integrations. A portable scoped lookup supports providers without native discovery; optimize routing/caching later. See [[Tool Selection & Context]] · [[Tool Lookup.canvas]].
- **P-017 accepted in D-058:** separate repository read/write exposure and provide native scoped context list/search/read operations with bounded source-linked results. See [[Repository & Context Tools]] · [[Context Retrieval.canvas]].

## Implementation choices and explicit deferrals

Choose database schema, source-reference representation, folder IDs, transactions, migration mechanics, call/result bookkeeping, event names and renderer/backend message shapes during implementation. Build process/outcome recovery, file revision refresh and cache invalidation to deliver the already-chosen outcomes. Apply model/operation/context/output limits without adding whole-run budgets.

Keep passive browsing/selection distinct from explicit chat activity when choosing timer UI defaults; no extra activity log is needed. Exact event classification is not a new broad design review. Unsupported model/tool combinations should report their limitation; do not silently change the fixed session model or pretend unavailable capabilities exist.

Cross-provider session migration, autonomous skill authoring/configuration expansion, subagents, automatic file restoration/undo snapshots (D-067), and the dedicated old-run Undo interface are deferred. Advanced repository maps, cross-project/worktree coordination, semantic retrieval, context packing and provider caching remain in [[Things to Optimize]]. No new memory-method research is required before implementation.

If an engineering choice would materially change sharing, deletion, approvals, Stop/rollback or the fixed-session model rule, bring that behavioral change back for review. Otherwise choose a practical implementation default.

## Next handoff

The requested six-pass breakdown and planned tests are recorded in [[Harness Implementation Plan]]. Pass 1 is implemented with basic verification; further agent/user testing is pending in [[Pass 1 Implementation & Testing]]. Later passes remain planned.

1. Consolidate the accepted notes/canvases into a first-version implementation plan, clearly separating the target from prototype behavior.
2. Define observable acceptance cases for each slice; [[Container & Settings Rules]] already includes examples for the latest decisions.
3. Implement and verify in small slices: text-only run, read tools, edits/change display, Stop with edits retained/process recovery, scoped context/memory, then container/attachment/settings flows.
4. Evaluate deferred optimizations after the basic behavior works.

No further broad harness-behavior discussion is required before preparing this implementation plan. This does not cover a separate full redesign of Granite’s app interface.
