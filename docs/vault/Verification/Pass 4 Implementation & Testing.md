# Pass 4 — Implementation & Testing

Implemented October 29, 2026. Pass 4's baseline is ready for user verification. This note does not imply exhaustive provider, performance or release acceptance.

## Delivered behavior

- **Scoped retrieval:** SQLite FTS5 indexes original visible messages, titles, Markdown notes, memory and chat-owned summaries. `list_context`, `search_context` and `read_context` return bounded eligible results with stable IDs, revisions and location. Filters cannot widen access. Opaque provider reasoning, raw terminal output and private native state are not indexed.
- **Automatic context:** current policy/personality/task/steering, eligible memory, selected project/section continuity and notes, plus a bounded source directory. Full other-chat transcripts and repository contents remain on demand. Every eligible native schema is supplied each call; optional tool lookup remains Pass 5.
- **Shared/Closed isolation:** Shared chats retrieve same-agent permanent Shared content. Closed chats now run with section-only conversation context and notes; they omit global file/terminal and agent-memory/identity-write tools. Shared repository reads retain their separate availability rule. Temporary sources cannot contribute durable memory; temporary execution/timers/Keep remain gated for Pass 5.
- **Durable memory:** `update_memory` applies revision-guarded typed fact changes with direct user evidence. Duplicate facts merge support. `save_note` creates sourced agent/section knowledge. Independent support survives deleting one source; sole-source removal prunes managed memory spans and removes unchanged generated notes and their indexed titles. Human replacements remain authoritative. Generic note writes also pass through the context layer; generic `edit_file` directs memory changes to `update_memory`. Workspace terminal cannot write memory/notes directly.
- **Continuity:** `update_chat_summary` stages the current chat's summary until successful completion. Later tool mutations discard an earlier staged proposal. New user work or changed supporting sources makes old derived continuity unavailable. There is no independent giant section summary or extraction call after every greeting.
- **Fresh context:** current file revisions and source visibility are checked at request/read/action boundaries, including after approval waits. Invalid retrieved state is evicted and provider input is rebuilt from saved own-chat dialogue and safe recorded outcomes. Obsolete compaction/provider caches are cleared; surviving visible conversations remain intact.
- **Model fit:** provider-advertised limits or agent overrides, a labeled 32,768-token fallback, maintained o200k tokenization for compatible models and a labeled UTF-8 estimate otherwise. Counts include schemas. At least 25% is reserved; compaction begins near 80% of the input budget and targets about 60% where mandatory schemas allow. It preserves current directions, complete native call/result boundaries and full saved transcripts. Required input that cannot fit fails clearly.
- **Repository search:** pinned `@vscode/ripgrep` 1.18.0 supplies ripgrep 15.0.0. Controlled literal/regex/case/glob search respects repository ignores, skips dependency/generated folders by default, supports explicit hidden/ignored scopes and paged excerpts, and rejects stale cursors. Ignore-aware enumeration precedes minimatch filename filtering and checked content reads. Read-only search makes no repository copy and requires the macOS sandbox.
- **Interface:** source buttons open original saved text, memory support can be inspected, context status explains budget/counting/compaction, and Tools & skills supplies window/output overrides. `propose_identity_change` requires approval of the exact content and revision; the existing run retains its personality and the next run loads the replacement.

The context implementation is under `src/backend/context/`; native adapters are under `src/backend/harness/tools/`. Dependency notices are in `docs/third-party/pass4-notices.txt` and included in packaged resources. Pi's safe-boundary approach informed the design; no Pi source implementation was copied.

## Verification

| Check | Result |
| --- | --- |
| TypeScript checking | Passed |
| Full automated regression suite | **169/169 passed** |
| Build and local macOS arm64 package | Passed; local package is unsigned |
| Disposable desktop and packaged-app walkthrough | Passed: cross-chat search/read, exact original-message reader, provider context metadata, Closed reply/tool isolation and read-only repository search through the unpacked binary |
| Source/FTS/recovery checks | Agent/Closed/temporary metadata and content isolation; original facts absent from summaries; deleted IDs; dirty summaries; independent support; duplicate facts; stale concurrent writes; manual edits; idempotent reopen/backfill; private reasoning exclusion |
| Compaction checks | Internal output; saved history retained; complete native pairs; original task plus steering; Stop/steer for Chat Completions and Responses; source deletion during maintenance discards stale work; mandatory overflow preserves history without a provider call |
| Identity checks | Exact preview/approval, denial, stale revision and next-run activation result |
| Search checks | Literal/regex/case, ignores, hidden/explicit ignored paths, bounded pages, stale cursors, invalid regex, link rejection and cancellation |

The desktop fixture uses disposable profiles/repositories and local model servers; it does not touch the user's Granite profile or codebase. The source-reader screenshot was visually inspected. Small fixture search checks complete in fractions of a second; that is plumbing evidence, not a large-repository performance claim.

Repeat with `npm test`, `npm run build`, `npm run package`, and `node scripts/verify-context-desktop.mjs`. To check the local package, set `GRANITE_TEST_APP=release/mac-arm64/Granite.app/Contents/MacOS/Granite` for the desktop runner.

Local logs are `/tmp/granite-pass4-all.log`, `/tmp/granite-pass4-build.log`, `/tmp/granite-pass4-package.log` and `/tmp/granite-pass4-packaged-desktop.log`. The packaged walkthrough records its retained disposable evidence folder in the last log.

## Remaining acceptance and later work

Live hosted models and LM Studio were **not** exercised for this pass. Provider-specific tool following and long-task summary quality still require user/provider verification. These and extended external-edit/crash variants are in [[Tests to Run Later]]. The deterministic suites verify Granite's dispatch and scope behavior, not a model's factual summary quality.

Repository search/commands currently require macOS confinement; other platform packaging/confinement is unverified. Local packaging is not signing/notarization or a release certification. File/SQLite updates use guarded short mutations, not a cross-resource filesystem transaction; extended crash-point checks remain pending.

Embeddings, semantic/hybrid retrieval, richer code maps, large-corpus ranking, more efficient context selection and compaction tuning remain [[Things to Optimize]] / v0.3 evaluation work. Temporary lifecycle, container cascade deletion, optional tool lookup, skill installation and scoped integrations remain Pass 5. No run budgets, subagents or automatic code rollback were added.

Related: [[Pass 4 Implementation Plan]] · [[Harness Implementation Plan]] · [[Memory & Context Policy]] · [[Available Agent Tools.canvas]]. The earlier [[Pass 4 Implementation Checkpoint]] is historical pause evidence.
