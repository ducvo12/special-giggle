# Run Lifecycle Design

> Current v0.1 contract, consolidated October 29, 2026. Passes 2/3/3A implement the core loop, scheduling, repository execution, questions and previews. Full scoped context/identity changes are pass 4; temporary expiry and complete container lifecycle are pass 5. Verification notes record tested coverage, not exhaustive acceptance.

Visuals: [[Run Lifecycle.canvas]] · [[Run Lifecycle - Text Only.canvas]] · [[Run Lifecycle - Repository Edits.canvas]] · [[Run Lifecycle - Steering.canvas]] · [[Run Lifecycle - Queues & Concurrency.canvas]].

## One run and its model requests

A **run** starts from an accepted prompt and ends in completion, Stop, failure or deletion. One run can make many **model requests** and execute many tools. New messages during active work steer the same run.

**Send → validate location/model → acquire resources → assemble permitted context → request model → stream provisionally → validate/execute tools → return outcomes → repeat or finalize → persist/release.**

Save the prompt once. Validate existence, membership, fixed model/provider and current capabilities. A run keeps its ID, location and retention stable; active runs block Keep/moves. History grows with steering and actual outcomes. Refresh eligible memory/notes and tool permissions at subsequent request boundaries; personality changes activate next run. The full context policy is [[Memory & Context Policy]].

Stream visible text provisionally while assembling tool calls separately. Wait for successful response completion before choosing the tool or final-answer branch. Do not execute partial arguments, raw prose or a tool name mentioned in text. Text accompanying tool calls is intermediate activity. A successful no-tool response finalizes the answer; persist its status/native state before releasing run ownership. Empty/incomplete output is not successful completion.

Execute proposed tools sequentially in model order. Validate complete call identifiers/structure before executing a batch, then recheck each action's arguments, access and required approval immediately before execution. Return bounded outcomes with matching call IDs. Never invent success for skipped calls or replay a completed action to repair bookkeeping. [[Tools & Permissions]] owns the authorization policy.

## Repository reads and edits

Read access exposes tools, not every file's contents. Use a small orientation view, filename/text search and relevant range reads; preserve revisions. Batched reads may be added with per-path checks and shared output bounds; richer maps/semantic retrieval are later work.

Permanent owning-project chats have standing local read/write permission. Record original content before the first edit, apply revision-guarded changes and show actual files/diffs/+− counts. Preserve pre-existing work. Outside edit requests require permanent project entry; temporary requests require Keep first, then separately approved entry between runs.

When a stale single-file edit is rejected before mutation, return a no-change error, allow a fresh read and one corrected edit attempt. A supporting read does not consume that attempt. A repeated failure reports incomplete/partial work; earlier successful edits remain. Scope denials cannot be bypassed via another tool. Partial/unknown effects follow reconciliation below.

Commands use a sandboxed disposable repository copy and guarded publication. Stop discards unfinished staged output; already published edits remain. Commands have no fixed elapsed-time or repository-size/count kill limit. Safe contained relative installer links are supported. Related commands share isolated run HOME/cache, not host secrets. Details: [[Repository & Context Tools]].

## Steering

Persist every new user message in arrival order and retain the original task, its remaining constraints, prior conversation and actual completed outcomes. “Green instead” must retain the earlier blue-button request.

| Arrival point | Behavior |
| --- | --- |
| Generating | Hold obsolete unstarted actions, cancel generation where supported and request again with the updated input. Preserve valid intermediate output/history; no partial call execution. |
| Executing a tool | Let the action settle, record its actual outcome, then deliver steering before another action/request. Do not interrupt midway merely to insert text. |
| Waiting for approval or a question | Withdraw the old pending decision; stale answers cannot apply it. Continue with the new direction. |
| Queued | Append to the same pending job without duplicate jobs or improved queue position. |
| Finalizing | If steering was accepted first it must be processed; if completion wins, the message starts a new run. |
| Stopping/settling | Stop takes precedence. Save new input for fresh work after cleanup; it cannot revive the cancelled run. |

