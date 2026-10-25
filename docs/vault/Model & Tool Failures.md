# Model & Tool Failures

> Agreed October 24, 2026, as D-057 from P-015. This is a target specification, not implemented functionality. Ordinary model-connection failure, stale-edit recovery, user Stop and unexpected-closure recovery follow D-067: keep completed edits and defer automatic restoration.

Start visually: [[Run Lifecycle - Tool Failures.canvas]]

Related: [[Run Lifecycle Design]] · [[Unexpected Closure Recovery]] · [[Restarted Queues & Timers]] · [[Tool Permissions]] · [[Remaining Harness Decisions]] · [[Decisions & Questions]]

## Reply/tool validation failures

| Situation | Agreed behavior |
| --- | --- |
| Completed response has neither a visible answer nor usable structured tool calls | Show a harness error such as **The model returned no answer**, preserve the actual received record and offer Continue. Do not mark the task complete or add an automatic retry beyond D-046's already-defined transient connection retry. |
| Response is truncated or its structured tool-call data is incomplete | Show that the reply is incomplete. Do not execute incomplete calls. Preserve valid partial output as interrupted activity and offer Continue under the existing new-run semantics. A real provider/context/output limit is reported as such. |
| A complete, identifiable tool proposal has invalid JSON arguments, an unknown/unavailable name or a schema error | Reject it before execution, return a matching tool error stating that this action did not run, and let the model submit one corrected proposal. Never guess missing arguments, paths or tool intent. If it is invalid again, report incomplete work rather than repeatedly attempting the same broken operation. |
| The response envelope/call identifiers are unusable or ambiguous | Do not fabricate IDs or execute calls. Report an invalid model response and offer Continue with reconstructed valid context; keep malformed fragments out of native call/result history. |
| A valid call is denied by scope, missing authorization or the user's denial | Return the denial and continue only with permitted work. The technical-correction allowance does not authorize retrying a denied action through another tool or expanding scope. |

Validate the complete response/call structure before executing actions, then perform scope/approval checks again immediately before each tool's actual execution. When a bad proposal requires model correction, hold the remaining unstarted proposals from that response and account for them as not executed using valid provider bookkeeping. Previously completed actions are never repeated merely to produce a missing result.

The single correction is a local failure-recovery rule, like D-042's corrected edit attempt; it is not a whole-run step/tool budget. There are still no whole-run budgets in the first iteration. Supporting reads may help repair the proposal without being counted as another execution of that action. A returned tool error is not itself proof that the entire user task is impossible; report the actual partial outcome and retain permitted alternatives.

## Tools whose outcome may be uncertain

Distinguish **known success**, **known no effect**, **known partial effect** and **unknown effect**. A connection timeout, cancellation or missing tool response alone does not establish which one occurred.

1. Stop starting actions that would compound the uncertain operation. If repository writes may be affected, hold that repository's editing ownership and block further writes; independent unaffected chats can continue.
2. Inspect the durable operation/outcome record, actual files and any available read-only service status/receipt. Use tools under the existing access rules. Do not ask the model to guess whether the operation happened or treat missing confirmation as proof it did not.
3. If success is verified, record and return the actual result without replaying the action. If no effect is verified, return a known no-change failure; any corrected proposal remains subject to the ordinary permission and failure rules. Record verified partial effects honestly.
4. If the result remains unknown or unsafe to reconcile, show **Action outcome unknown — needs attention**, retain the recovery information and end normal automatic work on that affected branch. Do not report success, automatically repeat the action or silently undo unrelated completed edits. Any affected repository remains blocked until recovery resolves the condition or the user makes the existing explicit decision about the remaining state.

Example: an approved deployment request loses its response. Check an available deployment receipt/status first. If Granite cannot verify the result, tell the user it may have happened; do not send another deployment merely because the response was lost. A follow-up that might duplicate an external action needs clear user direction, and the existing scope/authorization rules still apply.

D-067 makes Stop, unexpected closure and ordinary model/tool failures all preserve completed file edits. Cancel/settle work, show the actual remaining diff and interruption state, and reconcile genuine unknown outcomes. Automatic file restoration is deferred; no cancellation guarantees reversal of an external effect.

## Continue and recovery records

- Continue starts a new run with fresh permissions/context and a new execution/change record under D-046/D-067. Include the original task/steering, actual completed or reverted outcomes, and unresolved-action markers. Never replay tools simply because they appear in old history.
- A repository whose write effects remain unresolved is not released for editing by pressing Continue. Resolve that recovery condition first; a fresh model request is not evidence that its files are safe.
- Keep necessary operation/reconciliation data while an action, process, deletion or uncertainty still needs it. Do not discard the only unresolved outcome record to finish deleting a chat. Full before-file snapshots solely for automatic restoration are not required.
- Once effects are known and the final outcome is saved, release unneeded reconciliation data. Keep ordinary messages, tool outcomes, diffs and the interruption/error summary under normal retention. Completed edits are retained; their presence alone does not imply unresolved recovery.
- Defer both automatic Stop/crash file restoration and a dedicated **Undo an earlier finished/failed run** interface. Preserve necessary outcome records, but do not build a full rollback journal solely for the deferred feature. See [[Deferred File Restoration]].
- No model call is needed merely to display an error, cancel/settle work or release resolved reconciliation data.

## Observable acceptance cases

1. The model completes with an empty answer. Granite shows a failed/incomplete state and Continue, not a success checkmark or an endless automatic regeneration loop.
2. The model proposes a malformed edit. Nothing changes; a structured error reaches the model, which can correct it once. A repeated invalid proposal reports partial work without undoing earlier successful edits.
3. A file edit succeeds but confirmation is lost. Reconciliation verifies the file/operation record and records success without applying the replacement twice.
4. An external write times out and no status is available. Granite reports uncertainty and does not repeat the action automatically.
5. A write/action outcome remains genuinely unknown. Closing/reopening or deleting the chat cannot erase its only recovery record; affected repository editing remains blocked.

These agreed defaults finish R-03's behavior choices. Durable storage/transaction details, exact diagnostics and connector-specific reconciliation mechanisms remain implementation work. Container/settings review is also complete; D-067 revises restoration requirements across those flows.
