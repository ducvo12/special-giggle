# Memory & Context Policy

> Memory/context baseline selected under the user's delegation and then explicitly accepted by the user. These are planning decisions, not implemented behavior. Algorithms, storage strategies and budgets may be revised after evaluation or new research. The deletion boundary is agreed below; detailed cleanup mechanics remain to design.

Related: [[Harness Design]] · [[Memory & Context.canvas]] · [[Decisions & Questions]] · [[Things to Optimize]]

Concrete retrieval/tool exposure is agreed in [[Repository & Context Tools]] · [[Context Retrieval.canvas]] (D-058, accepted from P-017): separate repository read/write capabilities and native scoped list/search/read operations with bounded source-linked results. Exact tool names remain illustrative.

## What is saved

| Destination | Save | Do not accumulate |
| --- | --- | --- |
| User memory | Explicit, durable user facts, stable preferences, and corrections | Guesses, secrets, entire transcripts, short-lived tasks, or project-specific status |
| Chat summary | Current goal, decisions, open work, and relevant outcomes in this chat | Every conversational exchange or assumptions that unfinished actions succeeded |
| Project/section context | Decisions, constraints, current state, and unresolved work useful to other chats in the permitted scope | Full copies of every transcript or repeated copies of the same fact |
| Knowledge notes | Reusable procedures, verified findings, and research with evidence/source links where available | Unverified conclusions stated as settled facts |

Personality belongs in identity, not user memory. Identity loads in every context mode and in temporary chats, and must not bypass Closed-section context restrictions. Identity edits still follow their approval policy. Temporary chats cannot edit identity or durable memories even when their parent section is Shared.

## When automatic updates happen

- Save useful durable information automatically within the allowed scope; no approval is needed for ordinary memory or note updates.
- An explicit “remember this” or correction is a direct update trigger. A clear new durable preference or fact is another trigger. Do not infer personal facts from ambiguous conversation.
- Refresh chat/project/section summaries after a completed turn that materially changes a decision, task state, constraint, or outcome. Simple greetings and repetition do not trigger maintenance.
- Use small incremental changes. Reuse updates proposed during the normal run rather than requiring a separate extraction model call after every message. Long-chat compaction may need its own bounded model call within the same harness; it is not a subagent.
- A new research/procedure note is created when its content is useful beyond the immediate answer, with a descriptive name and the correct scope.
- Preserve the recorded outcomes of successful tool actions when a later step fails. If an edit is subsequently reverted, record that reversal and describe the verified final state rather than remembering the edit as still applied. Automatic end-of-turn summary maintenance must not mark interrupted or undone work as completed. See [[Run Lifecycle Design]] for the agreed failed-edit boundary and initial Stop restoration design.
- Temporary chats never contribute durable memory, knowledge notes, shared summaries, or cross-chat search entries. A same-chat context summary is allowed only as temporary conversation state and expires with that chat.

## Scope and source references

- Permanent Shared chats can update agent-wide user memory/knowledge notes and their section context.
- Permanent Closed chats can update only their own section context/notes. They cannot read or write agent-wide user memory/notes.
- Temporary retention overrides durable-write permissions: a section-level temporary chat may read its section's permitted context, including the section's projects, but contributes no durable memory, notes, shared summaries or cross-chat search entries. It cannot live inside a project or edit a repository while temporary.
- Generated items keep source chat/message references, scope, and revision metadata. Manual/agent provenance may be retained for audit/source cleanup, but does not give either author’s current edit priority. D-060 treats current eligible memory/notes equally. Exact storage representation and synchronization with editable files remain implementation work.
- Corrections replace/supersede the affected fact rather than appending contradictory “facts.” The user can inspect and edit remembered content and see its sources.
- Check revisions before applying automatic edits so a pending update does not silently overwrite a user's newer edit.

Source references support the agreed deletion boundary below. Exact cleanup transactions, file-edit synchronization and cached-context handling remain implementation design work.

## Current files and manual edits — D-060

Treat user and agent edits equally. Current eligible memory/notes are authoritative saved content for each model request, including later requests within one run. Refresh file revisions and invalidate stale views before assembling the request; a cached agent-authored copy does not outrank a newer manual edit. Do not cancel an already-running request merely to inject new text.

Preserve the existing Shared/Closed/Temporary scope and context budget: use the current permitted memory view and current catalog/relevant note contents, not every full note unconditionally. Explicit current corrections supersede contradictory older remembered facts. Content supplies facts/preferences, not permission, and repository facts still need checking against live files.

Apply the same conflict and source-cleanup rules regardless of author. A removed line must not reappear simply because a cache/index is stale; surviving eligible chats remain searchable and may later support a new memory update. Editing a file is not a request to erase historical evidence or permanently suppress a fact across all sources. D-029’s deletion boundary still applies. See [[Container & Settings Rules]].

## Deletion boundary: remove a source, preserve surviving chats

**Agreed:** deleting one chat does not delete or rewrite other chats, even when they mention, quote, or reference the deleted chat. Information actually preserved in those surviving chats remains available under their own scope and retention rules. Deleting a source is not a request to erase the same fact everywhere.

**User example:** the user says “I like coding” in five different permanent, eligible chats. Store the durable fact once with supporting message references from all five. Deleting the first chat removes that transcript and its support reference. The four surviving mentions still support the fact, so the agent continues to know it without changing those chats.