The run ID, project reservation and change record remain the same through steering. It is not an automatic undo. Providers without live input mutation use a fresh model request with valid history/call-result pairs.

## Queues and capacity

One active run per chat, including approval/question waits and settlement. Independent chats/agents can run when resources permit. Acquire the repository-project reservation before model capacity; do not occupy a scarce model slot while waiting for a project.

Every run inside a repository project reserves that project for the whole run, including a question that ultimately makes no edits. Retain the reservation through tools, questions/approvals and settlement. FIFO waiting entries show a resource-specific reason and live one-based position, excluding running work. Revalidate location/context when dispatching, rather than using a queue-time snapshot. Eligible never-started queued moves must rebuild scheduling/context.

Different projects may link the same physical folder and run concurrently. Conflict checks still apply; there is no normal global single-editor guarantee. Genuine unresolved outcomes block affected writes through known aliases. Stronger coordination and isolated worktrees are v0.2 in [[Repository Access & Worktree Plan]]; enforced read-only concurrency is later work.

Initial model-request capacity defaults are one for a local endpoint and two for a remote account/connection, shared across agents/chats and respecting configured lower limits. Capacity belongs to a model request and is released during tools/user waits; reacquire it for the next request. Never silently change model/provider to avoid waiting.

Show **Queued for project repository/model — position N** for Granite-managed queues. Report a host's rank only when supplied reliably; otherwise show **Waiting for host capacity — position unavailable**. Quota/auth/context errors are failures, not endless capacity queues. Cancellation preserves unprocessed messages and prevents late scheduler dispatch.

No fixed or optional whole-run time, model-step or total-tool-call budgets. Actual operation/provider failures, context/output bounds, deletion and user Stop still apply.

## Approvals, questions and previews

Exact approvals bind one pending action, run, target/revision and proposed change. Wait without consuming model capacity or running further tools. Approve revalidates and applies once; Deny returns a no-change result. Steering withdraws the request; Stop/deletion/closure invalidates it. A changed revision/proposal needs fresh review. Identity approval in pass 4 is restricted to permanent Shared scope and activates next run. [[Run Lifecycle - Approvals.canvas]] shows that planned branch.

`ask_user` is a separate implemented question state for consequential missing choices. It preserves task/project ownership but releases model capacity. Group necessary questions; reuse known choices/defaults; do not ask for secrets. Answers are bound to the exact pending question and stored in the transcript. Stop/closure invalidates them; steering withdraws them.

Ordinary command sessions and run caches settle at run end. Only a verified ready managed preview has an independent chat/project-owned lifetime after a final reply. It holds neither project nor model capacity while idle, serves a labeled isolated snapshot and needs refresh after later code edits. Unready previews/unfinished sessions cannot be abandoned by declaring success. Agent-chosen local previews need no separate approval, but terminal enablement, scope, assigned-loopback confinement, opt-outs and Stop still apply. Stop, deletion and app closure settle them; reopening does not restart them automatically.

## Failures and Continue

| Failure | Behavior |
| --- | --- |
| Transient connection/server error before any response data | One bounded automatic model-request retry after a short delay, using current input and pending steering. Stop cancels the retry. Never replay tools. |
| Authentication, unsupported settings/model, quota or context/output limit | Explain the actual problem; no silent model change or unchanged retry loop. |
| Stream breaks after text/call data, or the permitted retry fails | Keep valid partial output as interrupted and offer Continue. Execute no incomplete proposal. |
| Completed response has no visible answer or usable calls | Show an incomplete/error outcome and Continue; no fabricated answer or endless regeneration. |
| Complete identifiable call has invalid JSON/name/schema | No execution; return a matching error and allow one technical correction. Hold unstarted batch calls with valid bookkeeping. Repeated invalidity ends incomplete work. |
| Missing/duplicate/ambiguous call IDs | Execute no invalid batch; do not fabricate IDs or pollute native history. |
| Permission denial | Continue only with permitted alternatives; technical correction cannot evade denial. |

