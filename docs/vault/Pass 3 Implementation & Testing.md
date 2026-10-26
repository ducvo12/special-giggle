# Pass 3 Implementation & Testing

> Implemented October 25, 2026. Repository tools, access enforcement, project scheduling, visible changes and repository-aware recovery are available. The build/type check and 86 automated checks pass; a disposable desktop walkthrough also passed. This is implementation and basic verification, not exhaustive manual acceptance of every edge case.

Related: [[Harness Implementation Plan]] · [[Repository & Context Tools]] · [[Tool Permissions]] · [[Unexpected Closure Recovery]] · [[Things to Optimize]]

## Available behavior

- Shared repository projects now run through Granite's normal model loop. Every run reserves its own project, including text-only questions, and waits with a visible reason/position when that project is occupied. The model-capacity lease remains separate. Different projects can run concurrently even when they reference the same physical folder; no global repository lock has been introduced.
- Tools list permitted repositories/directories, search filenames or literal text and read bounded ranges. Scope is computed from current chat membership and checked again at execution. Shared repositories are readable within their agent; Closed repositories are visible only within their own section. Other agents' repositories remain unavailable. Closed-section runs themselves still await isolated context in pass 4.
- A permanent repository-project member receives create/replace (text or base64), exact edit, single-file unified patch, file rename and delete operations bound to that project. These ordinary edits do not require per-edit approval, even when agent note-write approval is enabled. Outside chats receive only read tools and Git inspection schemas.
- Existing-file mutations require a revision obtained by reading the file. Stale content is rejected, with one corrected stale-edit attempt before the harness reports incomplete work. New files use exclusive creation; replacements check again before atomic publication; renames do not overwrite an existing destination. These are conflict guards, not an operating-system lock against arbitrary external writers.
- Repository paths reject traversal, metadata access, symlinks, special files, hard-linked regular files and protected application storage. Generic agent file/terminal tools cannot traverse section/project storage as an alternate repository route. MCP integrations are paused for agents with repository links until scoped integrations arrive; a generic MCP approval does not grant repository access.
- The native Git tool supports status, unstaged/staged diffs, log/show, initialization, staging, commit, branch/switch, restore, mixed reset, selected-file clean and push. Mutations require membership and an exact-action approval or a recognized bounded grant from direct user messages. Grants persist through steering unless revoked. A requested commit covers staging; unclear intent/targets fall back to a preview. Repository/skill/tool text cannot grant authorization. Hooks, external diff helpers, filesystem monitors and commit signing are disabled in these operations.
- Repository command tools run local tests/builds/formatters and other local commands when terminal access is enabled. Network access is denied unless explicitly authorized for the stated command. Authorized external actions are not treated as reversible local edits.
- Project settings can link an existing folder or create a first repository folder in the project's internal storage. The native Git tool can initialize that folder when requested. Replacement/relinking and missing-folder controls remain pass 5.
- An outside chat may ask to edit a readable repository. Granite records a project-entry proposal, asks the user to confirm the permanent move, and waits until the run finishes before enabling that move. Only successful project entry enables writes. Declining leaves reads available.
- Repository runs capture original file contents durably before their first edit and retain a changed-file record. Chat startup and native source-file edits do not scan unrelated dependencies. The UI shows changed files, added/removed text lines, inspectable Git-generated diffs, exact-content renames, binary/large-file notices and Git-state changes. Unchanged pre-existing edits are excluded. Changes to touched files by concurrent external writers may appear in the observed delta; this is not a claim of exclusive authorship.
- Stop and failure retain changes already applied to the live repository. Interrupted operations are not replayed. Pending command records survive worker/app closure, and recovery settles known process groups, reconciles current files and shows the existing recovery popup. Genuine unknown external/Git outcomes block further work on that physical repository, including separately linked aliases until rechecked/reviewed. Deleting a chat/agent cannot erase its unresolved recovery record; settled records are deleted with their owning data.

## Command isolation and publication

A process-group cancellation test demonstrated that a command can detach a child into another session. Group cancellation alone cannot guarantee the live repository is safe from that child.

Commands therefore run in a **temporary repository copy**, inside the macOS sandbox, with process-group cancellation and a parent-liveness supervisor. The supervisor receives a start signal only after its PID/token has been durably recorded. Parent death closes the liveness pipe. A detached child still has no write access to the live repository.

After a command finishes, Granite first checks all candidate live paths against the pre-command revisions. It then applies changed regular files with the same guarded mutations used by file tools. A failed command with a normal exit can still publish its actual file changes; a stopped/timed-out/uncompleted command copy is not applied. If copying back is interrupted, already applied files stay and remaining files are not silently replayed. Authorized Git operations copy metadata objects before references/indexes and retain an attention state if reconciliation is interrupted.

This is staging of command effects, not rollback: no inverse patch, reset, restoration snapshot or undo journal is added. Native file edits and completed command imports already applied to the live repository survive Stop/crash. Temporary copies can make command execution slower; optimize after the core behavior is validated.

## Structure and reuse

