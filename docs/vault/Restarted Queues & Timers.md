# Restarted Queues & Timers

> Agreed October 24, 2026, as D-056 from P-014. D-055 stops interrupted active runs and restores their tracked coding changes on reopening; the choices below cover saved pending messages and temporary-timer transitions. This is a target specification, not implemented functionality.

Visual policy: [[Run Lifecycle - Unexpected Closure.canvas]] (D-056 cards below the D-055 flow).

Related: [[Unexpected Closure Recovery]] · [[Concurrency & Limits]] · [[Run Lifecycle Design]] · [[Remaining Harness Decisions]] · [[Decisions & Questions]]

## Agreed defaults

### Preserve pending messages, require an explicit restart

Persist accepted queued messages in their original order. After an unexpected closure, retain them in the chat but leave their execution stopped; show **Not started — Granite restarted**. They are no longer live scheduler entries. Do not automatically dispatch old queued jobs when the app opens or when the user dismisses the error popup.

Offer **Run pending messages**, or honor an explicit request to continue/retry them. Revalidate current chat existence, section/project membership, retention, model/tools and repository recovery state. Start a new run with freshly assembled permitted context and enter the current queues normally. Queue positions are recalculated; a saved old position is not a reservation after restart. Keep pending messages in order and avoid creating duplicate jobs.

The user may leave these messages unprocessed or cancel the pending request without deleting the transcript. A new unrelated prompt must not silently dispatch an old cancelled job. Earlier unprocessed messages remain clearly marked; an explicit request to run them supplies the restart intent.

Never-started work has no repository edits to undo. A run that had already started and was waiting for its next model slot is an interrupted active run under D-055; its tracked edits use Stop restoration before any restart. Retained messages/tool history must reflect actual interrupted and reverted outcomes, rather than implying reverted edits still exist.

### Previously held temporary timers get a fresh hour

For a temporary chat whose timer was legitimately held by active or queued work at the crash, finish classifying/stopping that work during startup recovery, then give it a fresh **one-hour countdown** when no work remains active or queued. Do not subtract the unknown offline duration from a timer that was held. Do not add a heartbeat/activity log to estimate a crash time.

If the user requeues pending messages, D-054 holds the timer at **1:00:00** again. Actual model/tool/recovery work continues to use the active-work hold. If no job is restarted, the fresh idle countdown can expire normally, including the temporary chat's saved pending messages. The restart popup/status should make the pending work visible rather than pretending it ran.

### Existing countdown deadlines remain real deadlines

Temporary chats that were already idle retain their saved deadline across closure. Time while Granite was closed counts toward that existing deadline. If already due on reopening, perform the existing expiry cleanup; do not revive the chat merely because the app restarted.

The same due-deadline check applies to an approval-only wait, which was counting down rather than held. Invalidate the old approval under D-055; an already-expired temporary chat is cleaned up. If it was still live and an interrupted active run is stopped, apply the normal Stop reset to a fresh hour. A fully idle chat with no interrupted run keeps its original deadline.

Use durable run/queue/timer state to distinguish a real queued job from an obsolete flag. The process must not infer an eternal timer hold from stale state or restart a model merely to make the state look active. This is ordinary scheduler/run recovery, not a separate activity history.

## Agreed startup ordering

1. Inspect durable run/queue/timer state before normal scheduling and retrieval.
2. Preserve accepted pending messages; classify interrupted active work versus never-started jobs. Disable stale callbacks/approvals and automatic dispatch.
3. Complete D-055 recovery for interrupted active work, keeping affected repository editing blocked until verified.
4. Convert surviving never-started jobs to the visible unprocessed/stopped state and apply the timer rules above. Already-expired idle/approval-only chats use their normal cleanup, not a fresh hold.
5. Present the existing unexpected-closure popup with recovery outcome and notice of pending unprocessed messages. Do not start work by dismissing it.
6. On a deliberate restart, revalidate and enqueue a new run with live queue positions. A repository still needing recovery cannot accept new editing.

A second closure during startup recovery must not recreate removed queue entries or repeatedly grant a fresh hour to a chat whose real countdown was already durably established. Persist the recovered transition so the next launch can reconcile it once.

## Observable acceptance cases

- A runs and B waits for the same repository when Granite crashes. On reopening, A is stopped/restored; B's messages remain visible but B does not start automatically. The user can explicitly enqueue B after recovery.
- B was a queued temporary chat with its timer held. Granite reopens several hours later. B survives recovery with a fresh idle hour; explicitly rerunning it holds the timer again.
- C was an idle temporary chat with twenty minutes left when Granite closed. It is reopened two hours later and expires normally; no fresh hour is granted just for opening Granite.
- An approval-only temporary chat's saved deadline expired while the app was closed. Its approval is invalid and the chat is not revived.
- Another crash occurs after B was durably converted to a stopped pending request with a real idle deadline. The next startup preserves that deadline rather than treating the old job as newly queued again.

## Remaining R-03 scope

This decision covers queue/timer restart choices. Malformed/empty model replies, unknown tool/external-action outcomes and recovery-data cleanup are agreed in [[Model & Tool Failures]] (D-057), completing R-03's behavior review. The ordinary model-connection retry policy remains unchanged.
