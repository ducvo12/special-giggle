# Unexpected Closure Recovery

> D-055 revised by D-067, October 25, 2026. Unexpected closure is equivalent to Stop for interrupted runs. Version one preserves completed edits; automatic file restoration is deferred. This is a target specification, not an implementation claim.

Start visually: [[Run Lifecycle - Unexpected Closure.canvas]]

Related: [[Run Lifecycle Design]] · [[Run Lifecycle - Stop & Rollback.canvas]] · [[Restarted Queues & Timers]] · [[Model & Tool Failures]] · [[Things to Optimize]] · [[Decisions & Questions]]

## First-version behavior

1. Detect durable unfinished runs on startup and mark them interrupted/stopped. Completed earlier runs remain completed.
2. Invalidate old approvals, generation callbacks and scheduler entries. Do not automatically resume interrupted runs or replay their tools.
3. Cancel/settle surviving harness-owned processes and reconcile actual file/action outcomes. A closed app does not prove all child processes ended.
4. Preserve code as it exists, including completed and known partial edits. Do not restore original files, apply inverse patches or reset Git. Durable before-file snapshots solely for automatic undo are not required.
5. Save the actual stopped outcome and available change/error information. Release affected scheduling when writers/outcomes are settled. Block affected writes only for genuine remaining uncertainty, not merely because a run left edits behind.
6. Show an unexpected-closure error popup explaining that interrupted work stopped and existing changes were kept. The user may review changes and start new work.

## Popup meanings

| Situation | Message meaning |
| --- | --- |
| Interrupted work detected | **Granite closed unexpectedly. Interrupted work has been stopped. Existing file changes were kept.** |
| Owned processes still settling | **Stopping remaining work and checking its outcome…** |
| Known outcome, processes settled | **The run is stopped. Review its changes before continuing.** |
| An action/process outcome is unknown | **Some action outcomes could not be verified. Review the affected work before continuing.** |

Do not show restoration progress or claim original files were restored. Dismissing the popup neither restarts work nor resolves an unknown action. Retain necessary operation/status records while uncertainty remains; the first version does not need a rollback journal or automatic conflict-restoration workflow.

## Queues, deletion and temporary timers

D-056 remains: preserve never-started pending messages but require explicit restart with fresh validation/positions. Previously held temporary timers get a fresh idle hour after settlement; existing idle deadlines continue offline. Save recovered transitions so another restart cannot recreate jobs or repeatedly reset expiry.

Resume an already-requested deletion only after writers and genuinely uncertain effects settle. Keep repository edits while removing chat data. Container deletion still removes its physically owned folder tree under D-059, without following external attachments to delete their targets. Do not retain a deleted chat just to wait for a deferred undo operation.

## Acceptance cases

- A run edits code and Granite crashes. On reopening, show the popup, stop/reconcile interrupted work and keep those file edits.
- A user changes a file after the crash. Granite leaves that content in place; no restoration overwrites it.
- An owned command may still be running. Settle it before releasing affected scheduling.
- A completed action lost its response. Verify its outcome without automatically repeating it; unknown outcomes remain needs-attention under D-057.
- A second closure during cleanup reconciles the same run/job state without replaying tools or resetting temporary expiry repeatedly.

The earlier guarded restoration design is preserved only as future work in [[Deferred File Restoration]] and [[Deferred File Restoration.canvas]].
