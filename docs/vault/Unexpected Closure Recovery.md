# Unexpected Closure Recovery

> Agreed October 24, 2026, as D-055. This is a target specification, not implemented functionality. Unexpected application closure is equivalent to user Stop for each interrupted active run. On reopening, show an error popup and recover the interrupted run before allowing more edits to its repository.

Start visually: [[Run Lifecycle - Unexpected Closure.canvas]]

Related: [[Run Lifecycle Design]] · [[Run Lifecycle - Stop & Rollback.canvas]] · [[Concurrency & Limits]] · [[Remaining Harness Decisions]] · [[Decisions & Questions]]

## User direction

When Granite closes unexpectedly, treat the interrupted run as stopped by the user. If it was working on code, restore that run's changes to the original state under the existing Stop policy. Show a popup with an error message when Granite next opens.

The process cannot be relied on to execute cleanup after it has crashed. Persist the run/undo information before mutation, and perform any unfinished Stop/restoration on the next launch. Do not ask the model to reconstruct an undo patch.

## Recovery behavior

1. **Detect interrupted work on startup.** Use durable run/operation state to find unfinished runs, including approval waits and incomplete Stop/restoration. A run whose completed outcome was already committed is not interrupted merely because Granite later crashed; do not undo completed earlier work.
2. **Fence old work and hold affected repository queues.** Invalidate pending approvals and old generation/tool callbacks. Do not automatically resume the interrupted run or replay its actions. Prevent new editing in the affected repository until its recovery outcome is known.
3. **Show the unexpected-closure error popup.** Report that interrupted work was stopped, with recovery progress when restoration is still running. Several interrupted chats can be summarized in one popup with per-chat details rather than a cascade of popups.
4. **Settle any surviving writers.** Cancel/settle harness-owned processes and reconcile their actual outcomes before restoring files. Application closure does not prove every spawned process has ended. Do not restore into a tree whose writers remain active or uncertain.
5. **Reuse the existing Stop restoration.** For coding runs, restore tracked changes from that interrupted run's durable undo record, preserving pre-existing work and concurrent user edits. Text/read-only runs have no repository changes to restore. Do not reset the codebase to its last Git commit or erase earlier completed runs.
6. **Verify and save the stopped result.** Record which changes were restored, retain the transcript/actual outcomes and mark reverted changes. Release the affected repository for new work only after safe verified recovery. The user may start new work afterward; the interrupted run is not silently continued.

This recovery is already authorized by the user's direction. Do not require another permission prompt for each undo edit. As with Stop, restoration concerns this run's tracked repository changes, not an unlimited reversal of Git history, installed software or remote effects.

## Error popup states

Use the same popup to report progress and the verified result. Wording can be adjusted during implementation while retaining these meanings:

| Situation | Message meaning |
| --- | --- |
| Startup detects an interrupted run | **Granite closed unexpectedly. Interrupted work has been stopped.** |
| Coding recovery in progress | **Restoring changes from the interrupted run…** |
| Restoration verified | **Changes from the interrupted coding run were restored.** |
| Text/read-only interruption | **The run was stopped. No repository changes needed restoration.** |
| Restoration conflicts, missing recovery data or uncertain effects | **Some changes could not be restored. Review the affected files before continuing.** |

Never show a successful-restoration message before verification. If recovery cannot safely restore a file, preserve the current content and recovery record, identify the affected files and keep repository editing blocked. D-043's existing conflict protection still applies; an unexpected closure does not authorize overwriting newer user changes. The popup's dismissal does not itself resolve that recovery condition or authorize keeping an uncertain state.

## Interrupted cleanup

Recovery must tolerate another closure during recovery. Resume/reconcile the same durable Stop/restoration state rather than blindly undoing a file twice. If chat deletion was already committed as an in-progress operation, finish its existing Stop-then-delete path only after restoration is safely resolved under D-049; do not discard the only undo record to finish deletion.

## Remaining R-03 details

The crash outcome and popup are agreed in D-055. Queue persistence/resumption and held temporary timers are agreed in [[Restarted Queues & Timers]] (D-056): preserve pending messages but require explicit restart, with fresh checks/positions and prior-state-aware temporary expiry. Failed-run recovery-data cleanup and malformed/unknown tool-result handling are agreed in [[Model & Tool Failures]] (D-057), completing R-03's behavior review. No queued repository work may bypass recovery.

After recovered Stop, apply the existing timer rules: if no active/queued work remains, a temporary chat starts a fresh one-hour countdown. Where restart handling leaves queue state unresolved, resolve that state before applying expiry; do not infer that an old running flag authorizes restarting the model.

## Observable acceptance cases

- A coding run makes tracked edits, then Granite crashes. On reopening, show the error popup, recover/verify those edits and leave the run stopped. Pre-existing uncommitted work and earlier completed runs remain.
- A text-only run crashes. On reopening, report the interruption and mark it stopped; no repository reset occurs.
- A user changes an agent-touched file after the crash. Recovery preserves that newer content, reports that restoration needs attention and blocks further editing in that repository.
- A run committed completion before the app crashed. Its completed changes remain; it is not treated as an unfinished run.
- Granite closes again during restoration. The next startup reconciles the same recovery record without replaying the original tool actions or applying an undo twice.
