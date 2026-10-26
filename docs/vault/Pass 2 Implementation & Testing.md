# Pass 2 Implementation & Testing

> Implemented October 25, 2026, with light verification requested by the user. The build, focused checks and a disposable desktop smoke check pass. Broader behavior and live-provider testing remain pending; this is not completion of passes 3–6.

Related: [[Harness Implementation Plan]] · [[Run Lifecycle Design]] · [[Concurrency & Limits]] · [[Restarted Queues & Timers]] · [[Pass 1 Implementation & Testing]]

## Available behavior

- Durable run records separate accepted messages, queued work, active work and final outcomes. A chat has one current run; messages submitted while it is queued append in order without creating another queue entry.
- A new message during active work steers the same run. Granite cancels the current generation, preserves its visible provisional text, keeps the original task and all corrections, and makes a new model request. Native call history excludes incomplete fragments. Completed tool results remain; unstarted obsolete calls receive explicit not-executed results.
- A steering message splits the displayed reply so the revised answer appears after the new user message. The execution retains one run ID. Steering withdraws a pending approval; stale approval buttons cannot apply the old action.
- Stop cancels the run and its pending model/retry work. A new message arriving after stopping begins belongs to a new run and waits for cleanup. Completed file edits remain. No whole-run duration, step-count or total-tool-call budget was added.
- Model capacity uses fair request leases shared across chats and agents. Defaults are one request per recognized local endpoint and two per remote connection/account. Connections can set **Concurrent model requests** to a lower or higher supported limit. Queues show their reason and live one-based position; tools and approval waits release model capacity.
- Explicit host-busy codes show **Waiting for host capacity — position unavailable**. Granite does not invent an internal host rank or classify every quota/HTTP error as capacity waiting. Generic transient request failures get one short retry before response data; partial output is not retried automatically.
- New chat drafts, section creation and agent/chat navigation are available while other chats work. Queued, never-started chats may move when their hierarchy permits it; started runs keep their chat location locked. Location and availability are revalidated before a queued request starts.
- The chat's model/provider binding is durable from acceptance of its first prompt, including a first prompt that queues. It includes the endpoint/account binding, so editing a connection cannot silently switch an existing chat's provider or model. Reasoning effort may change between runs as before.
- Changed tool settings apply before the next model request and again before each tool action, including after an approval wait. Saving settings invalidates pending approvals without stopping the run or interrupting an action already executing. Identity remains fixed within a run; current user memory is refreshed per request under the existing permitted scope.
- Native writes to shared agent memory/notes serialize their short mutations, so concurrent exact-text edits see the preceding writer's result. This does not provide full repository conflict protection or an external-process file snapshot.
- Empty answers, incomplete responses and invalid identifiers fail visibly and offer **Continue**. No incomplete call executes. Complete proposals with bad arguments receive one correction opportunity, while remaining proposals are accounted for as not executed.
- Continue creates a new run with reconstructed valid history and actual prior outcomes. It does not replay old tools automatically. Startup marks interrupted work stopped/interrupted, preserves never-started queued prompts as **Not started — Granite restarted**, and requires **Run pending messages** before dispatch. Pending requests can also be cancelled without deleting their messages.
- Startup provides a recovery popup. Dismissing it does not start work; the notice can be dismissed durably. Normal application quit asks the worker to stop and settle its jobs.

## Boundaries retained from the pass plan

- Closed-section and repository-linked project runs remain unavailable until their scoped context/repository passes. Repository-project reservations and process/outcome reconciliation arrive in pass 3. Temporary creation, Keep and inactivity timers remain pass 5; the active/queued state is now available for those controls.
- Full context-fit/compaction, cross-chat retrieval, automatic managed memory and approved identity edits remain pass 4. Scoped MCP and optional-tool discovery remain pass 5. The prototype's existing tools/skills remain available within their existing limits; integrations are paused for agents with Closed sections.
- Human memory/note/identity file edits remain blocked while that agent has started work. This preserves the existing editing boundary while unrelated chat navigation/creation is allowed. Agent tool-permission settings are editable during a run.
- Section/project deletion controls and full cancel-before-container-deletion remain pass 5. Existing chat/agent deletion still refuses affected live work; stop it first.
- Automatic file restoration remains deferred under D-067. Stop, failure and recovery keep completed changes.

## Light verification completed

- Production build, including TypeScript checking: passed.
- Eight focused lifecycle checks: FIFO/cancellation and local aliases; queued prompt ordering and allowed moves; active steering preserving the original request; approval waits releasing model capacity; malformed/empty output rejection; durable restart without automatic dispatch; one transient retry and Stop fencing; live permission refresh; shared memory edit preservation. Queue/steering assertions are grouped in one check, for eight checks total.
- Two existing renderer stream-state checks: passed. These check separation from the visible chat and rejection of stale request events.
- One selected existing Responses-protocol regression: passed, covering native reasoning/tool continuation, approvals, recovery and deletion. Its obsolete assertion that all settings changes must be blocked during a run was removed. The separate long-task regression was not run.
- A disposable Electron profile launched successfully and exercised the real preload, IPC and worker. The small desktop check streamed a provisional answer, opened another draft while it ran, showed a local-model queue at position 1, sent steering, and completed both chats. Three simulated model requests; no real provider or personal application data was used.
- The desktop screenshot was inspected. An initial reply-order issue was corrected: interrupted provisional text appears before the steering message, and the revised answer follows it. The normal completed-chat layout is usable.
- Whitespace/diff checks pass. The full application suite, packaging, real hosted/local models, forced application crashes and broad manual edge-case testing were not run in this pass.

Focused fixture checks needed local loopback access. Initial checks exposed and corrected a queue abort-listener omission and tool-schema compatibility; later fixture/header and selector failures were corrected before the passing results above. No failing check is being counted as passed.

## Focused verification — October 25, 2026

The requested follow-up session covered basic replies, steering, queues, and Stop/Continue. **34 desktop scenario/protocol combinations passed** (17 each for Chat Completions and Responses), along with five focused existing automated tests and a separate scheduler check. The build/type check passed. No application changes were needed.

See [[Pass 2 Focused Verification Results]] for tested behaviors, evidence, reproduction and limits. The executable desktop checks use isolated profiles and simulated servers, compare visible/saved/request state, and include real harmless fixture tool actions.

## Additional testing — deferred

Invalid responses, permissions, recovery and real-provider checks are now tracked in **[[Pass 2 Tests to Run Later]]**, separately from [[Things to Optimize]]. The broader desktop/regression sweep is also pending there. App-restart and quota-error subvariants remain in that backlog.

[[Pass 2 Verification Plan]] remains the complete specification. The focused results do not mark the full plan or broader Pass 2 acceptance complete.
