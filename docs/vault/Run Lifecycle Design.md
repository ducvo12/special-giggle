# Run Lifecycle Design

> Intended behavior. This is a planning document, not a claim that the current application implements these rules. Begin with the text-only successful path; other branches below are captured for later design.

Start visually: [[Run Lifecycle - Text Only.canvas]] · [[Run Lifecycle - Repository Edits.canvas]] · [[Run Lifecycle - Stop & Rollback.canvas]] · [[Run Lifecycle - Steering.canvas]] · [[Run Lifecycle - Model Request Failures.canvas]] · [[Run Lifecycle - Approvals.canvas]] · [[Run Lifecycle - Temporary Expiry.canvas]] · [[Run Lifecycle - Chat Deletion.canvas]]

Related: [[Harness Design]] · [[Memory & Context Policy]] · [[Temporary Chat Flow.canvas]] · [[Decisions & Questions]] · [[Things to Optimize]]

Agreed scheduling/limits: [[Concurrency & Limits]] · [[Run Lifecycle - Queues & Concurrency.canvas]] (D-052/D-053/D-054). There are no whole-run budgets in the first iteration. Queued temporary work holds the full-hour timer, and queues show their blocking resource and live position.

Final behavior revisions: [[Container & Settings Rules]] · [[Container & Settings.canvas]] (D-059–D-066). Duplicate folder links are allowed with warnings and serialization within each project. Current eligible memory refreshes each request, and changed permissions apply to the next model request/tool execution without automatically stopping active work.

Unexpected closure: [[Unexpected Closure Recovery]] · [[Run Lifecycle - Unexpected Closure.canvas]] (D-055). Stop interrupted runs, retain current files, settle/reconcile work on reopening and show an error popup. D-067 defers automatic restoration.

Restarted queues/timers: [[Restarted Queues & Timers]] (D-056) preserves pending messages but requires explicit restart. Held temporary timers get a fresh hour after recovery; real idle deadlines continue offline. Malformed/uncertain-outcome defaults are agreed in [[Model & Tool Failures]] · [[Run Lifecycle - Tool Failures.canvas]] (D-057).

## Terms

- **Run:** the harness work started by a user prompt, ending in completion, Stop, failure or deletion. Steering messages may update the same active run.
- **Model request / step:** one request to the selected model. A tool-using run may make several requests.
- **Run state and request context:** keep agent, chat location, retention, session model/provider and run identity stable. Personality retains its next-run timing. Conversation input grows with steering/tool results; D-060 refreshes eligible memory/notes on every request, and D-064 refreshes permissions/context/tools before new requests and checks permissions again before each tool action. A run snapshot does not freeze authorization for the entire run. D-067 removes automatic rollback from this version.

## First path: one prompt, one text-only answer

Example: the user sends “Say hello.” The model returns a normal text reply, uses no tools, receives no steering, and encounters no Stop, expiry or provider failure.

| Stage | Harness behavior | User-visible behavior |
| --- | --- | --- |
| 1. Submit | Accept and save the user message. For a temporary chat, refresh its expiry value using submission time without creating a separate activity record. | The message appears in the conversation. |
| 2. Validate and start | Check the chat still exists, location/model connection is valid, and a run can start. Establish the run ID, running status and location/retention snapshot. | The chat shows that the agent is working. |
| 3. Prepare context | Apply the section's Shared/Closed scope and temporary retention rules. Assemble personality, instructions, the current prompt, relevant own-chat history and permitted context under budget. No additional lookup/tool step is needed in this example. | A brief preparing state may appear. |
| 4. Request model | Send one streaming request through the selected provider adapter. This path needs only one model request. | The chat waits for the response. |
| 5. Stream provisionally | Append user-visible text fragments and persist progress while separately assembling any structured tool-call events. Text is provisional agent output, not a completed final answer. | Text appears progressively while the agent is still working. |
| 6. Inspect completed model response | Wait for successful provider completion, then check for tool calls. This example has none and can finalize. If calls are present, validate/handle them and continue the same run instead of declaring the text final. | The working state continues if a tool branch is needed. |
| 7. Finalize answer | On the no-tool success path, save completed text/status and compatible provider state. | The answer is now marked finished. |
| 8. Finish run | Close run resources and release the active-run lock. Apply eligible meaningful-memory updates only if useful; a greeting does not need a new memory or summary pass. Temporary chats contribute no durable memory. | The chat becomes idle and Keep/move actions are available again. |

