# Pass 2 Tests to Run Later

> Deferred by request on October 25, 2026. These are pending verification tasks, not future optimizations and not passing results.

Related: [[Pass 2 Verification Plan]] · [[Pass 2 Implementation & Testing]]

The current testing session covers basic replies, steering, queues, and Stop/Continue. Invalid responses, permissions, recovery, and real-provider compatibility are intentionally not exercised. Some earlier light checks touched these areas; they do not replace this pending verification.

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

## I — Live-provider compatibility

After the controlled cases, use an available hosted connection and an available LM Studio/local connection through the actual desktop UI:

- [ ] **I1:** Text-only streaming, completion, persistence and a normal follow-up.
- [ ] **I2:** Steering during an answer; original request and correction remain meaningful.
- [ ] **I3:** Independent chats with capacity one/two where the host supports it; accurate queue/cancellation display.
- [ ] **I4:** One supported harmless tool loop, approval if applicable, and a final answer.
- [ ] **I5:** Stop and a fresh continuation; clear behavior when a host/model does not support a requested capability.

These checks establish interoperability, not whether a model always follows a prompt. Use deterministic fixture evidence to verify context order and dispatch guarantees. Record provider, model, protocol and configured concurrency. If a host advertises no reliable internal queue rank, expect position unavailable. If a provider is unavailable, preserve that limitation in the final report.

## Overlapping subvariants still pending

- [ ] A4: restart the app after a completed conversation; verify saved/native history without dispatch.
- [ ] C6: quota failure remains a clear failure rather than endless host-capacity waiting (also E5).
- [ ] Broader invalid-response variants of Continue remain pending under E; only the selected network-disconnection and Stop/Continue paths passed in [[Pass 2 Focused Verification Results]].

## Other checks outside the selected session

- [ ] Full desktop usability/accessibility and Pass 1 regression sweep (H1–H5 in [[Pass 2 Verification Plan]]).
- [ ] Run the complete automated suite at the eventual broader acceptance checkpoint.

Record evidence and outcomes here when these checks are executed. Keep implementation optimizations in [[Things to Optimize]].
