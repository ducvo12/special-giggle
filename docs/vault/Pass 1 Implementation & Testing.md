# Pass 1 Implementation & Testing

> Implemented October 25, 2026. Basic automated verification is complete; broader agent/user testing remains pending. This records pass 1 only, not completion of the six-pass harness plan.

Related: [[Harness Implementation Plan]] · [[Harness Design]] · [[Container & Settings Rules]] · [[Remaining Harness Decisions]]

## What is available

- Each agent has a built-in Shared General section. Existing flat chats migrate into it without moving their saved messages, changing their IDs or discarding provider/checkpoint state.
- Create and rename custom Shared/Closed sections and projects. A project stays in its parent section; General contains chats only. A Closed section can become Shared, with an explanation that this exposes the whole section and cannot be reversed.
- Browse chats nested under their sections and projects in the sidebar. **New chat** opens an unsaved draft in General; selecting a section/project opens a draft there. A breadcrumb shows the destination, and no database chat is created until a nonempty prompt is submitted. The chat options menu offers valid move destinations. Backend and database checks enforce the movement restrictions, including Closed-section boundaries and permanent repository-project membership.
- The sidebar is now a file explorer: an agent-switching header, `identity.md`, `memory.md`, tools & skills, expandable notes and sections, projects, and chats. The old Conversations/Workspace/Identity/management navigation screens are replaced by tree rows and compact dialogs. Agent options expose app connections/settings and file refresh; `+` controls create agents, notes, sections, projects or unsaved chats in their location.
- Markdown opens in rendered preview. Edit switches to a monospace editor with Save/Cancel and a keyboard save shortcut. Unsaved edits protect navigation, and a stale-content check preserves the user's draft instead of overwriting external changes. Human file saves are unavailable while an agent runs.
- A note's `…` menu offers **Rename note**. Renaming keeps it in its existing folder, preserves its contents, follows an open preview to the new filename, and rejects duplicate names without replacing another note. Core identity/memory filenames remain fixed.
- Explorer hover/selection backgrounds span the whole row, including its chevron, `…` and `+` controls. Selecting a saved chat highlights that chat alone; section/project location highlights are reserved for drafts in those locations.
- Sections and their contents/projects have persistent per-agent sorting: chat activity, alphabetical order or creation time, ascending/descending. Section activity includes its project chats. New chats retain an exact creation timestamp; migrated chats use the earliest saved message, or the old updated timestamp when empty, as an estimate. Renaming does not count as chat activity.
- Link an existing directory to a project using the native folder picker. It is recorded as a canonical path reference; code is not copied or modified. Existing chats become bound to that project. Different projects/agents may record the same directory.
- Stable section/project IDs determine storage paths. Renaming their display names does not move files. Agent storage now includes `sections/<section-id>/summary.md`, section `notes/` and `projects/<project-id>/`, and `tools/skills/`.
- Permanent/temporary retention and expiry fields exist in storage. Public creation remains permanent until expiry and memory restrictions are implemented.

## Deliberate limits of this pass

The broad run guard described below records the Pass 1 state. [[Pass 2 Implementation & Testing]] supersedes it with per-chat run state, model-capacity queues and navigation/creation during independent work.

- The pre-scheduler implementation still uses one broad active-run guard for workspace/organization changes. The New chat button and section creation are currently disabled during a run. This is a temporary implementation limit, not the target concurrency rule: independent chats may run or queue in pass 2, and opening a draft/creating an unrelated section should not require stopping another chat. Relaxing these guards is separate from the note-renaming change.
- General and Shared chat-only locations retain the existing chat functionality. Cross-chat retrieval and the full Shared/Closed memory policy arrive in pass 4.
- Closed-section and repository-linked project runs are unavailable in both the interface and backend. Their controls arrive in the later context/repository passes; the saved organization can already be tested.
- Section files are unavailable to the older agent-wide file and terminal tools. Existing MCP integrations are paused for an agent while it has Closed sections, with a reply notice, until scoped integration is implemented. Existing legacy skills remain intact; requested imports into the new tools location arrive in pass 5.
- Temporary-chat creation/expiry, missing-folder relinking, automatic duplicate-link detection/warnings and new section/project deletion controls arrive in pass 5. Existing agent/chat deletion continues to work and cleans up the new hierarchy records.
- Automatic restoration remains deferred under D-067. Completed edits remain after Stop or an interruption.

