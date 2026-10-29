# Pass 4 Implementation Plan

> Implementation proposal, October 29, 2026. No application implementation or dependency installation has started. This makes the accepted pass-4 scope concrete; named dependency choices below are recommendations, not claims of completed integration. The behavior contract remains [[Harness Implementation Plan]], [[Memory & Context Policy]] and [[Tools & Permissions]].

Related: [[Available Agent Tools.canvas]] · [[Repository & Context Tools]] · [[Start Here]] · [[Tests to Run Later]].

## Outcome

An eligible chat can recall source-backed information from other permitted chats/sections, use current saved memory/notes, search code effectively and continue long work within the configured model window. Closed chats become runnable only after full source/tool/cache isolation is verified. Temporary scope is tested here, but temporary execution, timers/Keep and container cascade deletion remain pass 5.

Keep SQLite as durable conversation/ownership/provenance storage. Editable memory/notes remain files. Search indexes and model summaries are derived, revisioned and replaceable; neither grants access or supplies independent evidence merely by existing. A future vector engine can supplement search without replacing transcripts, scopes or the public context-tool contract.

## 1. Source catalog, scope and fresh state

Implement a focused context layer with stable source IDs, types, agent/section/project/chat ownership, revisions, timestamps and lineage for derived items. Existing chats/messages and files remain canonical; do not replace them with an index or giant memory blob.

Compute eligible sources in backend code from current membership and section mode. Shared conversation access is same-agent permanent Shared content; Closed access is its own section only; identity is separately readable personality. Temporary callers use their parent section's permitted reads and their own temporary history, but are not sources for other chats and make no durable contributions. Repository-file visibility is evaluated separately under the existing repository policy.

Use this scope for listings, text search, source reads, prompt assembly, summary/memory writes and cache reuse. Filter titles/counts/excerpts as well as content. A guessed source ID, old result or generic approval cannot widen access. Revalidate existence/revision/scope on reads and before subsequent model requests/actions. Invalidate affected model continuation when membership, source visibility or deletion changes; do not retain newly injected stale content through private provider state. Existing surviving transcript text still follows D-029's non-cascading deletion rule.

Refresh relevant editable files at request/read boundaries. External/manual changes invalidate stale file excerpts and derived views; managed writes recheck revisions. New context access must go through this layer rather than unfiltered SQLite, agent filesystem, shell or MCP. Do not expose private encrypted reasoning/model state through search. Keep integrations that cannot enforce scope paused until pass 5.

**Ownership:** Granite-specific logic; reuse existing organization, revision, validation, scheduler and persistence utilities. Another harness's defaults do not automatically implement these boundaries.

## 2. Three read-only context tools

| Proposed API | Input / result |
| --- | --- |
| `list_context` | Optional permitted section/project/source-type filters and cursor. Return a bounded directory with IDs, titles, location and brief current metadata; metadata access is scoped. |
| `search_context` | Plain search query plus optional narrowing filters/cursor. Return bounded excerpts, message/source IDs, source kind, location, revision and continuation. Search original messages as well as notes and summaries. |
| `read_context` | A source ID and bounded range/cursor. Recheck access/deletion/revision and return detail plus source references. An expired/deleted/ineligible source is unavailable, never reconstructed from an old search hit. |

Read operations do not update memory, edit repositories or discover tools. `lookup_tools` remains pass 5. Use ordinary typed function calls through Granite's existing registry and loop so hosted/local compatible models share the same feature.

### Complete proposed tool additions and exposure

Seven new built-in names are proposed for review. Names/schemas are not implemented; existing `repo_search` is upgraded rather than duplicated. Every exposed tool carries a concise description and a typed input schema identifying required fields. Granite validates inputs and current access at execution.

| Proposed tool | Purpose | Required inputs; optional inputs |
| --- | --- | --- |
| `list_context` | Browse eligible source metadata. | None required; optional narrowing filters, cursor and limit. |
| `search_context` | Find excerpts in eligible saved content. | `query`; optional filters, cursor and limit. |
| `read_context` | Read a particular eligible source. | `source_id`; optional bounded range/cursor/limit. |
| `update_memory` | Add, correct or remove durable user facts in permitted agent memory. | `expected_revision` and typed `changes`; added/changed facts include supporting `source_ids`. Target agent is supplied by the harness, not an arbitrary model path. Shared permanent callers only. |
| `save_note` | Create/update reusable knowledge in eligible agent or section notes. | `scope`, note path/name, `content`, `expected_revision` (null for new), and `source_ids` for sourced claims. Backend restricts target scopes and paths. |
| `update_chat_summary` | Update the current chat's continuity summary. | `summary`, `through_message_id`, `expected_revision` (null for new) and supporting `source_ids`. Does not update an unrelated chat or build a global summary. |
| `propose_identity_change` | Propose exact personality content for approval. | `content`, `expected_revision`, `reason`; backend binds the agent/action and approval. Shared permanent callers only; next-run activation. |

