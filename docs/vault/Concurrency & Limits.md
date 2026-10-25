# Concurrency & Limits

> Agreed initial behavior, accepted with amendments as D-052/D-053/D-054 from P-013. This is a target specification, not implemented functionality. The first iteration has no whole-run budgets; queued temporary work holds the timer, and queues show their reason and live position.

Start visually: [[Run Lifecycle - Queues & Concurrency.canvas]]

Related: [[Run Lifecycle Design]] · [[Remaining Harness Decisions]] · [[Decisions & Questions]] · [[Tool Permissions]] · [[Things to Optimize]]

## Chats and independent work

- One active run per chat, including approval waits and settling/outcome reconciliation. Messages during ordinary active work steer that run under D-045; they do not create parallel runs in the same chat.
- Different chats, including chats under the same agent, may run concurrently when their repository and model-connection capacity permit it. No subagents are introduced.
- Saving a message while its chat is queued appends it to the pending request in arrival order. There is one queue entry for the chat; extra messages do not create duplicate jobs or move it ahead of others.
- A message submitted after Stop has begun waits for the old run's cleanup. It can start a new run after safe cleanup, but cannot restart the stopped run. Genuinely unresolved action/process outcomes keep affected editing blocked; known retained edits do not.

## Repository-project reservations and queues

D-062 revises D-024’s global unique-owner rule. Multiple projects may link the same folder, with a warning about conflicting independent edits. Within a repository project, every run reserves that project’s repository access for the whole run because membership gives write capability. This also queues a text/read-only question in that project; parallel read-only runs remain in [[Things to Optimize]]. Outside chats retain permitted reads. Separate projects linked to the same physical folder may run concurrently; there is no global single-editor guarantee in this version.

Use first-in, first-out ordering among eligible chats within a repository project. Acquire its reservation before work starts and retain it during model/tool steps, approval waits and Stop settlement. Release it after writers settle and the outcome is known. Unresolved effects still block affected writes under D-057, including known aliases to the same affected resource; duplicate linking is not a recovery bypass. Fresh-read/revision checks must preserve conflicting writes from other projects/agents. D-067 defers automatic restoration; stopping retains completed edits. Store canonical links for duplicate warnings; stronger coordination/worktree isolation is deferred.

Provider availability is a separate gate. Do not occupy scarce model-request capacity while waiting for a repository. Revalidate the chat and its current permitted context when queued work actually starts; do not reuse a context snapshot assembled when the message first entered the queue.

Outside read-only chats may observe an in-progress repository. Their results describe the state they actually read; do not promise a stable snapshot or use a cached read as proof a file has not changed. The existing fresh-read/conflict rules continue to apply.

## Model-connection capacity

Agreed configurable starting defaults: one in-flight model request per local endpoint and two per remote account/connection, with capacity shared across all chats/agents using that connection. Respect a known/configured lower hosting-service or model concurrency limit; a host supporting only one request runs one at a time and the other chats queue. Do not assume that the selected model or hosting service supports parallel requests. These are Granite scheduling defaults, not claims about a provider's supported concurrency.

Queue extra requests fairly and show the reason and current position. Several chats may remain queued concurrently. If the provider reliably reports temporary lack of capacity, reflect that waiting state rather than pretending generation has begun. Other provider errors, exhausted quotas and context limits retain the accepted failure/recovery behavior; do not mislabel every error as a capacity queue.

Capacity belongs to an individual model request. Release it when that request ends, including when the run moves to tools or user approval. Reacquire it for the next model request. An approval wait must not occupy model capacity needed by another chat; the waiting run still owns its chat and repository reservation.

D-063 keeps the model/provider fixed within a chat/model session; never silently switch to avoid a queue. D-064 refreshes changed permissions before the next model request/tool execution without automatically stopping active work. See [[Container & Settings Rules]].

Unexpected closure uses [[Unexpected Closure Recovery]] (D-055): interrupted active runs are stopped and affected queues remain blocked until writers and actual outcomes are settled. [[Restarted Queues & Timers]] (D-056) preserves messages from never-started jobs but requires explicit restart with fresh validation/queue positions. Previously held temporary timers get a fresh hour after recovery; old real idle deadlines remain in effect. No old queue entry may bypass startup recovery.

## Tool ordering and shared files

- Execute a run's proposed tool calls sequentially in the model's order for the first version. Apply the already-agreed checks for steering, Stop and approvals before each action.
- An explicitly batched read can still return several bounded excerpts with checks for every file. Parallelizing separate tool executions is a later optimization.
- Keep valid call/result bookkeeping for calls not started because of steering or cancellation. Never represent skipped actions as successful or replay a completed action to fill a result.
- Serialize updates to each shared memory/notes resource and recheck its revision before applying changes. Two chats must not overwrite one another by saving independent old copies of the whole file. User edits retain the existing conflict-protection boundary. D-060 gives current manual/agent file edits equal standing and refreshes eligible contents each model call.

## No whole-run budgets in the first iteration