Suggested basic statuses: **preparing → generating → completed**. The terminal success state is committed before the active-run lock is released. Exact crash consistency and failure handling will be designed in their own branches.

### Provisional streaming — agreed

A model response may contain text and tool calls together, with calls arriving after some text. Do not claim there are no tools merely because text arrived first. Stream user-visible text provisionally, assemble structured tool calls separately, and decide which branch to take after the response completes. Do not display raw tool-call argument fragments as ordinary answer text.

If tools are present, the preceding text remains intermediate activity for the same run. Validate the complete calls, execute only permitted actions, append their results, then make another model request. Only a successful no-tool response can take the normal final-answer branch. Empty or malformed responses follow D-057 / [[Model & Tool Failures]]; do not silently treat them as completed answers.

This avoids buffering all text until the response ends. Tool execution is not triggered by the model merely writing a tool's name in prose.

### One read-only tool — agreed

Use the smallest example: “Read the README and tell me what this project does.” The model proposes one structured read, the harness validates its name/arguments and allowed file scope, executes the permitted read, returns a bounded result linked to the call ID, and makes another model request. The next successful response with no tool proposals becomes the final answer. This branch has no code edits or rollback; approval-required actions and tool errors are separate next steps.

### Repository reading — accepted initial approach

Read permission makes a repository available to tools; it does not inject every file into model context or require one user approval per file. File content must reach the model through explicit initial context or a read/search tool result. One request can contain several reads, or a batched-read tool can return several bounded excerpts; one network/model request per file is not inherently required.

Accepted starting approach:

- Supply a small orientation view of the active/eligible repository and a bounded file listing when helpful, not every file's contents.
- Let the model find filenames and search text, then read relevant file ranges and follow dependencies/tests as needed.
- Batch independent file reads, with permission checks on every path and a shared output budget. Keep control flow compatible with local models; no subagents are required.
- Exclude dependency/build/generated/binary content from routine search/map results unless the task explicitly needs it. Return file paths, line ranges and enough surrounding context to continue reading.
- Preserve source revision information; external edits can make a cached index or excerpt stale even while the run’s section is fixed. D-064 also requires current permissions before each new tool action. Re-read relevant code before editing it.
- Keep lexical search as the baseline. An incremental parser-based symbol/import map and semantic retrieval are possible later additions if evaluation shows a need. Building a file/symbol index does not inherently require an LLM summary pass; returned excerpts still consume model-context tokens.

Current workspace tools already offer listing, filename search, content search and a single-file range read. Batched reads, repository maps, and routing those tools into externally attached repositories are planned design work, not implemented capabilities.

Repository-project membership grants implicit read/write access with no per-edit approval. Shared repositories are readable by all chats under the agent; Closed repositories only by chats in their own section. Outside chats cannot write until the approved permanent project move succeeds; temporary chats must first be kept. The harness checks these rules for every tool action without turning each permitted read/edit into a user prompt. See [[Harness Design]] and [[Repository Access.canvas]].

Keep this initial approach simple. Large-repository performance, richer indexes/repository maps, and model-context optimization are recorded in [[Things to Optimize]] for work after the basics. Context limits and access checks still need to work correctly in the basic version.

