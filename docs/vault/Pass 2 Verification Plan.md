# Pass 2 Verification Plan

> Prepared October 25, 2026. The selected A–D checks have now been exercised; see [[Pass 2 Focused Verification Results]] for exact coverage and evidence. Remaining checks are pending in [[Pass 2 Tests to Run Later]]. Earlier light checks remain recorded separately in [[Pass 2 Implementation & Testing]].

Related: [[Harness Implementation Plan]] · [[Pass 2 Implementation & Testing]] · [[Run Lifecycle Design]] · [[Concurrency & Limits]] · [[Model & Tool Failures]] · [[Restarted Queues & Timers]] · [[Container & Settings Rules]]

## Current execution scope

For the October 25 focused session, execute A–D: basic replies, steering, queues, and Stop/Continue. E–G and I are deferred to [[Pass 2 Tests to Run Later]]. The broad H usability/regression sweep is also outside this session; incidental UI checks do not count as completion of H. Restart subvariants in A4 and malformed-response subvariants overlap the deferred areas and remain pending.

## Goal and evidence

Verify that the actual desktop app delivers every behavior in **Pass 2 — Basic Run Lifecycle and Scheduling**, including the transitions between states. Use the accepted design as the expected behavior, rather than treating the current implementation as the specification.

Each case gets a result and evidence from the relevant layers:

1. **Desktop:** interact with the real Granite window by typing, clicking, navigating and reopening it. Check visible messages, controls, queue positions, approval previews and recovery notices. Capture screenshots for meaningful states and visual defects.
2. **Model/tool boundary:** a controllable local server records request order, active request count, messages, complete call/result pairs and tool execution receipts. This proves what the model received and which actions actually ran.
3. **Durable state:** inspect the disposable profile's saved chats, runs and fixture files without changing them. Compare IDs, message order, pending/processed status, final outcomes and file contents before and after restart.

Seed fixtures or inspect state through test helpers where necessary, but exercise the feature itself through its desktop controls whenever available. Use controlled backend checks for precise boundaries that cannot reliably be timed by clicking, and label that evidence separately. An assertion that a button exists is not enough to prove its behavior.

## Setup

- Record the source revision, uncommitted-change fingerprint and build used for the session. Avoid changing the application during a test batch; record a new build when fixes are introduced.
- Launch a **separate disposable Granite profile**. Use two test agents, General, two Shared sections, a Closed section, a chat-only project and a project linked to a disposable folder. Keep each case's chats and canary files identifiable.
- Provide simulated **Chat Completions and Responses** connections. Support capacity one/two, held generation, delayed completion, partial output, transient errors, explicit host-busy errors, malformed output and requests that wait for a controlled release. Use stable fixture IDs and receipts to count actions.
- For tool-boundary cases, use native note reads/writes and a harmless controlled fixture tool where a longer execution must be held. Any fixture write stays within test data. The app must still perform its real approval and dispatch checks.
- Keep fixture-server controls outside the app process so request counts and receipts survive an app/worker crash. Bound waits in the test driver so a failed case can be diagnosed and cleaned up.
- Inspect configured hosted and LM Studio connections during the live-provider stage. Record unavailable providers as **not verified**, with the reason. Record request summaries without credentials.

## Execution order

1. Build/type-check and run the existing automated baseline once; record any pre-existing failures separately.
2. Run the deterministic desktop cases for a normal reply, steering and queues before introducing failures.
3. Exercise Stop, response failures, approvals, permissions and location changes at controlled boundaries.
4. Exercise clean quit, forced app/worker closure and renderer-only reload on disposable data.
5. Repeat protocol-sensitive cases with both adapters, then perform live-provider checks.
6. Finish with interface checks and a regression checkpoint. Retest failed cases and related boundaries after any authorized fix.

## A — Submission, streaming and persistence

| ID | Action | Expected result |
| --- | --- | --- |
| A1 | Open/abandon drafts; submit whitespace; double-click Send; repeat an already accepted request ID through the test boundary. | Drafts/whitespace create no chat or run. One submission creates one saved prompt and run. Repeated delivery of the same ID cannot duplicate work. |
| A2 | Send a simple prompt to a held streaming response; deliver several chunks, then a completion event. | Text is visible provisionally before completion. Controls/status reflect the active run. Completion occurs once, and the saved answer exactly matches received text. |
| A3 | Return visible text plus a valid tool proposal, then a tool result and a final answer. | The initial text does not finalize the run. The tool runs once after complete validation; its actual result reaches the next model request; the final reply completes the run. |
| A4 | Reopen a completed chat and restart the app. | Prompt, reply, IDs and tool outcomes remain intact. Reopening performs no model or tool request. Later conversation input preserves valid native history. |
| A5 | During generation, open another chat, a draft, another agent and a settings/file page; return to the original chat. | Work continues in its owning chat. Text, tools, errors and approvals never appear in another chat. Returning shows the full current reply without replaying the reveal animation or dropping text. |