- Repository access/path checks, manifests/diffs, durable records, guarded file sessions, isolated command copies and process supervision live in separate modules under `src/backend/repositories/`.
- Repository schemas/adapters live in `src/backend/harness/tools/repository.ts`, using the existing validated tool registry and loop. Granite keeps its membership, approval and cancellation policy; Git handles unified patches/diffs/Git mechanics. Existing Deep Agents file tools remain in place and supply permitted external ranged reads.
- Project reservations reuse the same FIFO resource-lease implementation as model scheduling. Shared repository/report types, worker/IPC/preload routes and focused React components connect the backend to the current app structure.
- A regression check also found an existing optional concurrency-field serialization mismatch in saved connections. Public connection objects now omit an unset optional limit consistently before and after reload. The separate model-catalog work and personal Obsidian layout were preserved.

## Verification completed

- October 26 follow-up: reproduced a live ChatGPT/GPT-6.1-Sol folder-listing failure. The subscription stream emitted a completed `repo_list` item but an empty `response.completed.output`; the adapter discarded the streamed call and reported no answer. It now falls back to completed streamed items in output order when the completion envelope is empty or omitted. Added regression coverage for repository-tool continuation, final messages without text deltas, unfinished fragments, incomplete items, disconnection and malformed output. Build and eight focused response/context tests pass; the same live prompt now completes through Granite in a disposable project.
- Production build and TypeScript check passed.
- Full existing-plus-new automated suite: **86 passed, zero failed** at the recorded checkpoint.
- Repository tests exercise file operations (including Git-applied patches and binary replacement), stale protection, run-local diffs, section/agent/member scope, nonexistent/symlink/protected paths, command output import, cancellation, Git metadata protection and detached-child confinement.
- Native Git tests initialize a disposable repository, stage/commit under an existing direct-user grant, check real Git history and verify a pre-commit hook did not execute.
- Concurrent command/live-edit testing verifies that a newer user file survives and no other command-generated file is imported when the preflight detects that conflict.
- Runtime simulated-model tests cover actual read/edit tool loops without per-edit prompts, outside-chat rejection of remembered write names, project-entry proposals, one stale-edit correction, same-project queues and separately linked projects running concurrently.
- Recovery-record checks verify that unknown external effects block work/deletion until review and that review does not restore or repeat file edits.
- A disposable Electron walkthrough exercised real renderer/preload/IPC/worker behavior: project editing and visible +1/−1 diff; outside-chat request → confirmed permanent move; confined command and imported generated file; project queue released by Stop; actual worker termination during a command, popup/recovery, retained completed native edit, no unfinished command output in the live repo and no automatic model replay. Representative screenshots were inspected.

Reusable desktop check: `scripts/verify-repositories-desktop.mjs`.

Evidence/logs:

- `/tmp/granite-pass3-build.log`
- `/tmp/granite-pass3-all-tests.log`
- `/tmp/granite-pass3-focused.log`
- `/tmp/granite-pass3-repository.log`
- `/tmp/granite-pass3-desktop.log`
- `/var/folders/p9/m26dt3sj2_s59n7tbqp8r82r0000gn/T/granite-repository-ui-AujItx` — disposable profile, request capture and screenshots.

Outer-sandbox loopback/Seatbelt restrictions caused initial test-launch failures; checks requiring those capabilities were rerun with the necessary access. Other initial failures were corrected before the passing results: strip-only TypeScript constructor compatibility, rename checks during the temporary hard link, empty Git metadata directories on initialization, older schema/repository-gating test assumptions and optional connection-field normalization. These initial failures are not counted as passes.

## Current limits and further user verification

- Scoped command execution currently requires macOS `sandbox-exec`; repository Git/diff/patch tooling uses the system Git. Git tools require a real local `.git` directory, so worktree metadata pointers are not supported yet. Global credential/configuration files are not made available to commands; use configured repository-local Git identity, and expect authentication-dependent remote actions to need further integration.
- Complete command tracking is bounded to 25,000 filesystem entries and 128 MB of working files, with an equivalent metadata bound for Git copies. These whole-tree limits apply when running commands, not when starting chats or making native edits to other source files. Text reads/native tool writes are limited to 1 MB per file. Larger generated files can be imported by finished commands but have a large-file notice rather than invented inline diff counts. No whole-run step/time/tool budget was added; each command has its own two-minute limit.
- Command-created symlinks are not imported. Commands which rely on original absolute working paths or external caches may require adaptation to the isolated copy. File permission/executable-bit changes are tracked and imported; empty-directory creation/removal is also imported, with nonempty concurrent directories preserved. File/directory replacement within one command is rejected for explicit review.
- Atomic per-file revision checks do not claim a cross-process filesystem transaction. Same-project serialization is enforced; separately linked projects and manual tools can still race. Broad filesystem race/load testing, more Git operations/remote configurations, actual project tests/builds and real-model use should receive additional user/agent testing.
- Closed/temporary execution and scoped context/memory/integrations retain their later-pass availability boundaries. Automatic rollback, sophisticated large-repository packing and cross-project coordination remain outside this pass.

## Additional verification checklist

- [ ] User walkthrough with a small real project: native edits, command/build outputs, visible diffs, Stop and Continue.
- [ ] More destructive Git fixtures (restore/reset/clean/switch), declined/revoked grants and interrupted metadata import.
- [ ] Larger generated outputs, additional executable/permission cases and empty-directory behavior.
- [ ] Additional whole-app closure/startup interruption races, detached background workloads and manual same-file edits at publication boundaries.
- [ ] Real hosted/local models and configured authentication-dependent remote operations when available.

Pass 2's separate [[Pass 2 Tests to Run Later]] remains pending; these results do not relabel its skipped categories complete.