Do not include built-in or optional whole-run deadlines, model-step budgets or total tool-call budgets in the first iteration. Long-running work continues until completion, actual external model/provider limitations or user cancellation; do not add a harness budget that pauses it after an arbitrary duration or count. The existing validation, operation-error, deletion and recovery rules still apply. This revises the optional-budget part of P-013, not the standing permission or Stop behavior.

| Boundary | Agreed behavior |
| --- | --- |
| Overall run time, model steps, total tool calls | No fixed or optional whole-run caps in the first iteration. No budget settings or budget-exhaustion/Continue branch. |
| Individual model/tool operations | Use operation/provider-appropriate cancellation and timeout handling; exact values are implementation defaults. A stalled operation does not justify repeating an action with an unknown outcome. |
| Context and output | Preserve the agreed context budget/compaction policy and bounded tool results. Truncate explicitly and allow focused follow-up reads; a smaller model's remaining context may require a lower output bound. |
| Model-request retries | Preserve D-046's one bounded retry before response data; never automatically replay tools. |
| Stale edits | Preserve D-042's fresh read plus one corrected edit attempt. |

A permanent approval wait has no extra default expiration. Temporary retention follows the timer policy below. Per-operation cancellation/timeouts, bounded results and model-context constraints are distinct from a budget for the whole run. Continue remains available for the already-agreed failure/recovery cases; it is not triggered by a removed run-budget feature.

## Queue display and positions

- Show **Queued**, the blocking resource/reason, the current one-based position and a cancellation action. For example: **Queued for local model — 2nd in line** or **Queued for project repository — 1st in line**.
- Position 1 means the next waiting entry for that resource; running requests are not included in the waiting position. Refresh positions as eligible work starts, completes, is cancelled or is revalidated. Do not move a chat ahead merely because it receives another message.
- Label each position with its queue. A repository-project wait and a model-capacity wait are separate: work first becomes eligible within its project, then enters the model queue as needed. Do not show one misleading global position across unrelated repositories/providers or reserve a model slot for work still blocked on its repository.
- Granite can report exact positions for queues it manages. Show a host's internal position only when it reports one reliably. Otherwise use **Waiting for host capacity — position unavailable**; do not invent a rank or estimated start time. Prefer Granite-managed scheduling when the host's concurrency limit is known.
- Queue metadata must not inject other chats' transcripts or restricted context into the waiting model's input. Context is freshly validated when the work starts.

## Queue cancellation, location and temporary expiry

- Use the reason and live position described above. Do not label queued work as generating.
- Cancelling work that has not started removes its queue entry without repository rollback. Keep the saved user messages visible and identify them as not processed; do not generate a reply claiming work occurred.
- A queued request that has not started a run does not take the active-run Keep/move lock. Eligible Keep/move operations follow the normal hierarchy rules; rebuild/revalidate scheduling and context before starting. Once active, the existing Keep/move lock applies even during an approval/capacity wait.
- A temporary chat with an accepted pending message in a queue holds its timer at **1:00:00**. Repository waits, model-capacity waits and pending next-run messages during cleanup cannot expire merely because queueing lasts an hour. A continuing run waiting for its next model-request slot is also protected as queued work. This is D-054's amendment to the earlier countdown proposal.
- Actual model/tool work retains D-048's full-hour hold. Start a fresh one-hour countdown only when no work remains active or queued, or when the chat waits solely for user input/approval. A pending approval alone is not a queued user message. Already-processed messages in the transcript do not keep the timer held.
- Cancelling the last queued job starts a fresh hour if no other active/pending work remains. Manual Delete still cancels/removes the queued work immediately. Expiry can only act on a legitimately counting-down chat; a stale timer cannot delete a chat with active or queued work. Invalidated/cancelled/deleted entries must not be started by a late scheduler callback. Use the current timer plus ordinary run/queue state; do not introduce an activity log.

## Observable acceptance cases

1. A runs in repository X; B in the same project queues. C in an independent chat can run if model capacity exists.
2. A waits for approval. Another chat can use the freed model-request slot; B still cannot edit X.
3. Several messages arrive in B while queued. When B starts, it receives all pending messages in order, with freshly validated context and only one run.
4. Stop cancels A; B starts only after A’s writers/outcomes settle. Genuine uncertainty keeps affected work queued; completed retained edits alone do not.
5. A temporary chat remains queued for over an hour without another interaction. It remains live at 1:00:00 and runs when eligible; cancelling its last pending job starts a fresh idle hour.
6. A healthy run lasts longer or uses more model/tool steps than a typical task. No first-version harness run budget stops it; genuine operation/provider failures and user Stop still follow their accepted policies.
7. A local host permits only one request. A generates; B and C show model-queue positions 1 and 2. Cancelling B updates C to position 1 without disturbing A.
8. An external host queues the submitted request but provides no internal rank. Show that the host is busy with position unavailable; do not display a fabricated position.

Exact scheduler/storage implementation and resource-key normalization are engineering choices. The behavior above must remain consistent with repository ownership, steering, approval invalidation and recovery. Larger read parallelism and scheduling/performance tuning remain later optimizations.