Repeat A2–A4 for both protocols, including a Responses completion that supplies final text without text deltas.

## B — Steering and run boundaries

| ID | Action | Expected result |
| --- | --- | --- |
| B1 | Send “Make the button blue,” then “Actually, make it green” during held generation. | The next request includes both messages in order and retains the task. The same run ID continues. The obsolete generation cannot execute tools; any visible partial reply is marked interrupted, and the revised answer follows the steering message. |
| B2 | Submit several rapid corrections while generation is being cancelled and while the next request waits for capacity. | Every accepted message survives in arrival order. There is one current run and one waiting entry for its request; no correction is lost or replaces the original prompt. |
| B3 | Steer while a controlled tool is executing, then release that tool. Also steer between two proposed tools. | An already-started atomic action records its actual outcome. Unstarted obsolete actions are skipped and accounted for as not executed. The next request receives the corrections and real outcomes, without repeating the completed action. |
| B4 | Steer while an approval preview is pending; attempt to answer the old approval afterward. | The preview is withdrawn, the old action does not run, and its approval ID is rejected. A revised proposal needs its own preview and decision. The composer/navigation remain usable during the wait. |
| B5 | Control a message arriving immediately before versus immediately after finalization. | An accepted message before finalization is incorporated into that run. If finalization wins, the message starts a new run. Neither ordering drops the message or creates two simultaneous runs in the chat. |

For B2–B5, use explicit fixture release points rather than timing assumptions. Exercise both possible orderings of each race.

## C — Concurrency and queues

| ID | Action | Expected result |
| --- | --- | --- |
| C1 | With capacity one, hold A and submit B/C in other chats. Cancel B, then finish A. | B/C show positions 1/2, excluding A. Cancelling B changes C to 1; B never dispatches. C starts when the lease is released. |
| C2 | Append multiple messages to queued B. | Its queue entry and place are unchanged. All pending prompts reach its first request in order; no extra chat job is created. |
| C3 | Set capacity two and submit three chats. Repeat across two agents using the same connection, then with independent endpoints. | The shared resource's observed request count never exceeds its limit. Two eligible requests can run concurrently at capacity two. Independent resources do not wait behind each other. |
| C4 | Exercise the automatic local limit, remote default and a configured lower host limit; test supported local endpoint aliases. | Defaults match the accepted one-local/two-remote policy. A known lower limit wins. Aliases for the same recognized local endpoint do not bypass its queue. Verify remote default/key behavior with controlled scheduler evidence as well as available live hosts. |
| C5 | Hold A at a tool/approval boundary while B waits for the model; have A request another model step later. | Model capacity is released during tools/approval. B can start; A reacquires fairly for its next request. The waiting approval still belongs to A's active run. |
| C6 | Return an explicit supported host-busy response, then release capacity. Separately return a quota error and a generic temporary server failure. | Host waiting shows its reason and **position unavailable** unless a reliable rank exists. Quota failure is not an endless queue. A generic transient failure follows the single-retry rule. |
| C7 | Run a simulated task beyond the former short step/tool limit, yielding capacity to other chats between requests. Audit run settings/loop termination separately. | The healthy task completes without a whole-run deadline, step cap or total-tool-call budget. Other queued chats are not starved. Real operation/context/provider limits are still reported honestly. A finite test plus code inspection supports this check; it does not prove arbitrary duration. |

## D — Stop, retry and Continue

| ID | Action | Expected result |
| --- | --- | --- |
| D1 | Stop during streaming, reconnect delay, approval and a model-capacity wait. Cancel a never-started queued request. | The correct work stops/cancels, pending approval/retry callbacks become unusable, and capacity/positions update. Cancelled prompts remain visibly unprocessed. No late event revives the run. |
| D2 | Stop just before/after a steering message; submit a new prompt while the old run is stopping. | Stop wins for the old run. A later prompt gets a new run and waits for cleanup; it cannot restart cancelled work. |
| D3 | Complete a fixture note edit, then Stop during the next generation. | The edit remains, its completed outcome is recorded once, and partial text is not marked complete. No rollback occurs. |
| D4 | Fail a request transiently before response data, then succeed. Repeat with a second failure; separately fail after text or tool-call data. | At most one automatic retry occurs before data. A second failure or any failure after partial response data stops automatic replay and offers Continue. The UI leaves reconnecting/working state correctly. |
| D5 | Use Continue after an interrupted/failed reply and after a completed fixture action followed by connection failure. | Continue creates a new run with fresh validation, the original task, corrections, interruption markers and actual outcomes. Completed tools are not blindly replayed. A successful continuation ends normally. |

