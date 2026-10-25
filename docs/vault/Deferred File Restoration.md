# Deferred File Restoration

> Deferred by the user on October 25, 2026 (D-067). This records the earlier design for future evaluation. Automatic file restoration, durable undo snapshots and rollback conflicts are not first-version requirements. Stop, chat deletion and unexpected closure preserve completed edits in version one.

Start visually: [[Deferred File Restoration.canvas]]

Related: [[Things to Optimize]] · [[Run Lifecycle Design]] · [[Unexpected Closure Recovery]] · [[Decisions & Questions]]

## Future evaluation scope

Revisit guarded restoration of only the interrupted run’s repository edits, preservation of pre-existing/concurrent changes, command-generated edits, duplicate project links, durable recovery and cleanup. Do not promise undo of Git history, installations or remote effects. Decide whether automatic Stop restoration or an explicit undo interface is preferable after the basic lifecycle is working.

The text below preserves the earlier proposal as design material. Its historical accepted/initial wording does not put it back into the first implementation.

### Stop and coding rollback

**User direction:** ordinary text work stops normally; for a coding run, aim to return the codebase to its pre-run state when Stop is requested. This differs from the current documented behavior, which preserves completed changes.

**Accepted initial design:** cancel work, settle writers, then restore tracked repository edits using a local undo record, with conflict protection and verified outcomes. The user accepts the conservative concurrent-edit behavior as a safe starting point while reserving judgment until real experience. It can be revised later; no extra edge-case complexity is required now. This is a planning baseline, not an implemented or fully scoped guarantee for every tool.

#### Stop flow — accepted initial design

| Stage | Harness behavior | User-visible behavior |
| --- | --- | --- |
| 1. Accept Stop | Persist that the run is stopping. Block new model requests, tool actions and pending approvals for that run. Stop does not require an extra confirmation. | Show **Stopping** promptly. |
| 2. Cancel active work | Cancel the current generation and harness-owned tools where possible. Reject late calls and output from the cancelled generation. Cancellation of generation is not proof that an already-running write has stopped. | Streaming ends; stopping remains visible while tools settle. |
| 3. Settle writers | Wait for active writes to finish or cancel safely, and determine their actual outcomes. Keep the repository editing queue blocked while writers or restoration are active. If writers cannot be stopped/observed reliably, report that state and do not restore into an actively changing tree. | Do not show the run as fully stopped while its tools may still modify files. |
| 4. Restore this run's tracked changes | For tracked repository edits, restore the saved state only where it can be done without overwriting another writer's changes. Text/read-only runs have no repository edits to undo. | Show **Restoring changes** when restoration is needed. |
| 5. Verify and finish | Verify restored contents, update the displayed changes and save the stopped outcome. Retain the conversation and tool history, marking reverted edits as reverted. | Show **Stopped — changes restored**, or **Stopped — restoration needs attention** with the remaining changes/conflicts. Never label an uncertain restore as successful. |

#### Local undo record — initial design

Use a per-run checkpoint/write journal maintained by the harness, without asking the model to generate an undo patch. Keep it outside the model-editable repository content, scoped to the same agent/project, with no access through unrelated chats.

- Preserve pre-existing uncommitted and untracked user work. Restoring the last Git commit or resetting the entire working tree is not the requested undo behavior.
- For each managed file edit, durably record its before state, whether the path existed, relevant file metadata and the actual written state/revision. Validate the source revision and record the undo information before mutation; reconcile the actual outcome afterward. Record creation, deletion and both sides of a rename, not just text replacements.
- Reverse this run's operations using those records, checking the current state before each restore. If the user has not edited the touched files meanwhile, this returns them to their pre-run state. If the user changed a file before the agent's first write, preserve that intervening user version as well rather than forcing an older run-start copy over it. The UI's run-start comparison baseline and the undo record serve related but distinct purposes.
- If a file changed after the agent's recorded write, preserve the current file and flag it for recovery instead of blindly replacing it. For the first version, do not attempt an automatic merge of concurrent user and agent edits. This is a conservative starting default that the user may revisit after experience, rather than a firmly held preference about that edge case. Use a guarded restore; a simple check followed by an unprotected overwrite would still allow a race. Exact filesystem enforcement is implementation work.
- A file created by the run can be removed on undo only when it still matches the recorded created version. A deleted file can be restored only when its path has not been reused. Renames and metadata need the equivalent conflict checks.
- Keep the undo data until the stopped outcome is verified or unresolved recovery is handled. If restoration is incomplete, persist that fact and block new repository editing until the conflict is resolved or the user explicitly keeps the remaining state. Read-only inspection can continue. Unexpected closure follows D-055 / [[Unexpected Closure Recovery]]; durable record/reconciliation mechanics remain implementation work.

**Scope for this first branch:** tracked file edits through the harness. Arbitrary terminal commands can change files outside a managed edit operation, and network/external-service effects cannot be assumed reversible. Command execution needs its own tracking/checkpoint or isolation design before Stop can promise to undo those effects. Permission to edit repository files remains unchanged; this is the boundary of the initial rollback guarantee, not a new per-edit approval rule.

Keep the distinctions clear: failed-edit recovery and ordinary model-request failures preserve earlier successful edits; explicit user Stop requests rollback of tracked changes; an internal generation restart for steering is not whole-run Stop and does not automatically restore files. D-049 applies Stop restoration before active coding-chat deletion. D-055 treats unexpected application closure as Stop, with recovery on reopening. Other unknown/fatal tool effects retain their separate recovery boundary.

Visual design: [[Run Lifecycle - Stop & Rollback.canvas]].

