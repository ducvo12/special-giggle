# Pass 4 implementation checkpoint

> Historical pause checkpoint. Work subsequently resumed; current evidence is [[Pass 4 Implementation & Testing]].

Stopped at the user's request on October 29, 2026 because usage was nearly exhausted. **Pass 4 is in progress, not accepted or ready to commit.** Changes remain uncommitted on top of `9388ab2`. Resume from this working tree; do not restart implementation.

## Implemented so far

- `src/backend/context/`: SQLite FTS5 source catalog/backfill/triggers, scoped list/search/read, revisioned source ledger, file synchronization, managed memory/notes provenance and cleanup, chat summaries and token budgeting.
- Seven native context/memory/identity tools with typed schemas and backend scope checks. Existing Shared workspace note edits route through the context layer. Closed chats omit global file/terminal and agent-memory/identity write tools; temporary execution remains gated.
- Automatic bounded context orientation, local continuity/notes, memory and retrieval directory; source invalidation rebuilds native provider input. Native recent action batches retain complete call/result pairs.
- Internal model compaction with preserved transcript and current run directions; tokenizer/estimate labeling and context-window overrides. Summary proposals now stage until successful run completion.
- Packaged `@vscode/ripgrep@1.18.0` (binary reports ripgrep 15.0.0), ignore/case/regex/pagination/cancellation controls, read-only macOS sandbox. No repository staging copy for searches. Binary externalization/unpack configuration added.
- Source reader/memory support UI, context status, exact identity approval and next-run personality activation.
- Provider-advertised context limits carried into runtime; API catalog metadata cached when loaded by the picker.

## Verification completed

- Type checking passed on the latest edits.
- Build passed before the last small source-ledger/provenance edits; rebuild again before desktop retry.
- Full regression suite: **157/157 passed** before the latest summary-staging, metadata, provenance and cursor refinements. Rerun the full suite on the final tree.
- New context retrieval suite: **5/5 passed**, covering scope/metadata isolation, independent evidence and manual edits, stale summary/source invalidation, schema budgeting/tool pairs and packaged ripgrep controls.
- New context runtime suite: **4/4 passed**, covering actual cross-chat/Closed run plumbing, identity approval/denial/staleness, internal compaction and staged summary publication.
- Existing runtime/deletion/organization/native-provider checks were exercised while fixing compatibility regressions. Existing tests were adjusted for Closed execution, FTS internal tables and intentional stale native-state eviction.
- `git diff --check` passed.

Logs (temporary local evidence): `/tmp/granite-pass4-all.log`, `/tmp/granite-pass4-context.log`, `/tmp/granite-pass4-search.log`, `/tmp/granite-pass4-runtime.log`, `/tmp/granite-pass4-build.log`, `/tmp/granite-pass4-desktop.log`.

## First actions when resuming

1. Investigate/retry `scripts/verify-context-desktop.mjs`. It successfully reached the source-reader interaction after two Shared chats, then timed out expecting the original message. The script clicks the first `message` source button, which may select a different search hit; inspect the actual selected source before diagnosing an app defect. Its `finally` shuts down the disposable app and fixture server. The later Closed desktop check has **not** run. Do not claim desktop acceptance.
2. Rebuild and rerun all automated tests against the latest tree, including both new suites (now discoverable by `npm test`).
3. Finish compaction race checks: Stop/steering/source deletion during maintenance, both provider protocols, mandatory-input overflow and retained task/tool pairs. Review handling of unusually large single tool results and the target of roughly 60% after compaction; current safety limit rejects inputs over budget, but tuning is not fully validated.
4. Review provenance edge cases (duplicate facts, concurrent writes, legacy generic workspace writes, edited summaries and cached echoes), restart/backfill idempotence and Closed tool/file/cache bypass coverage before declaring isolation complete.
5. Verify packaged-app ripgrep lookup/unpacked assets and licenses. A build alone does not verify an installed package. Read-only repository search currently requires macOS, consistent with this implementation's sandbox restriction; document that limitation accurately.
6. Complete identity next-run/steering/Stop checks and original-source/memory-support UI verification. No live hosted-model or LM Studio verification was performed in this pass yet.
7. Update the tool canvas and focused specifications with final delivered behavior; preserve canvas geometry. Add a final implementation/testing evidence note and update status only after verification. Do not commit until requested.

## Sandbox investigation

The first ripgrep sandbox prevented macOS dyld startup. Automatic review rejected a proposed broad system-directory allowance. The accepted narrower fix permits a **literal root-directory read**, without recursive root access, plus existing runtime libraries and standard random devices. That passed the ripgrep fixture suite. Keep private-app-data, Git, symlink/hardlink and repository guards intact; do not revive the rejected broad allowance.

Related: [[Pass 4 Implementation Plan]] · [[Harness Implementation Plan]] · [[Tests to Run Later]].