## Basic verification completed

- The pre-change baseline passed: 45 automated tests and type checking. Its simulated servers require local loopback access; tests were run with that permission.
- The updated suite passes: 57 tests, including migration/hierarchy constraints, chat moves/context-state invalidation, duplicate repository references, protected section storage, file-editing conflict/boundary checks, note-renaming persistence/collision/path checks, chat dates and every tree sort mode/direction.
- Type checking and the production build pass.
- A disposable actual Electron instance verified the preload/IPC/worker connection, hierarchy rendering, project navigation, creation of a chat in the selected project, and the Closed-chat availability notice. No real model was called.
- An initial hidden-window smoke run timed out. Repeating it with hardware acceleration/background throttling disabled and screenshot capture omitted passed; this is not recorded as a successful visual/layout review.
- Follow-up navigation regression: `npm run build` and `node scripts/verify-organization-desktop.mjs` pass. The disposable desktop check verifies repeated New chat clicks/abandoned drafts/blank submissions create no records, first prompts save to General or the explicitly selected section/project, and nesting/breadcrumbs follow chat moves. It makes three simulated model calls with no real provider.
- Explorer regression extends the same disposable desktop script to cover Markdown preview/edit/save, stale external writes retaining the editor draft, note creation, section creation/rename/sharing, project creation/settings, agent creation/switching, settings access, sort preferences and their persistence after reload. No real provider is called.
- Note renaming is checked through the actual note menu and dialog, including retargeting the open preview, preserving contents, rejecting a duplicate name, and editing the note after renaming. Creation-date sorting assertions allow equal timestamps; multiple section creations can share a millisecond.
- The desktop regression verifies full-row surfaces and transparent child controls for selected notes/chats and hovered agent, Notes, Sections, section and project rows. It checks that all controls lie within their highlighted row, and selecting a chat clears its parent section/project selection. Type checking/build and the desktop check pass for this follow-up.
- Desktop screenshots were inspected for the expanded tree and the Markdown editor at a 760 × 640 viewport; the editor fills the pane without horizontal page overflow. Very long labels and deep nesting still need broader hands-on testing.

The automated migration checks cover both the legacy Atlas path and an existing second agent. Existing identities, memories, notes, messages, graph IDs and native continuation state survive repeated reopen. The new tests also check unsafe storage paths, ownership mismatches, stale source-context invalidation on moves and failed attachments retaining chat-only state.

## Additional hands-on testing — pending

Use disposable test sections/projects/folders for these checks. Restart the development app to load the updated main process, worker and migrations.

- [ ] Confirm existing chats appear under General and their messages, identity and memory remain unchanged.
- [ ] Create one Shared and one Closed section. Create a project in each; check General has no project-creation control.
- [ ] Rename a section and project. Restart Granite and verify names, IDs, membership and stored content remain consistent.
- [ ] Click New chat repeatedly; verify no empty chats appear and the breadcrumb shows General / New chat. Select a section/project and verify its unsaved draft is saved there only after submitting a prompt.
- [ ] Move a Shared chat between valid locations. Verify its transcript stays intact and the destination becomes selected.
- [ ] Check that a Closed chat cannot move out of its section. Convert the disposable section to Shared and check its eligible destinations become available.
- [ ] Link a disposable folder to a project containing chats. Check its path is shown, existing chats cannot move out, outside eligible chats can move in, and the folder's contents remain untouched.
- [ ] Link the same disposable directory to another project/agent. It must be allowed; automatic duplicate-warning detection is still pending in pass 5.
- [ ] Confirm Closed/repository-linked chats show their current availability limit, and ordinary General chats still work with the existing configured model.
- [ ] Check tree dialogs and the move menu with very long names and deeply nested notes.

Record additional findings here before starting pass 2. Passing these basic checks is not a claim that later-pass features or every platform/provider combination are complete.