Memory updates and note writes keep their appropriate author/source types: a direct current user assertion is different from a model echo or derived cache. New APIs must not silently grant access unavailable to existing tools. Temporary callers have no durable write schemas; same-chat compaction is internal ephemeral state. Closed callers omit agent-wide memory/identity mutations and receive only their permitted section-note and own-summary capabilities. Temporary execution still awaits pass 5.

**Pass 4:** provide full definitions for eligible native core tools on every model request, including these additions. Repository membership/settings remove ineligible tools; the registry is not every installed capability. Count all serialized schemas in context budgeting. There is no discovery round trip before an ordinary file/context read. Current eligible MCP exposure retains its existing gating; do not claim optional discovery exists yet.

**Pass 5:** add portable `lookup_tools(query)` for eligible optional integrations. Keep the native core direct, expose selected optional schemas on subsequent requests and revalidate at execution. Tool lookup finds capabilities; context search finds saved information. Basic compaction, index maintenance, source cleanup and section-view assembly are harness operations, not additional public tools.


Add navigable source references to the interface: open the original saved chat/message or permitted note. Show an unavailable reference when the source is gone; do not fabricate a source or expose a newly restricted title. Older surviving saved messages are not rewritten just to remove their historical references.

**Reuse:** SQLite FTS5 for indexed term/phrase search, relevance and excerpts, after verifying it is enabled in the shipped SQLite. Keep indexed documents tied to their source/revision; backfill existing eligible history and maintain indexes on updates/deletion. Scope before producing/ranking/paginating eligible results; avoid global statistics/counts or cached snippets exposing restricted sources. Start with straightforward text relevance/local preference, not embeddings or a custom ranking research project. Granite implements schemas, scoped queries and source presentation. [FTS5 documentation](https://www.sqlite.org/fts5.html).

## 3. Automatic context assembly

Before each request, produce a structured view containing: enforced policy/current capabilities, personality, current task/steering and recent valid chat/tool history, useful local project/section continuity, eligible user-memory content, and a bounded directory of other relevant permitted topics/sources. Load detailed notes/transcripts through retrieval when needed. Never insert all chats, full notes or repository contents simply because they are readable.

Keep fetched excerpts as source-tagged data, with provenance and freshness. Retrieved text cannot become direct user authority. Drop stale/irrelevant optional excerpts before compacting important task history. Preserve the original request and subsequent corrections together. Personality is fixed for the run; current memory/notes and permissions refresh between requests.

**Ownership:** a small Granite context assembler using existing model adapters. No replacement agent loop or external memory framework is required.

## 4. Memory, notes and incremental summaries

Provide structured, validated update operations carrying target scope, expected revision and supporting source IDs. The seven-name proposal above separates read-only context operations from memory/note/summary/identity updates; it remains a schema proposal until implemented. Route all model-side memory/notes edits through the same revision/provenance service, including existing workspace writes where applicable; a generic write must not bypass scope or erase source tracking.

- User memory holds confirmed durable user facts/preferences; knowledge notes hold reusable evidenced material; chat/project/section summaries hold goals, decisions, constraints, actual outcomes and unfinished work.
- Store each chat continuity summary as chat-owned SQLite data with its source boundary/revision and index lifecycle. Compose the initial project/section view from selected eligible child-chat summaries, metadata and scoped notes. Do not introduce a separately maintained, monolithic combined section summary in this first implementation. Existing same-chat compaction summaries remain separately typed from cross-chat continuity summaries. Keep full transcripts canonical.
- Ordinary scoped updates are automatic under existing permission rules. Closed writes stay in their section; temporary runs cannot update durable memory, notes or shared summaries.
- Reuse useful update proposals from the normal tool loop. Maintain small deltas after materially changed completed work; skip maintenance for greetings/repetition. Do not add a separate extraction model request after every message.
- Mark outdated derived state dirty and keep it out of new context until refreshed. If a missing summary is actually needed, regenerate only that affected item through bounded same-model work. A whole section does not need a fresh summary because one chat changed.
- Serialize writes per resource, compare the current revision before publishing and preserve manual edits. Current manual/agent file content has equal standing. Retain source lineage independently of rendering/editable-file layout, and define/test reconciliation of manual edits before relying on automatic cleanup.
- Summaries retain source IDs and actual status. Interrupted/partial work cannot become a completed task merely because a summary says so. Keep original transcripts searchable when detail was omitted.

**Ownership:** Granite's source/update policy, existing file/diff/revision utilities and the connected model for language judgments. A generic memory package has not been selected; do not import one unless it reduces work while preserving editable files, scopes, provenance and deletion.

## 5. Deleted-source cleanup

Connect existing chat deletion and source changes to invalidation of catalog entries, FTS rows, dependent summaries and injected/cached context. Remove source support from generated memory items; retain items supported by surviving eligible sources. Preserve surviving chat text even when it quotes/discusses the removed source; a pointer alone cannot reopen the source, and generated echoes do not count as independent confirmation.

A deleted sole source makes its unsupported managed item unavailable immediately. Use deterministic reference cleanup when possible; mark a complex derived conclusion unavailable pending targeted revalidation instead of rebuilding every summary. Reconcile any concurrent/manual file edit using revisions and provenance; never delete an arbitrary line based only on fuzzy text matching. Directly authored saved content must be distinguished from generated caches; exact file/metadata reconciliation is an implementation checkpoint with tests, not an assumption that every line is safe to remove.

Full project/section cascade controls and temporary expiry stay in pass 5, using the source-cleanup service established here. Source invalidation is logical application behavior, not a new promise of forensic erasure or deleting independent copies in other chats.

**Ownership:** Granite-specific provenance and invalidation; reuse SQLite transactions and established file publication/revision checks.

## 6. Model-aware budgets and compaction

Use the selected model's effective configured window/output allowance, using reliable metadata when available and an explicit conservative configured limit otherwise. Reuse a maintained compatible tokenizer where available; do not invent tokenization or assume one model's tokenizer exactly counts another. The exact tokenizer package/model assets remain to select and verify for Electron packaging. Mark fallback estimates honestly, allow safety margin and calibrate against reported usage; protocol/hidden reasoning overhead is not always exactly observable.

Budget serialized tool schemas, policy/personality, history, retrieved material and results. Initial accepted defaults: reserve at least 25% of the window for output/tool headroom (or more for its configured output allowance), compact near 80% of the remaining input budget and target roughly 60% afterward. These are tunable defaults, not fixed model limits or whole-run caps.

First shrink optional directories/excerpts and obsolete bulky results. Then summarize an older safe span while keeping recent exchanges, original task/steering constraints, relevant source IDs and known/unresolved tool outcomes. Preserve valid call/result boundaries; retain the full stored transcript. Persist the compacted view with source/revision information and rebuild compatible provider state rather than replaying invalid encrypted/call fragments. Stop/steering must cancel or invalidate obsolete summary work; commit a compaction only if its input boundary/revisions are still valid. If it fails, preserve original data; if required input cannot fit, report it rather than repeatedly retrying or silently dropping the task/policy.

**Reuse candidate:** Pi documents and implements retained recent messages, recorded summary boundaries and call/result-safe cut points. Reuse its approach and adapt isolated routines/tests if their dependencies fit; its complete session/branch/runtime subsystem is not a drop-in module for Granite. Pi's fixed token defaults, recovery behavior and session/provider types must not override Granite's accepted rules. Source/license audit is required before copying; preserve upstream attribution and pin any adapted source. Using a mature upstream pattern is not evidence that our integration already works. [Pi compaction guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/compaction.md), [implementation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/compaction/compaction.ts), [MIT license](https://github.com/earendil-works/pi/blob/main/LICENSE).

## 7. Better ordinary repository search

Recommend a pinned, packaged ripgrep binary as the lexical engine, with required licenses/assets for supported builds. Do not require the user to have `rg` installed or silently fall back to the old scanner as an equivalent implementation. Verify binary provenance, Electron packaging and process cancellation before adoption.

Keep the `repo_search` capability with explicit filename/text mode, literal/regex and case options, scoped path/glob filters, bounded surrounding excerpts and continuation/narrowing. Respect repository ignore rules and sensible dependency/generated exclusions; allow explicit inclusion without exposing protected paths, Git metadata or links outside the repository. Explain the default treatment of hidden configuration files; callers must be able to request eligible dotfiles deliberately.

Use controlled argument arrays and parsed machine-readable output, not model-supplied shell text/flags. Do not inherit user ripgrep config, global ignore/credential paths, preprocessors or executable helpers. Restrict actual reads to the permitted tree, recheck returned paths and retain the existing protected-storage/link guards. `include ignored` never widens resource permission. Do not run a general writable repository command just to search a readable outside project, and do not copy the entire repository for each read-only query.

Stream/cap results, stop cancelled searches, distinguish invalid regex from no matches, and expose honest truncation/continuation. A repository changed between pages is not a stable snapshot; report/revalidate as needed. Native editing still requires a fresh read/revision. This pass adds no semantic search, symbol/reference engine, LSP or vector index.

**Reuse:** ripgrep provides the search, regex/case and ignore mechanics; Granite supplies resource selection, confinement, output bounds, schema and UI. Its own guide documents those mechanics. [ripgrep guide](https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md).

## 8. Identity approvals and necessary interface work

A permanent Shared chat may propose an exact identity change through a dedicated approved action; Closed/temporary callers cannot bypass that restriction by asking. Reuse the current approval transport/dialog, show old/new content, bind the pending action to its run/revision/diff and apply once. Denial, steering, Stop, deletion, stale revision and late duplicate decisions retain the existing lifecycle rules. Save now, activate next run.

Add only the interface needed for sources, inspectable memory support, relevant context/compaction status and effective context-window configuration when metadata is unavailable. This is not a broad app redesign. Existing human file editing and ordinary code-edit permission remain intact.

**Ownership:** existing approvals, diff/revision services and bridge; Granite-specific scope/activation rules.

## Delivery order and meaningful verification

These are implementation checkpoints inside pass 4, not new version/pass commitments:

1. **Storage and scope:** source/revision schema, backfill, FTS support, migrations and one authoritative access layer. Verify reopen/backfill idempotence and no agent/Closed/temporary metadata leaks.
2. **Read tools and sources:** list/search/read, current file synchronization and clickable references. Find original-message facts absent from summaries; reject guessed/stale/deleted IDs; test pages and updates.
3. **Memory and cleanup:** typed scoped deltas, summary freshness, manual-file reconciliation and support tracking. Five source chats minus one preserves the fact; sole-source removal invalidates it; caches/echoes do not create support; concurrent edits are not overwritten.
4. **Assembly and compaction:** correct effective windows, schema overhead, safe retained spans and provider-state reconstruction. Use deliberately small windows, large results, steering/Stop during maintenance and injected deleted/restricted sources. Keep full history and valid call/result pairs; report mandatory-input failure honestly. Enable Closed runs only after tool/file/cache bypass tests pass.
5. **Repository search:** package the established engine and wire controlled search. Exercise literal/regex/case, filenames, dotfiles, ignores/explicit inclusion, invalid patterns, cancellation, truncation/pages, protected/link paths and outside read-only access. Record representative timings without a performance-parity claim.
6. **Identity and end-to-end:** exact approval/denial/staleness and next-run personality; walk through a source-backed cross-chat answer and a Closed-isolation case in a disposable desktop profile. Run type/build checks and relevant integration tests; record live hosted/local model availability/results separately from mock plumbing.

Source support/file reconciliation, tokenizer packaging and the suitability of extractable Pi routines must be resolved during the relevant checkpoint, before claiming that feature complete. No change is authorized to the already-settled sharing/deletion/Stop behavior merely to accommodate a library. Existing unfinished verification remains [[Tests to Run Later]].

## Later features and reuse policy

| Future capability | Recommended reuse | Granite still owns |
| --- | --- | --- |
| v0.3 semantic/hybrid retrieval | Established embedding model/runtime and vector index selected through corpus/latency/resource benchmarks; preserve text search | Scope, freshness, source IDs, deletion and query/result policy |
| v0.3 code maps/navigation | Existing parsers such as Tree-sitter; evaluate LSP for true language-specific references | Allowed repository selection, model-facing queries and stale-index handling |
| v0.2 worktrees | Git worktree/merge mechanics and suitable existing wrappers | Workspace membership, grants, scheduling, UI, retained history and conflict/recovery policy |
| v0.3 subagents | Evaluate established delegation/scheduling components and harness patterns | Parent/worker context/permissions, provider connections, cancellation, workspace ownership and results |

Tree-sitter supplies incremental syntax trees, not a complete cross-file type/reference engine; semantic navigation can require a language server. [Tree-sitter documentation](https://tree-sitter.github.io/tree-sitter/).

Prefer maintained components with narrow interfaces. Adapt small upstream harness algorithms where they fit, documenting source/license/version and preserving relevant tests. Importing an entire harness for one feature is justified only if it reduces total maintenance and preserves Granite's accepted behavior. No single upstream choice has been proven to solve Granite's complete memory/context policy; measure integrated behavior rather than describing borrowed code as automatically safe or correct.