## E — Model-response validation

Run the following variants through both adapters. For each, inspect the visible outcome, saved status and state supplied to a subsequent request.

| ID | Response variant | Expected result |
| --- | --- | --- |
| E1 | Empty completed response; reasoning-only response; tool success followed by no final answer. | A visible incomplete/error result and Continue, rather than success or an endless regeneration loop. Completed actions remain visible. |
| E2 | Truncated output, disconnected SSE, missing completion marker, broken JSON stream or partial tool arguments. | Valid partial text is preserved as interrupted. No incomplete proposal runs or enters valid native call/result history. |
| E3 | A complete identifiable call with invalid JSON, schema mismatch or unknown tool; corrected proposal; then a separately repeated invalid proposal. | Invalid proposals do not execute. A matching error reaches the model and allows one correction. A repeated invalid proposal ends incomplete work; unstarted batch calls are explicitly accounted for. |
| E4 | Missing/duplicate/ambiguous call IDs, including a duplicate later in a batch or from earlier native history. | Validate the whole response's identifiers before the first action. No action from an invalid batch executes, and no completed action is replayed to fill a missing result. |
| E5 | Output/context limit, authentication error, unsupported model, quota error or provider error containing a fixture secret. | A clear appropriate failure, with no silent model switch, fabricated success or secret-bearing diagnostic. A subsequent valid run can recover without malformed native history. |

## F — Permissions, model binding and location

| ID | Action | Expected result |
| --- | --- | --- |
| F1 | Change terminal/skills/MCP eligibility while a model is generating; change again between proposals in a batch. | The next request uses eligible definitions, and each subsequent action checks current permissions. Newly forbidden actions do not run; an already-executing action is not automatically interrupted by the settings change. |
| F2 | Enable write approval after a proposal was generated; change settings during an existing approval wait. | An action that now requires approval cannot proceed without it. Old approvals become invalid and cannot authorize a changed action. Saving settings itself does not Stop the run. |
| F3 | Try to change the model/provider after the first prompt, including while it is still queued; change the saved connection's endpoint/model. | UI and backend preserve the chat's binding. No request silently uses a different model/provider. New chats can choose a different model. Supported reasoning-effort changes remain possible between runs. |
| F4 | Move a never-started queued chat between eligible Shared locations; then repeat with an active chat during streaming, approval and a later model wait. | An eligible queued move succeeds and uses its current location at dispatch. Started runs cannot move, including during approval or subsequent capacity waits. |
| F5 | Move queued work into a Closed section or a repository project before dispatch; attempt replies directly in those locations. | The current pass's availability notice appears. Revalidation prevents model/tool execution there, preserves the saved prompt, and does not leave an endless working state. |
| F6 | Update the disposable agent's memory file between model calls using a controlled external edit; separately edit identity mid-run, then start a new run. | Current eligible memory appears on the next request. Identity stays fixed for the existing run and updates on the next run. The app's own file editor still respects its documented active-run editing limit. |
| F7 | Concurrent native edits change two separate facts in the same memory/note file; attempt stale editing through the existing user editor. | Both independent changes survive. Current native mutations serialize, and the existing user-editor conflict boundary does not overwrite a newer file. |

F1 tests the prototype integrations already present. Full scoped MCP/discovery and repository permissions are later-pass requirements.

## G — Quit, crash and reload recovery