Evidence: [OpenAI's Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide) recommends file/text search and batching independent reads. [Aider's repository map](https://aider.chat/docs/repomap.html) provides relevant files and key symbols within a token budget, with detailed reads when needed. These are examples of approaches, not a claim that every harness uses the same indexing strategy.

### One successful repository edit — agreed

The user accepted this path after the read-only loop. The chat is already permanent and inside the repository's owning project; no Keep/move transition or additional edit approval is required.

| Stage | Harness behavior | User-visible behavior |
| --- | --- | --- |
| 1. Submit and validate | Save the request, validate chat/project membership and the target repository, and start the run with the normal context snapshot. | The requested change appears and the chat starts working. |
| 2. Record starting state | Establish a baseline for actual change tracking and preserve existing user work. D-067 defers automatic restoration; no durable undo checkpoint is required solely for that feature. | Preparing may appear briefly. |
| 3. Read relevant code | The model requests bounded file reads/searches. The harness checks file scope and returns the results linked to their calls. | File-reading activity appears. |
| 4. Apply the edit | The model proposes a structured edit. The harness validates its arguments, current target and membership, applies the permitted change, and records the actual outcome. Project membership supplies read/write permission without a prompt for each edit. | Editing activity appears without another approval dialog. |
| 5. Return the result | Refresh actual file changes and added/removed line counts, append the edit result to conversation input, then make the next model request. | Changes and counts update; the agent continues working. |
| 6. Explain and finish | On a successful no-tool model response, save the final explanation and finish the run. Report only edits/checks whose outcomes are known. | A finished answer explains the change and any checks performed. |

The model proposes tool calls; the harness performs the operations and supplies their outcomes. A textual claim that a file was changed is not a successful edit result. This example makes a code edit but does not automatically require a separate test suite, Git commit, push or deployment.

### First failed edit: stale file contents — agreed

**Agreed:** keep the first recovery branch small. Example: the model read a button label, but the user changed that line before the proposed replacement reached the harness.

1. Validate the entire single-file edit and its expected current contents before applying it. If the expected text/revision no longer matches, reject this call without changing the file. Require a clear target; do not guess between ambiguous matches.
2. Save a failed tool result linked to the original call ID: the reason, that this call made no change, and that a fresh read is needed. Show the failed editing activity without ending the run immediately.
3. Return the error to the model in the next request. The model can read the file again and formulate a corrected edit under the same project permissions; no new approval prompt is needed.
4. Allow one corrected edit attempt for that failed operation. A supporting read does not consume the edit attempt. If the corrected edit succeeds, update the visible changes and continue the normal success path.
5. If it fails again, end automatic editing for this recovery branch and report what succeeded, what failed, and which changes remain. Do not loop indefinitely or claim that the requested task is complete.

**Agreed failure boundary:** rejecting this one edit does not automatically undo earlier successful edits in the run. Earlier changes remain visible while the model recovers; if it gives up, describe the partial result. User Stop cancels/settles work and keeps completed edits under D-067. Ordinary model-request failure preserves changes under the next branch; uncertain tool effects now follow D-057 / [[Model & Tool Failures]], while unexpected application closure follows D-055.

This simple recovery applies only when the harness knows the failed call changed nothing. A membership/path denial must not be retried through a different tool to bypass the rule. A failed operation with partial or unknown effects needs inspection/reconciliation before another write under D-057 / [[Model & Tool Failures]], rather than blindly replaying the edit. The agreed one-attempt limit is a local failure-recovery rule, not a whole-run budget or performance optimization.

### Model request failure or connection loss — agreed

**Agreed:** handle a failed model request without treating it as a successful completed answer. Start with a text-only example: the local model connection drops halfway through a reply. This branch covers a failed inference/response stream with known tool outcomes; a tool with unknown or partial effects needs its own recovery branch.

| Failure point | Harness behavior |
| --- | --- |
| Temporary connection/server error before the request emits any text or tool-call data | Make one bounded automatic retry after a short delay unless the run was cancelled. Retry only the model request, using current valid context and already-recorded tool outcomes; never replay completed tools. Show a brief reconnecting state. No whole-run budget is introduced. |
| Invalid credentials, unsupported settings or another error requiring user correction | Show the concrete problem and end the failed run without repeating an unchanged request. Do not silently change models/providers. |
| Any text or tool-call data already streamed, or the one automatic retry also fails | Preserve visible partial text as interrupted, save the failed status and provide a Continue action. Do not mark the reply complete or auto-execute tool proposals from the incomplete response. |

Granite displays the connection/failure message itself; reporting the error must not require another successful model call. Example: **“Connection lost. This reply is incomplete.”** In a coding run, also show that completed file changes remain and keep the actual diff/counts visible.

**Agreed repository boundary:** an ordinary model-request failure preserves earlier completed repository edits, as the failed-edit branch does. It keeps actual edits, as Stop also does under D-067. Never repeat a previous write merely because the later explanatory model request failed. Stop during reconnecting uses cancellation/settlement and retains completed edits. There are no whole-run budgets in the first iteration (D-053); existing operation/context/output boundaries remain. Temporary retention is held at a full hour during active or queued work, including a bounded reconnect attempt, and starts counting down when no active/pending work remains or when waiting solely for user input/approval.

**Agreed Continue behavior:** after the connection is usable, Continue starts a new run in the same chat. Revalidate the current location, retention and permissions, then include the original task, subsequent steering, relevant history, failure/interruption marker and actual completed tool outcomes. Inspect current files before making further edits. Keep partial tool arguments out of valid provider state; do not invent a completed call or successful action. The new run has its own execution/change record. Under D-067, Stop keeps both earlier and new completed edits; it does not create an undo boundary.

Keep the failed run’s ordinary change/outcome history for inspection and retain reconciliation records for genuinely unknown effects. D-067 defers automatic rollback and its full snapshots; a dedicated earlier-run Undo interface is also deferred. Continue is not an automatic undo request. Uncertain file/tool effects need reconciliation before more writes under [[Model & Tool Failures]]; the connection-retry rule does not authorize replaying the operation.

Pending steering must be incorporated before the retried model request. Explicit Stop, deletion or temporary expiry prevents a scheduled retry from restarting cancelled work. Detailed crash recovery, failed external actions, long rate-limit waits and richer retry policies remain later branches.

Visual design: [[Run Lifecycle - Model Request Failures.canvas]].

### Approval-required action: identity edit — agreed

**Agreed:** use an identity-file edit as the first approval example. The established permission rules still apply: a permanent Shared chat may propose this action, while Closed and temporary chats cannot edit identity or request approval to bypass that restriction. Repository-project membership already grants ordinary repository edits without approval; this branch adds no per-edit prompt for code.

| Stage | Harness behavior | User-visible behavior |
| --- | --- | --- |
| 1. Validate proposal | Validate the tool/action, chat scope, target file and proposed edit. Disallowed actions are rejected before an approval is offered. | The agent can explain a prohibited action rather than presenting an ineffective approval control. |
| 2. Present the exact change | Create a pending request bound to this run, action, target revision and exact proposed change. Show the reason and old/new diff. If valid explicit approval already covers this exact unperformed action, use it without asking again. | An identity-change preview with Approve/Deny appears. |
| 3. Wait | Pause this run at **Waiting for approval**. Do not keep calling the model or run additional tools while waiting. The approval itself changes nothing on disk. | The user can inspect the change before deciding. |
| 4a. Approve | Verify that the run/request is still active and the file/action still match what was approved. Apply exactly that change once and save the actual result. Duplicate or late approval events cannot apply it again. | The approved edit is applied, or a changed proposal is returned for fresh review. |
| 4b. Deny | Leave the file unchanged, record the denial as the tool result and let the model explain or continue with a permitted alternative. Do not repeatedly re-propose the same rejected action. | The request closes with a clear denied/no-change result. |
| 5. Resume | Return the recorded outcome linked to the original call, then make the next model request and follow the normal completed-response gate. A failed write is reported as a failure; approval is not proof of execution. | The agent reports what actually happened and can finish the run. |

**Agreed lifetime:** approval is for one exact action in this active run, not a reusable grant for future edits. Waiting never turns into automatic approval. No separate permanent-chat approval timeout or whole-run deadline is included in the first iteration: a decision or run cancellation/end resolves it. A temporary chat waiting solely for user input/approval still uses the one-hour inactivity countdown; active or queued work holds that timer under D-048/D-054. Identity edits themselves remain unavailable in temporary chats.

**Agreed steering behavior:** an ordinary new steering message withdraws the pending approval without applying it. Record a superseded/not-applied result and give the model the original task, the steering message and actual outcomes in the same run. It may propose a revised action if still appropriate, with a fresh exact preview. A decision on the pending request is handled as approval/denial, not as an unrelated steering message. Stop, deletion or expiry cancels the request; a later click must not restart that run or execute the stale action.

**Agreed identity timing:** save an approved identity edit immediately, but load the new personality from the next run, keeping the active run's instruction snapshot stable. Personality content cannot grant tools, change section scope or override harness policy. Keep/move approvals still happen between runs under the existing location/retention lock; this within-run identity approval does not bypass those transitions.

The exact action preview, validation and decision are the permission boundary. The model cannot approve its own request or use another tool to perform a denied action. An external manual edit that changes the preview's basis invalidates the old request; revalidate and show the updated change instead of overwriting the user's newer file.

Visual design: [[Run Lifecycle - Approvals.canvas]].

## How context passes through a loop

Checked current source:

- `src/backend/harness/loop.ts` prepares instructions/input once, then appends outputs and tool outcomes before calling the adapter again.
- `src/backend/harness/providers/chat-completions.ts` sends the system instructions and accumulated `messages` in every model request.
- `src/backend/harness/providers/responses.ts` sends instructions and the accumulated native input in every model request, with local state management rather than `previous_response_id`.

Re-sending the current context is different from re-reading all memory files or sending all saved chats. The run's context sources can stay logically stable while conversation/tool history grows. Provider-side caching or a stateful API can change transport/processing details without changing the required visibility and retention rules.

LM Studio's compatible Chat Completions interface accepts chat history in the request. Its native `/api/v1/chat` API separately supports stateful continuation; Granite does not currently use that native API.

Sources checked: [LM Studio Chat Completions](https://lmstudio.ai/docs/developer/openai-compat/chat-completions), [LM Studio stateful chats](https://lmstudio.ai/docs/developer/rest/stateful-chats).

## Captured decisions for later branches

### New messages steer

**Agreed:** messages submitted while the chat is running steer the active work; they are not unrelated independent runs.

**Confirmed context rule:** append the new message to the conversation; do not replace the original request with it. In the button example, the next model request contains both “Make the button blue” and “Actually, make it green,” in order, together with relevant existing history and actual completed tool results. The newer message changes the color while the original identifies the button/task and supplies any other constraints that still apply. If older history is compacted, preserve the task, constraints and subsequent corrections; a context-free fragment such as “green instead” is insufficient.

**Accepted initial design:** steering takes effect at the next safe boundary in the same run. Example: the user asks for a blue button, then sends “Actually, make it green” while the agent is working.

| When the new message arrives | Harness behavior |
| --- | --- |
| In an active working run | Save the user message immediately in arrival order, reset temporary inactivity as normal, and mark it pending for this run. Hold actions that have not started until the model has received the new direction. Show that the message was received; do not create a parallel run for it. |
| During model generation | Request cancellation of that generation where supported. Preserve visible partial text as interrupted activity, not a finished answer. Fence off late output/tool proposals from the obsolete generation. Make a fresh model request with the accumulated history and pending user messages. If cancellation is unavailable, wait for the response boundary and do not execute its unstarted tools. |
| While a tool is running | Let an atomic file write finish safely; cancel a longer action only when its cancellation behavior is known. Save its actual outcome before continuing. Do not pretend that the new message reverses an already-started write or that cancellation guarantees no effects. |
| Between tools, or after a model response but before its proposed tools start | Do not execute unstarted tool proposals from the outdated plan. Account for cancelled proposals and completed calls in valid provider history, then ask the model again with the steering messages and actual tool outcomes. |
| Just before normal finalization | Check that all accepted messages for the active run have been incorporated. A message accepted first must be processed before the run finalizes; if finalization wins the race, the message starts a new run. |

The model can then revise its plan and make further permitted edits toward the latest direction without a new per-edit approval. If the button was already made blue, the model sees that actual edit outcome and can change it to green. If the blue edit never started, skip that obsolete proposal. Keep every steering message in arrival order; several pending messages can go into the same next request without silently dropping earlier ones.

**Agreed run boundary:** preserve the run ID, project reservation, execution/change record, location/retention and existing operation/context/output boundaries. Refresh permitted context/authorization under D-060/D-064 without changing the run’s execution identity. D-053 excludes whole-run time/step/tool-call budgets from the first iteration. A generation restart is not a new run and does not reset the run identity. Earlier successful edits remain until the model deliberately revises them or the user presses Stop. A later explicit Stop cancels remaining work and retains completed edits, including those before steering (D-067).

An ordinary message cannot bypass section/project membership, retention or required permission controls; the Keep/move lock still applies. User permission-setting changes do apply to subsequent requests/tool actions under D-064 without automatically cancelling in-progress work. Required approval must match the action actually proposed; steering cannot repurpose an approval for a different action. Ordinary steering withdraws a pending approval under the agreed approval branch above.

Explicit Stop takes precedence. A message arriving after the run has entered stopping/settling must not restart that cancelled run or interrupt cleanup. Save it for a new run after safe cleanup under [[Concurrency & Limits]]; unresolved recovery keeps further editing blocked.

Compatibility: a request already sent through Chat Completions cannot have its `messages` body changed in flight. This approach uses a fresh request and a safe tool boundary, so it does not require a provider-specific live prompt-injection feature. In provider input, retain actual tool outcomes and complete call/result pairs; never send partial tool-argument fragments as completed calls or manufacture success for a discarded proposal. Exact adapter bookkeeping remains implementation work.

Visual design: [[Run Lifecycle - Steering.canvas]].

#### Comparison with other harnesses

Official documentation checked during this discussion:

| Harness | Documented behavior | What it supports for Granite |
| --- | --- | --- |
| Codex | `turn/steer` appends user input to an active turn without starting a new turn. Its IDE also distinguishes steering now from queuing for the next run. | Adding new input to existing work is a supported pattern. The app-server documentation does not establish that every steering message cancels an in-flight inference request. |
| Claude Code | Messages submitted during work queue; messages arriving during tool calls can be delivered after those calls finish within the same turn. It also has a send-now action whose behavior depends on the active work. | Delivery at a tool boundary is an established option; accepting a message is distinct from the exact time the model processes it. |
| Pi | The active conversation branch supplies model history; messages append to that branch. Steering enters after the current assistant turn, while follow-ups wait until pending work finishes. | Retain the original conversation and add the correction, with explicit steering/follow-up timing. |

Sources: [Official OpenAI documentation — Codex app server](https://learn.chatgpt.com/docs/app-server#steer-an-active-turn), [Codex IDE settings](https://learn.chatgpt.com/docs/ide/settings), [Claude Code interactive mode](https://code.claude.com/docs/en/interactive-mode#when-claude-code-sends-what-you-queued), [Pi: how it works](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/how-pi-works.md).

These sources support preserving conversation context and delivering additional input during ongoing work. They do not make every harness's timing identical. Granite selects generation cancellation where supported followed by a fresh request; that is our initial design choice, rather than a claim about every other harness's implementation.

### Moving and keeping

**Accepted conditional choice:** block Keep chat and location moves while a run is active. The current adapter re-sends context for each step, and freezing these actions keeps location/retention stable. This lock does not freeze memory revisions or explicitly changed permission settings, which follow D-060/D-064. Re-sending context alone does not technically require this lock, but the design chooses it for consistency.

Keep and move are available once the run has ended. The temporary-to-project flow must therefore end the active run with an explicit transition-needed response, obtain Keep and move approvals between runs, then continue the requested editing in a new run after membership is correct. Ending that run does not claim the requested code edit is already done. Do not wait for a Keep approval inside a run whose own active lock prevents keeping.

Deleting an active chat is different: stop/cancel the run first, prevent later output or writes from resurrecting its records, complete required cleanup, then delete the chat under the agreed deletion policy.

### Stop — keep completed edits (D-067)

**Revised first-version behavior:** Stop cancels generation and prevents new requests, tools and approvals. Cancel/settle owned processes and writes, preserve the actual current files and partial conversation, refresh the visible changes and mark the run stopped. Completed edits remain on disk. Automatic restoration and its durable undo journal are deferred in [[Things to Optimize]] / [[Deferred File Restoration]].

1. Persist Stopping, invalidate unstarted work and pending approvals, and reject late callbacks.
2. Cancel generation/tools where supported and settle owned writers before releasing the project reservation.
3. Determine actual outcomes and preserve existing files, including completed edits. No Git reset, inverse patch or model-generated undo runs automatically.
4. Save the stopped outcome, current diff/counts and partial history; show **Stopped — completed changes kept**.
5. Release scheduling after writers/outcomes settle. A genuinely unknown action outcome still uses D-057’s needs-attention path; known retained edits alone do not block future work.

Keep stale-edit revision checks, scope enforcement, visible diffs and process cancellation. Deferring rollback does not permit overwriting another writer or treating an unknown outcome as success. A separately authorized user request to revert files can use ordinary tools; Stop itself is no longer a revert request.

### Unexpected application closure — revised by D-067

Treat interrupted runs as stopped on reopening. Invalidate old callbacks/approvals, settle surviving owned processes, reconcile actual outcomes and show the unexpected-closure error popup. Keep code as it exists; do not restore pre-run files or automatically resume/replay the run. See [[Unexpected Closure Recovery]]. Queue/message and temporary-timer recovery remain D-056. Unknown effects can still require attention; an ordinary interrupted run with known retained edits does not wait for rollback.

### Permanent-chat deletion during a run — revised by D-067

Delete first prevents new work and cancels/settles any active run, then removes chat-owned database/provider/context state and applies D-029’s source cleanup. Existing repository edits remain, including those made by the interrupted run. No file restoration is a deletion prerequisite. Do not delete a project or codebase merely because one chat is removed.

| Chat state | Behavior |
| --- | --- |
| Idle | Remove chat-owned data; preserve repository files. |
| Queued | Cancel its queue entry, invalidate callbacks and remove chat-owned data. |
| Active model/tool work | Stop, settle writers, retain actual edits and then delete chat-owned data. |
| Genuinely unresolved action/process outcome | Retain necessary reconciliation state and hold affected cleanup/writes until that uncertainty is resolved; known retained edits are not an unresolved rollback. |

Container deletion is separate: D-059 still removes its actual physical folder tree and descendant database chats. Repositories physically inside that tree are deleted with it; external linked folders remain with their current edits after work settles. See [[Container & Settings Rules]]. Temporary chats still cannot edit repositories.

### Temporary activity and expiry

**Agreed revision in D-048:** hold the temporary-chat timer at a full hour while the agent is actively running. Agent responses and qualifying chat actions also reset it to one hour. A long model/tool run must not be deleted merely because an hour passed without another user message. This replaces the earlier proposal to let the inactivity deadline expire during generation/tool work.

**Agreed queue extension in D-054:** also hold the timer at a full hour while an accepted user message or continuing model request is queued, including repository/model-capacity waits. A temporary chat must not disappear before its queued work gets a turn. Already-processed transcript messages and a pending approval alone do not count as queued work. Cancelling the last pending job starts a fresh idle hour if no active work remains.

**Earlier approval-wait rule retained:** waiting solely for the user to approve an action is paused work rather than active/queued work. Start a fresh one-hour countdown when entering that wait with no actionable queued message. Without another valid action or response, an unattended one-hour approval wait can still expire the temporary chat. Identity edits remain prohibited in temporary chats; this applies to other permitted approval-required actions when designed.

#### Timer behavior — agreed revision

Initialize expiry one hour after temporary-chat creation. A valid response or action updates the current expiry value; activity cannot revive a chat whose expiry has already taken effect.

| State or event | Timer behavior |
| --- | --- |
| Submit a prompt or steering message; valid approval/denial, Continue or Stop | Reset to one hour. Active or queued work then holds it there. |
| Agent response or qualifying tool/chat action | Reset to one hour. No separate activity event is stored for this purpose. |
| Active model generation, tool execution or continuing harness work, including bounded reconnecting | Hold at **1:00:00**. Automatic inactivity expiry is disabled for this active-work state, including a run lasting longer than an hour. |
| Accepted pending message or continuing model request queued for repository/model capacity | Hold at **1:00:00**, including waits longer than an hour. A stale deadline cannot expire this queued work. |
| Active work finishes/fails/stops or the last queued job is cancelled, with no other active/pending work remaining; or waits solely for user input/approval | Start a fresh one-hour countdown from that transition. |
| Waiting solely for approval or sitting idle, with no active/queued work | Count down normally. A new valid response/action refreshes the hour; time passing alone does not. |
| Keep chat while it is live and idle | Make it permanent and remove expiry. Keep remains unavailable during an active run. |

The earlier proposal that passive opening/reading/scrolling/focus or draft typing does not count as an activity remains a UI classification proposal. It does not change the confirmed active/queued-work hold or response/action resets.

#### Minimal timer state — agreed

For inactivity tracking, keep only the current expiry value, together with the chat retention/run/queue state already required by the harness. Do not add a list of activities, an interaction history or an activity-event table. Permanent chats need no inactivity bookkeeping. This requirement concerns timer tracking; ordinary saved messages and actual tool outcomes follow the existing conversation-history policy.

One implementation option is a nullable expiry timestamp: clear/disable it atomically on entry to active or queued work, derive the full-hour display from existing run/queue state, then set it to `now + 1 hour` when no active/pending work remains or the chat waits solely for user input/approval. Each qualifying idle/waiting action simply replaces that value. Keep cancels expiry, and a stale timer checks the latest state before doing anything. No per-token records or periodic per-second writes are needed to hold a full hour. The exact representation is implementation work, not an additional event log.

#### Expiry and temporary deletion — proposed

1. Check the latest countdown deadline, retention and run/queue state. Only an idle or approval-only-waiting chat with a due deadline and no active/queued work can automatically expire. Atomically mark the due chat expiring/unavailable and block further messages, runs, tool actions, approvals, Keep and retrieval. A stale timer must not delete a refreshed, working, queued or already-kept chat.
2. Cancel pending approvals and any residual retry/queue callbacks/resources; settle safely before cleanup. Waiting solely for approval does not defer its countdown deadline. Manual deletion can cancel active or queued work, but automatic inactivity expiry cannot interrupt work protected by D-048/D-054.
3. Remove Granite's saved transcript, same-chat summary, local provider continuation state and other chat-owned temporary state after cancellation/cleanup is safe. No model call is needed for this cleanup. Temporary chats have no permitted durable-memory or cross-chat-search contributions to preserve or regenerate.
4. Reject late output, tool callbacks and approval clicks so they cannot recreate the chat or restart its work. If cleanup must retry, retain only the necessary internal cleanup state while the expired chat remains unavailable.
5. Remove the chat from the visible list. If it was open, return to its section with a short notice: **“Temporary chat expired after one hour of inactivity.”**

Manual deletion of a temporary chat uses the same cancellation/cleanup path immediately. Under the current rules, a temporary chat cannot edit repository code, so this expiry branch has no repository rollback. It does not remove shared notes, other chats, project repositories or original source files merely because the chat read them.

If a countdown deadline was saved before Granite closed, it still applies while closed. On reopening, check it before displaying/loading chats and clean up overdue records without resuming expired work. On a normal shutdown that ends active work and leaves no queued work, establish the fresh one-hour deadline. Unexpected closure stops interrupted runs under D-055. Under D-056, preserve never-started queued messages but remove automatic dispatch until explicit restart; previously held timers get a fresh idle hour after recovery, while real expired idle/approval-only deadlines are not revived. Reconcile durable state once so another restart cannot recreate a job or refresh an already-established deadline again. See [[Restarted Queues & Timers]]. This describes Granite's local retained state rather than promising deletion by an external provider.

Keep and expiry must serialize against the latest state: a valid Keep committed first removes expiry; an already-expired chat cannot be kept. A newly submitted prompt or valid action must also pass the live/deadline check before extending the timer. For an active temporary chat the user can Stop first, then Keep once the run has settled.

The revised permanent-chat deletion policy above cancels/settles an active coding run and keeps all completed file edits. This temporary-expiry branch covers only temporary retention and its cancellation/cleanup path.

Visual policy: [[Run Lifecycle - Temporary Expiry.canvas]] — timer rules revised in D-048/D-054; detailed cleanup remains proposed.

### Concurrency

D-052/D-062 select one active run per chat, whole-run reservations within each repository project, independent concurrent chats and fair capacity-aware queues with live positions. Duplicate links across projects are allowed with a warning, so global single-editor exclusion is no longer promised. D-053 excludes whole-run budgets in the first iteration; D-054 protects queued temporary chats from expiry. No subagents. See [[Concurrency & Limits]].

## Design progress and next branches

1. **Agreed:** text-only success and provisional streaming.
2. **Agreed:** one read-only tool followed by a final answer.
3. **Agreed:** one repository edit with implied project permissions and visible changes.
4. **Agreed:** an edit rejected before changing the file, one corrected attempt, and honest partial-result reporting.
5. **Revised by D-067:** Stop cancels/settles work and keeps completed edits. Automatic restoration, its undo journal and related recovery UI are in the later backlog.
6. **Agreed:** steering interrupts generation or waits for a safe tool boundary, then continues the same run with the original request, new messages and actual outcomes; earlier edits are not automatically undone.
7. **Agreed:** one bounded model-request retry before output for temporary connection errors; preserve interrupted output/completed changes and offer Continue after a failed run.
8. **Agreed:** preview an approval-required identity edit, wait, apply that exact approved change once or return denial, and invalidate superseded/cancelled requests; new personality loads next run.
9. **Agreed revision:** hold a full hour during active or queued work; replies/actions reset it; count down when idle or waiting solely for approval; use one current expiry value without an activity log. Cleanup details remain proposed.
10. **Revised by D-067:** deleting an active coding chat uses Stop/settlement before cleanup and keeps completed edits; only genuinely uncertain outcomes require reconciliation.
11. **Container/settings review complete:** [[Container & Settings Rules]] records D-059–D-066 for deletion, current editable files, relinking/duplicate links, fixed session model, live permission timing, skill imports and optional tool lookup. [[Remaining Harness Decisions]] now tracks specification handoff and explicit deferrals.

Performance and richer context/repository retrieval remain in [[Things to Optimize]] after the basics.