Continue starts a **new run**, revalidates current context/permissions and includes the original task, steering, interruption marker and actual completed outcomes. Reinspect live files before editing. Earlier changes remain; no automatic replay or undo.

Distinguish known success, known no effect, known partial effect and unknown effect. Cancellation/timeout/missing confirmation alone proves none of these. Inspect durable records, live files and available read-only service receipts. Record verified results without repeating actions. If still unknown, show **Action outcome unknown — needs attention**, retain necessary records and block affected writes while independent work can proceed. Continue, duplicate linking or deleting a chat cannot erase that uncertainty. Keep normal history/diffs after releasing resolved recovery data; no full rollback journal is required.

## Stop and unexpected closure

[[Run Lifecycle - Stop & Retained Edits.canvas]] · [[Run Lifecycle - Unexpected Closure.canvas]] · [[Run Lifecycle - Tool Failures.canvas]].

1. Persist stopping, invalidate pending approvals/questions and unstarted work, reject late callbacks.
2. Cancel generation, settle owned processes/writers and retain required reservations while outcomes are checked.
3. Keep current files and completed changes; no inverse patch, Git reset, model-generated undo or automatic restoration.
4. Save actual status, partial history, diffs and uncertainty. Known retained edits alone do not block future work.
5. Release resources when settled. Show **Stopped — completed changes kept**, or identify genuine unresolved effects.

On reopening after a crash, invalidate stale work, settle surviving verified owned processes, reconcile actual outcomes and show an error popup: interrupted work stopped and existing changes were kept. Completed earlier runs stay completed. Dismissing the popup starts no work and does not resolve an unknown effect. Question IDs/grants are not replayed. Managed previews are stopped/reported and require explicit restart.

Preserve never-started queued messages as **Not started — Granite restarted**, without automatic dispatch. Explicit **Run pending messages** revalidates/requeues a new run with fresh positions. Persist recovery once so another launch cannot recreate jobs or repeatedly reset deadlines.

## Temporary timers and deletion — pass 5

[[Run Lifecycle - Temporary Expiry.canvas]] · [[Run Lifecycle - Chat Deletion.canvas]] · [[Temporary Chat Flow.canvas]].

Initialize one idle deadline at creation, using existing run/queue/retention state rather than an activity log or per-second writes.

| State/event | Timer |
| --- | --- |
| Prompt/steering, valid answer/approval/denial, Continue, Stop, agent reply or qualifying action | Reset to one hour. |
| Active model/tool/continuing work or accepted queued messages/requests | Hold at 1:00:00, including waits/runs longer than an hour. |
| Last active/queued work ends/cancels; or work waits solely for user input/approval | Fresh one-hour countdown. Pending approval/question alone does not hold the timer. |
| Idle or approval/input-only waiting | Count down. Keep is available only when live and between runs. |

Passive opening, scrolling, focus and draft typing do not provide an additional durable activity log; exact qualifying UI events remain a pass-5 implementation default. Check the latest deadline/state atomically: an old timer cannot delete working, queued, refreshed or kept chats. A due chat becomes unavailable before cleanup; late input/answers/output cannot revive it. Expiry cancels residual work and removes its transcript, same-chat summary/provider state and temporary data without a model call. It has no durable contributions to regenerate. Manual Delete uses the same settlement path and may cancel active work; automatic idle expiry cannot interrupt protected active/queued work.

Offline idle deadlines still expire. Previously held active/queued timers receive a fresh idle hour after startup settlement, once. An already-expired idle/input/approval deadline is not revived. A live interrupted approval wait follows Stop reset; a wholly idle chat retains its real deadline. Requeue holds the timer again. Keep committed first removes expiry; completed expiry makes Keep unavailable.

Deleting a permanent chat stops/settles work first, removes owned transcript/provider/context state and source support, and **keeps repository files**. Unknown outcomes retain recovery records. Container deletion instead removes physically owned folders/internal code and descendant data; external linked targets survive. [[Container & Settings Rules]] and [[Memory & Context Policy]] own those details.