| ID | Action | Expected result |
| --- | --- | --- |
| G1 | Quit normally with active work, queued work and a pending approval, then reopen. | Work settles according to Stop behavior. Saved transcripts and completed fixture edits remain. There is no automatic dispatch and no misleading unexpected-crash notice for settled work. |
| G2 | Force-terminate only the disposable app while A is generating and B/C are queued. Repeat by terminating only its agent worker. | Interrupted work and never-started work are classified correctly. The recovery popup explains the outcome. Opening chats or dismissing it starts no requests. Queue positions are rebuilt only on an explicit restart. |
| G3 | After G2, click Run pending messages twice rapidly; separately cancel pending work and submit an unrelated prompt. | Restart accepts one new job with the original pending prompts in order. Cancellation preserves messages as unprocessed/cancelled and prevents the unrelated prompt from silently dispatching them. |
| G4 | Crash with a pending approval and after a completed fixture note edit. Retry stale approval IDs after reopening. | Old approvals cannot execute. The saved edit and actual outcome survive, while incomplete proposals are not replayed automatically. |
| G5 | Reopen twice; dismiss the recovery notice and reopen again. Also interrupt the recovery/startup sequence on disposable data. | No duplicate messages/jobs or repeated processing of recovered state. Dismissal persists. A second startup does not resurrect stopped jobs. |
| G6 | Reload only the renderer while streaming, queued and awaiting approval; switch chats afterward. | This does not restart the worker/run. Partial output, queue state and actionable approval controls are reconstructed without phantom jobs, missing text or stale decisions. |

Check request counts **before** clicking Continue/Run pending messages. A recovered-looking screen alone does not prove that nothing was dispatched.

## H — Desktop usability and regressions

- [ ] **H1:** Walk through every reachable Pass 2 state: preparing, streaming, queued, tools, approval, reconnecting, stopping, complete, error/interrupted and not-started-after-restart. Composer, sidebar badge and saved outcome agree.
- [ ] **H2:** Enter sends/steers; Shift+Enter adds a line; input-method composition does not submit accidentally. Stop/Cancel queued and the additional-message action remain distinguishable and usable.
- [ ] **H3:** New drafts, unrelated sections and agent/chat navigation remain available during other work. Approval waits do not trap the user away from steering or switching chats. Active location controls remain locked where required.
- [ ] **H4:** Inspect a narrow window, long names, long streamed output, inline approvals, recovery notices and keyboard focus. Check scrolling, truncation, visible buttons and absence of horizontal page overflow.
- [ ] **H5:** Recheck Pass 1's important paths: unsaved drafts, hierarchy/moves, editable Markdown, note renaming, sorting persistence and migration/reopen. Run the complete automated suite, type checking and build at the final checkpoint; packaging remains pass 6.

## I — Live-provider compatibility

After the controlled cases, use an available hosted connection and an available LM Studio/local connection through the actual desktop UI:

- [ ] **I1:** Text-only streaming, completion, persistence and a normal follow-up.
- [ ] **I2:** Steering during an answer; original request and correction remain meaningful.
- [ ] **I3:** Independent chats with capacity one/two where the host supports it; accurate queue/cancellation display.
- [ ] **I4:** One supported harmless tool loop, approval if applicable, and a final answer.
- [ ] **I5:** Stop and a fresh continuation; clear behavior when a host/model does not support a requested capability.

These checks establish interoperability, not whether a model always follows a prompt. Use deterministic fixture evidence to verify context order and dispatch guarantees. Record provider, model, protocol and configured concurrency. If a host advertises no reliable internal queue rank, expect position unavailable. If a provider is unavailable, preserve that limitation in the final report.

## Deferred rather than failed

Do not count the following as missing Pass 2 features: repository-project execution/reservations, repository process/crash reconciliation, full cross-chat retrieval/compaction, automatic managed memory, agent identity-edit approval, temporary creation/Keep/expiry, full container-deletion settlement, scoped optional-tool discovery, packaging or automatic file restoration. Their controls and data must remain consistent with the current availability limits.

Keep/move locks share a run-state boundary, but **Keep has no public temporary-chat flow yet**. Verify the active/movable state here and leave the actual Keep control and its timer races for pass 5.

## Recording results and completion

Use a result row per case/subvariant:

| Case/build/protocol | Result | Actual behavior | Evidence | Follow-up |
| --- | --- | --- | --- | --- |
| Not executed | Planned | — | — | — |

Allowed results: **Planned, Pass, Fail, Unavailable, Deferred**. A required behavior that fails is a failure even if another path succeeds. Unavailable live-host checks and later-pass cases must not be relabeled Pass.

For failures, record the shortest reproduction, expected/actual behavior, fixture release order, visible state, run/chat IDs, request/receipt count and relevant saved-state evidence. Keep screenshots/logs for failed cases and representative successful transitions. After any authorized fix, rerun the failure and its related boundary cases; rerun the final regression checkpoint if the fix affects shared behavior.

Mark broader Pass 2 verification complete when every required current-scope case has passing evidence, both adapter paths are covered, the desktop outcome agrees with request/state evidence, and no unresolved Pass 2 failure remains. State live-provider coverage explicitly; simulated coverage alone is not a claim that every real host/model combination has been verified.
