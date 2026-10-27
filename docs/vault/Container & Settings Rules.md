# Container & Settings Rules

> Agreed user direction, October 25, 2026 (D-059–D-066). This is a target specification, not implemented functionality. The engineering consequences below apply the existing Stop, scope and source-deletion rules; they do not introduce subagents or change the no-budget policy.

Related: [[Harness Design]] · [[Remaining Harness Decisions]] · [[Memory & Context Policy]] · [[Concurrency & Limits]] · [[Skills & MCP Policy]] · [[Tool Selection & Context]] · [[Decisions & Questions]]

Start visually: [[Container & Settings.canvas]] · [[Repository Access.canvas]] · [[Memory & Context.canvas]]

## Delete the container and its contents

October 27 extension: [[Repository Access & Worktree Plan]] (D-070–D-072) explicitly retains the attachment/no-release, bound-chat and missing-folder rules below. It adds same-section project edit grants and isolated worktree groups; its workspace scheduling replaces the blanket same-project serialization baseline where isolated groups are involved. Worktree-group closure after successful merge is distinct from deleting a project. Group-history retention and managed-workspace cleanup/parent-deletion details remain labeled design choices; do not infer a new deletion policy from physical sidebar nesting.

Deleting a project, custom section or agent deletes its actual Granite-owned folder tree and all its descendant chat records in the database. A section includes its projects and direct chats; an agent includes all its sections, projects, chats, memory, notes and installed agent-local skills. General remains individually undeletable, but is removed with its parent agent.

Delete associated summaries, indexes, provider continuation state and other owned data, and apply D-029 to references in surviving content. Other chats are not recursively rewritten or deleted. Independently supported facts can remain.

Folder deletion follows physical storage: code physically inside the deleted folder is deleted too. A repository linked to a folder elsewhere is not deleted by removing the attachment/container. Do not traverse a managed reference or symlink to delete an external target. If another project links an internally stored repository that is deleted, its link becomes unavailable and uses the missing-folder warning below.

Reuse the existing deletion sequence: prevent new descendant work, cancel queued work/approvals, Stop active runs and settle their writers before removing files/data. D-067 preserves completed external-repository edits from both the active and earlier runs; no rollback precedes deletion. Do not discard an unresolved recovery record or report successful deletion when cleanup is incomplete. Durable transaction/retry mechanics are implementation details.

## Current memory and notes are authoritative saved content

Manual edits and agent edits have equal standing. Current eligible file contents are the saved memory/notes to consult on each model request; do not favor an older cached version because the agent wrote it. Refresh revisions before assembling the next request, including later requests in the same run. A request already in progress is not cancelled to inject an edit.

This preserves Shared/Closed/Temporary access limits and the bounded context policy. Load the current permitted memory view and use the current notes/catalog when selecting relevant notes; it does not require inserting every large note in full or opening Closed files. A changed note must not be represented by a stale cached excerpt. Notes and memories supply facts/preferences, not new tool permissions, and live repository observations can reveal that an old note is outdated.

Use the same revision/conflict checks and source-cleanup rules for both authors. Provenance may remain for source tracking, but author type does not give one edit priority over another. Current explicit corrections supersede contradictory old remembered facts. Removing text does not erase the historical chats that contain it: do not restore it simply from a stale cache, but later eligible evidence may legitimately cause a new memory update. Permanent suppression of a fact across surviving sources is outside the agreed deletion promise.

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

## Skills and tool lookup

Agent-assisted installation of an identified existing skill package is allowed. A clear user request supplies authorization without a second install confirmation. Store packages under `agent/tools/skills/<skill-name>/`, retaining `SKILL.md` and bundled resources; this is the planned layout, not a claim about the prototype. Loading, dependency execution and MCP permissions remain separate. Details: [[Skills & MCP Policy]] (D-065).

Use the Codex-style pattern of a compact direct core and discovery of optional integrations, with a simple portable lookup for providers without native discovery. Filter the catalog by current permissions, and recheck execution. This accepts P-016 as the initial design rather than promising identical discovery internals across Codex versions/providers. Details and source evidence: [[Tool Selection & Context]] (D-066).

## Observable acceptance cases

- Deleting a section removes its project folders and descendant chats; an externally linked repository survives, while an internally stored repository is removed with its folder.
- Editing permitted memory between two model requests makes the second request use the current version; Closed and Temporary restrictions still apply.
- A missing folder produces a warning. Relinking to a different codebase retains the chat but refreshes repository state and supplies a change notice before new edits.
- Two projects can link the same folder after a warning. Runs within one project queue; distinct projects can run concurrently, with conflicts reported rather than overwritten; Stop retains completed edits.
- Disabling a write tool while generation is underway does not cancel generation, but blocks that tool if proposed afterward; an already-executing action is not automatically interrupted.
- A requested skill import preserves its resources under the agent's tools folder and does not execute installation scripts merely by downloading them.

These choices close the four main remaining behavior groups. Exact storage/transaction mechanics, warning wording, passive temporary-chat UI event classification and advanced coordination are implementation defaults or explicitly deferred optimization; no additional broad behavior review is required before drafting the implementation plan.
