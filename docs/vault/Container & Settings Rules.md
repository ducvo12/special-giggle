# Container & Settings Rules

> Accepted v0.1 lifecycle/settings specification, consolidated October 29, 2026. Full project/section deletion, missing-folder relinking and duplicate-link warnings are pass 5. Basic agent/chat deletion already exists but currently requires work to finish; cancel-and-delete and derived-source cleanup are not complete. Pass 4 owns memory refresh; existing run/settings controls are covered by passes 1–3A.

Related: [[Harness Design]] · [[Harness Implementation Plan]] · [[Memory & Context Policy]] · [[Run Lifecycle Design#Queues and capacity]] · [[Tools & Permissions#Skills]] · [[Tools & Permissions#Core tools and optional discovery]] · [[Decision Register]]

Start visually: [[Container & Settings.canvas]] · [[Repository Access.canvas]] · [[Memory & Context.canvas]]

## Delete the container and its contents

Deleting a project, custom section or agent deletes its actual Granite-owned folder tree and all its descendant chat records in the database. A section includes its projects and direct chats; an agent includes all its sections, projects, chats, memory, notes and installed agent-local skills. General remains individually undeletable, but is removed with its parent agent.

Delete associated summaries, indexes, provider continuation state and other owned data, and apply D-029 to references in surviving content. Other chats are not recursively rewritten or deleted. Independently supported facts can remain.

Folder deletion follows physical storage: code physically inside the deleted folder is deleted too. A repository linked to a folder elsewhere is not deleted by removing the attachment/container. Do not traverse a managed reference or symlink to delete an external target. If another project links an internally stored repository that is deleted, its link becomes unavailable and uses the missing-folder warning below.

Reuse the existing deletion sequence: prevent new descendant work, cancel queued work/approvals, Stop active runs and settle their writers before removing files/data. D-067 preserves completed external-repository edits from both the active and earlier runs; no rollback precedes deletion. Do not discard an unresolved recovery record or report successful deletion when cleanup is incomplete. Durable transaction/retry mechanics are implementation details.

## Current memory and notes — pass 4

User/agent edits have equal standing; refresh eligible current files on every model request with revision guards. No stale cached author preference and no automatic interruption to inject edits. Removing a line does not erase historical evidence or establish permanent suppression. Full rules and source-deletion semantics: [[Memory & Context Policy]].

## Missing folders and relinking

When a linked folder cannot be reached, show a Granite warning that the folder cannot be found and offer **Relink folder**. Reads/edits that require it return a useful unavailable-folder result; ordinary chat can still work. Do not silently create an empty folder at the missing path or substitute another repository.

The user may select the same codebase at a new path or a different codebase. This explicitly relaxes D-016's immutable-attachment rule for missing-folder recovery. Each project still has at most one current attachment, cannot detach back to chat-only, stays in its section, and keeps its bound chats. Unrestricted switching of a still-reachable attachment is not added by this recovery flow.

Relinking commits after affected active work/writers have settled; it does not retarget an in-flight edit or process. Save a new attachment revision and refresh path permissions, file indexes and repository-specific cached state. Operation/diff records remain bound to their original resource; never replay old actions into the new folder. Preserve genuine unresolved outcome information. D-067 defers restoration and its undo journal entirely.

Keep chat history, but include an explicit repository-change notice on the next request. Re-orient using current files before editing. Old chat references can remain useful history, but do not establish what exists in the new repository. A mismatched history is a context issue, not permission to invent paths or replay old actions.

For a failed first attachment/creation, report the failure and retain a usable chat-only project until registration succeeds. Do not delete an existing user folder as cleanup. A dedicated staged creation/registration operation can clean up only files it demonstrably created; ordinary repository writes become available after attachment succeeds.

## Duplicate links are allowed with a warning

Store linked folder paths and project identities. Normalize paths sufficiently to warn when another project already links the same physical folder; link registration must not fail merely because a duplicate exists. Explain that independent agents/runs may conflict when editing together. Apply the same warning to evident overlapping/nested writable folders; sophisticated worktree/alias detection is later optimization.

Keep one active run per chat and serialize repository-capable runs within the same project. The first version does not impose a unique owning project or a global scheduling lock across separately linked projects. This revises D-024/D-052's cross-project ownership guarantee. Conflict checks remain required, but simultaneous writes can still conflict. Stop keeps completed edits under D-067. Do not overwrite another writer or claim that a warning guarantees safe concurrent work. D-057's block on known unresolved affected writes still applies through known aliases; linking the same folder elsewhere cannot bypass recovery.

Each attachment grants access through its own project/section rules. A Closed attachment cannot hide physical files that the user also attached through an eligible Shared project; the same files can be read through that Shared attachment. Conversation/memory privacy remains separate. Generic tools still cannot expose Granite's protected database/configuration/context storage through an attached ancestor folder.

The user's future exception for coordinated delegated subagents is recorded for later design. There are no subagents in version one; a relationship alone would not eliminate same-file conflicts. Cross-project coordination, optional isolation and coordinated subagent scheduling are tracked in [[Things to Optimize]].

## Fixed model and permission changes

The selected model/provider stays fixed within a session; do not switch automatically or expose a mid-session model switch. For this specification, session is interpreted as the existing chat/model session, not the lifetime of the Granite process. A different model starts a separate session; migration of an existing session across providers is deferred. Endpoint outages/capacity limits use the existing queues and failure behavior.

Permission changes do not automatically Stop a run or cancel a tool already executing. Recompute eligible context/tool definitions before the next model request. Recheck current permissions immediately before every tool action: a newly prohibited action is denied even if the model proposed it using the previous request's schemas. Later actions in a batch are checked individually. Do not interrupt an already-started action merely because its setting changed; the user can Stop for immediate interruption.

Permission grants do not substitute for a required Keep/project move or an exact-action approval. Keep/move still occur between runs; identity edits retain their next-run personality timing. Closed-to-Shared conversion makes newly permitted data eligible on the next request/read without cancelling current work. Refresh affected caches. Data already sent to a model cannot be retroactively withdrawn by changing settings.

## Skills and tool lookup — pass 5

Requested package imports, resource preservation, compatible loading, scoped MCP and compact-core optional lookup are specified once in [[Tools & Permissions]]. Existing user-managed skills are not the completed package importer.

## Later repository extension — v0.2

[[Repository Access & Worktree Plan]] retains attachment/no-release and missing-folder rules, but adds same-section project grants and isolated worktree groups. Worktree closure after merge is distinct from project deletion. Grant lifetime, workspace cleanup and parent-deletion implications remain choices there; they do not alter the v0.1 rules above.

## Observable acceptance cases

- Deleting a section removes its project folders and descendant chats; an externally linked repository survives, while an internally stored repository is removed with its folder.
- Editing permitted memory between two model requests makes the second request use the current version; Closed and Temporary restrictions still apply.
- A missing folder produces a warning. Relinking to a different codebase retains the chat but refreshes repository state and supplies a change notice before new edits.
- Two projects can link the same folder after a warning. Runs within one project queue; distinct projects can run concurrently, with conflicts reported rather than overwritten; Stop retains completed edits.
- Disabling a write tool while generation is underway does not cancel generation, but blocks that tool if proposed afterward; an already-executing action is not automatically interrupted.
- A requested skill import preserves its resources under the agent's tools folder and does not execute installation scripts merely by downloading them.