| Deleted source's relationship to a fact | Result |
| --- | --- |
| Other eligible chats contain the same confirmed fact | Keep the fact and its remaining support references |
| Another surviving chat actually quotes or discusses that information | Preserve that chat and its text; it can remain retrievable under its own permissions |
| Only a pointer to the deleted chat survives, without the information itself | Do not use the pointer to reopen or reconstruct the deleted source |
| No eligible supporting content remains outside the deleted source and its generated caches | Remove or invalidate the unsupported managed memory item; do not keep it merely because a cached summary repeats it |

Preserved secondary mentions retain their source type. An assistant quoting a prior claim is not automatically a new independent user confirmation. Track enough provenance to avoid converting repeated model echoes or injected cache entries into independent evidence. Temporary chats still cannot become sources for durable memory; Closed material cannot become agent-wide support merely because it exists somewhere in the database.

Generated summaries/search caches are derived state, not independent conversations. Update or invalidate their references to deleted source content, and rebuild them only if needed. Other saved chats are not recursively deleted or rewritten. Rebuilding an active prompt should exclude newly injected deleted-only sources while preserving the active chat's own saved messages under this limit.

For repeated, already-established facts, removing one support link need not require a model call or a whole-section resummary. More complex conclusions may need revalidation from surviving sources; keep them unavailable until that succeeds rather than treating any remaining source as sufficient.

## What each model call receives

Assemble context in priority order and enforce the scope before retrieving content:

1. Harness policy, tool schemas, personality, current user request, and the chat's current location/permissions.
2. The current chat's recent messages plus a compact summary of older messages when needed.
3. Relevant detailed local context: active project first, then its section's decisions, constraints, and related work. General has section context only because it cannot contain projects.
4. In Shared mode, a concise relevant user-memory view and brief directory entries for other eligible Shared sections/chats. Entries identify the topic and provide a lookup ID; do not embed complete remote transcripts. Retrieve knowledge notes when relevant.
5. Additional source excerpts only when the model asks for them through scoped lookup. Return bounded snippets, source references, and a way to continue, rather than dumping entire archives.

Closed calls use only local-section conversation/memory sources and their own chat history. Repository-file access follows the separately agreed rule: Shared repositories may be read by all chats under the agent, including Closed-section chats; Closed repositories may be read only by chats in that same section. This does not open other sections' conversations or agent-wide user memory to Closed calls. Repository availability means permitted bounded tool reads, not automatic insertion of every file.

Temporary chats sit directly under a section and use that section's normal permitted read context, including the context/data of projects within it. Shared-section temporary chats may therefore read the same eligible agent memory and cross-section sources as other chats there. All temporary chats can read Shared repositories and those in their own section, but cannot edit repository files. The context available is distinct from permission to write durable memory or edit repository files. Permanent repository-project chats have implied read/write access to their own repository without per-edit approval.

Temporary chats cannot be created inside projects, with or without repositories. To edit repository code, the user must first agree to keep the chat permanently, then separately agree to move it permanently into the target repository project. Usual source-section movement restrictions still apply. Keeping alone grants no repository write access.

The earlier proposal for temporary chats inside projects is superseded. General and Temporary are combined into one built-in Shared General section holding permanent and temporary chats, without projects. Temporary is a retention setting, not a separate section.

## Model-aware context budget and compaction

- Use the selected model's known/configured context window, not one universal message-count or byte limit. If reliable metadata is unavailable, use an explicit conservative configured limit.
- Reserve at least 25% of that window for reply generation and tool-loop headroom; increase the reserve if the configured output allowance needs more. The rest is the input budget, including instructions and tool schemas.
- Start compaction when assembled input reaches 80% of that input budget; target about 60% afterward. These are initial tuning defaults, not claims about a particular model's limits.
- Drop irrelevant retrieved excerpts and shorten optional remote directories first. Summarize older messages/tool output while preserving the newest user request, recent exchanges, decisions, constraints, unresolved actions, and relevant source IDs.
- During steering, preserve the original task and its still-applicable constraints along with the newer corrections. The next request needs both messages in an ordinary short run; compaction of a longer history must retain their combined meaning rather than replacing the task with an ambiguous fragment such as “green instead.”
- Keep the full transcript in storage; compaction changes model context, not the saved conversation. Never silently discard harness permissions or the current request to make a call fit.
- If mandatory context plus the current request still cannot fit, stop with an explanation and offer a fresh chat or narrower task. Do not repeatedly summarize without making progress.
- Cached provider context must match the current scope and source revisions. Moves, scope changes, and later deletion handling must invalidate/rebuild affected caches rather than resurrect inaccessible data.

Start with scoped database/text search; no embeddings or vector database in the first version. Scope filters apply before matching and ranking. Context availability never grants repository edit permissions.

## Revising the policy later

The core-plus-optional-lookup policy in [[Tool Selection & Context]] is accepted as D-066 from P-016. Counting tool definitions in the input budget is already part of the baseline above; advanced selection/discovery tuning is tracked in [[Things to Optimize]]. Context capacity alone does not select a tool-use capability profile.

The user explicitly accepts this as a baseline that can be optimized later, including in response to new provider capabilities or research. Keep memory sources/scopes and raw conversation records separate from replaceable summary/retrieval methods. A new memory method must still honor the chosen context visibility, temporary-retention rules, repository permissions and eventual deletion policy; budget percentages are tuning defaults, not permanent product constraints.

Track large-repository work and model-context optimization in [[Things to Optimize]]. Begin with bounded file/search tools and scoped text/database retrieval; richer indexes, retrieval methods, cache strategies, and compaction tuning follow after the basic lifecycle works.
