# Pass 2 Focused Verification Results

> October 25, 2026 — **selected checks passed**. Scope: basic replies, steering, queues, and Stop/Continue. This is not full Pass 2 acceptance.

Related: [[Pass 2 Verification Plan]] · [[Pass 2 Implementation & Testing]] · [[Pass 2 Tests to Run Later]]

## Environment and outcome

- Tested the working-tree build on `main`, based on commit `eaf229b`, with Pass 2 still uncommitted. The production build and TypeScript check passed before desktop execution.
- Used the real Electron window, renderer controls, preload, IPC, agent worker and saved conversation state. Two isolated disposable profiles were used, one per protocol. Personal chats and real connections were not used.
- Simulated both **Chat Completions** and **Responses**, using external local servers with controlled generation, completion, tool, host-capacity, network-disconnection and retry boundaries. These are transport/harness checks, not evidence of real-model obedience or interoperability.
- Final desktop run: **34 passing scenario/protocol combinations, zero failures** — 17 scenarios on each protocol, with 96 model requests in total (47 Chat Completions, 49 Responses). Scenario groupings include multiple assertions and overlap original plan IDs; this does not mean all 50 cases in the broad plan are complete.
- Five focused existing automated tests passed: four selected lifecycle tests plus the 45-tool-step regression. A separate controlled scheduler check also passed.
- Compared request inputs, tool outcomes, saved messages/run snapshots and visible output. The final desktop runner waits for completed answers to finish rendering and compares their visible text with saved text. Inspected representative screenshots for queue positions, stopped output/Continue, steering order and completed edits.
- No application defect was found in this selected coverage. No application source files were changed. Initial attempts exposed test-driver startup/selector/result-shape assumptions; those were corrected in the driver before the final passing run.

## Desktop results

Every row below passed on both protocols.

| Scenario | Plan coverage | Verified behavior |
| --- | --- | --- |
| Drafts, blank input and double submission | A1 | Abandoned drafts/whitespace create no chat/run. Double-click produces one prompt/request. Repeating an accepted request ID is rejected without another request. |
| Streaming, saved answer and chat reopen | A2, A4 except app restart | Provisional text appears while the run is active; chunks persist exactly; opening another draft and returning makes no new model request. A follow-up receives the saved answer. Responses final-text fallback without deltas also works. |
| Text → tool → final answer | A3 | Provisional text does not finalize the run. One real fixture-note write completes, its result reaches the next model request, and the final answer completes. |
| Navigation and isolation | A5 | Switch drafts, agents, file view and back during generation. Background work remains in its owning chat and the full result reappears. |
| Active steering and rapid corrections | B1, B2 | Original blue-button task and green/round/small corrections arrive in order. One run continues; final reply follows the latest user message. Obsolete output is excluded. |
| Steering during tool execution | B3, C5 | A sandboxed fixture command waits at a file barrier. Another chat can use model capacity meanwhile. Steering preserves the executing command's actual outcome and skips the unstarted second action. |
| Steering during approval | B4, C5 | Another chat finishes while approval waits. Steering withdraws the preview; stale approval is rejected and the obsolete write never occurs. |
| Before and after completion | B5 | A correction before completion stays in the run; a message after completion starts another run. No prompt disappears. |
| Queue order, cancellation and appended prompts | C1, C2 | Positions 1/2 exclude active work. Cancelling position 1 moves position 2 to 1. Cancelled work never reaches the server; appended messages preserve one run/place and dispatch together in order. |
| Capacity two and independent hosts | C3 | Two agents can issue two requests to the same capacity-two host; the third queues. An independent endpoint starts immediately. The third request starts after a lease is released. |
| Steering/Stop during a later model wait | B2, C5, D1 | A started run releases capacity after a tool response and waits behind another chat. Multiple steering messages survive that wait. A separate run stopped in the same state never dispatches its next request. |
| Host busy and one automatic retry | C6 selected variants, D4 | Explicit busy response shows position unavailable and later succeeds. A generic pre-data transient failure retries once; a second failure ends visibly with Continue. |
| Stop streaming and Continue | D1, D5 | Partial text remains interrupted; Stop does not revive the old run. Continue starts a new run with the original task and interruption context. |
| Stop during retry/approval | D1 | Stopping in retry delay prevents a second attempt. Stopping pending approval executes no write or model continuation. |
| Completed edit survives Stop/Continue | D3, D5 | A successful note write remains after Stop. Continue receives the prior outcome and does not repeat the action. |
| Network disconnection after an action | D4, D5 | Saved edit/partial output survive a disconnect. No automatic retry after response data. Continue receives the original task and completed result and performs no duplicate write. |
| Stop/steering and new prompt during cleanup | D2 | Accept a correction, initiate Stop, and submit a new prompt without waiting for cleanup. The old reply ends stopped; the new run completes separately with the new prompt. This precise boundary uses the public preload/IPC bridge rather than click timing. |

For tool-execution timing, the runner uses a harmless command inside the disposable agent workspace. No repository tools, repository edits or real credentials are involved. Approval settings are seeded before testing; live permission changes are outside scope.

## Supporting checks

| Check | Result |
| --- | --- |
| Production build and TypeScript | Pass |
| Existing scheduler FIFO/cancellation/local-alias test | Pass |
| Existing queued prompt ordering and active steering test | Pass |
| Existing approval releases capacity/steering invalidates old action test | Pass |
| Existing one-retry and Stop-fencing test | Pass |
| Existing Responses long-task regression: 45 tools, 46 requests | Pass |
| Controlled scheduler defaults/limits | Pass: local default 1, remote default 2, configured lower limit, alias sharing, remote capacity bound, FIFO and position updates |
| Loop inspection for whole-run budgets | No optional duration, step-count or total-tool-call budget found in the runtime/loop. The finite 45-step test is supporting evidence, not proof of unlimited duration. |

## Evidence and reproduction

Reusable desktop runner: `scripts/verify-pass2-selected-desktop.mjs`.

Final evidence directory:
`/var/folders/p9/m26dt3sj2_s59n7tbqp8r82r0000gn/T/granite-pass2-selected-eYnigT`

It contains:

- `results.json`: final scenario/protocol results and request counts.
- `build.json` and `source-manifest.json`: base revision, tracked-diff fingerprint and hashes of 96 application/configuration/runner files, including untracked Pass 2 source files.
- `desktop.log`, `backend.log`, `long.log`, `capacity.log`: execution results.
- Per-protocol `requests.json`, `events.json`, per-scenario saved-state snapshots and screenshots, including queue/approval/stopped states.
- Disposable profiles with their fixture chats and note files.

The evidence directory is temporary and may be cleaned by the operating system. This note preserves the durable result summary. The runner creates fresh isolated profiles on each execution and leaves evidence for inspection.

## Explicit limits and remaining checks

- Invalid-response/schema/identifier validation, permission changes, recovery/restart behavior and real providers were not broadly tested. They remain in [[Pass 2 Tests to Run Later]]. The network-disconnection variant above belongs to selected Stop/Continue coverage and does not complete the broader response-validation matrix.
- A4's app-restart subvariant and C6's quota-error subvariant overlap deferred recovery/provider-error tests and remain pending.
- The broad desktop usability/accessibility/Pass 1 regression sweep and complete automated suite were not run.
- Controlled before/after and queue/tool boundaries were tested; exhaustive race fuzzing and arbitrary-duration load testing are not claimed.
- Do not mark all of Pass 2 verified from this selected session. Later-pass behavior and [[Things to Optimize]] are separate from this test backlog.
