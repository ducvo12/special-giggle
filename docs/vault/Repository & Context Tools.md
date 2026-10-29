# Repository & Context Tools

> Consolidated October 29, 2026. Repository tools are implemented in passes 3/3A; native conversation-context retrieval is planned for pass 4. Context API names below are illustrative. This note describes the v0.1 boundary; v0.2 exceptions are separate.

Start visually: [[Available Agent Tools.canvas]] · [[Context Retrieval.canvas]] · [[Repository Access.canvas]]

Related: [[Tools & Permissions#Core tools and optional discovery]] · [[Memory & Context Policy]] · [[Harness Design]] · [[Tools & Permissions#Skills]] · [[Decision Register]]

## Implemented tool groups

| Group | Tools / implementation |
| --- | --- |
| Eligible repository reads | `list_repositories`, `repo_list`, `repo_search`, `repo_read`; bounded results, checked paths and file revisions. |
| Owning-project file changes | `repo_write`, `repo_edit`, `repo_patch`, `repo_rename`, `repo_delete`; revision-guarded native operations. Git applies unified patch hunks in scratch storage. |
| Project entry proposal | `request_repository_edit`; does not itself move the chat or authorize writes. |
| Controlled Git | `repo_git`: inspection plus explicitly authorized supported mutations. Hooks/external helpers are disabled; arbitrary metadata writes are not exposed. |
| Terminal | `repo_command` and `repo_command_start/read/input/stop`; supervised macOS sandbox, real PTY where needed, isolated repository copies and guarded publication. |
| Setup choices and previews | `ask_user` and `repo_preview_start/read/list/stop`; exact question ownership and separately managed ready preview lifetimes. |
| Generic workspace | `ls`, `read_file`, `glob`, `grep`, `write_file`, `edit_file`, `write_todos`; protected agent storage, not a repository/context bypass. |
| Skills / integrations | `load_skill` plus eligible configured MCP; restrictions and planned importer/discovery are in [[Tools & Permissions]]. |

Repository enforcement, guarded file sessions, commands, authorization, previews, diffs and durable records live under `src/backend/repositories/`. Schemas/adapters live under `src/backend/harness/tools/`; Granite owns the loop and registry.

Commands can download dependencies under bounded authorization, preserve safe contained relative package links and share isolated HOME/cache within a run. No fixed command time or repository count/size ceiling remains. Output previews and native text operations stay bounded. Commands cannot write directly into the live repository; completed changes publish after validation, while unfinished copies are discarded. Stop keeps published edits. Managed previews serve a labeled isolated snapshot and publish no writes.

Current limitations include macOS-only command confinement, real local `.git` metadata rather than linked worktree pointers, no inherited host credentials and expensive full copies/manifests. Closed-section execution awaits pass 4; temporary execution awaits pass 5. See [the current harness guide](../harness.md) and dated verification records for exact coverage.

## Repository tools depend on membership

**Pass-4 extension — planned:** improve the existing filename/text search with an established lexical engine where practical, case/regex controls, sensible dependency/generated ignore rules, explicit scoped inclusion and clearer bounded-result continuation. This changes search quality and usability, not repository access. Semantic search/embeddings, richer symbol/import maps and advanced ranking remain v0.3 evaluation work. The current basic scanner is still the implementation until this extension is delivered.

| Current chat location/retention | Repository reads | Repository edits |
| --- | --- | --- |
| General or a custom section, outside a repository project | Eligible repositories only | No repository-write tools exposed or executable |
| A project with no repository attached | Eligible repositories only | None until the permitted attach/create flow succeeds |
| Permanent chat in repository project A | Eligible repositories | Only A, under standing permission without per-edit prompts |
| Temporary chat | Eligible repositories under the existing read rules | None; Keep and a separate eligible project move must happen first |

Eligible repositories are the same agent's Shared repositories plus repositories in this chat's own Closed section. Other Closed sections' repositories remain unavailable. A permanent chat in project A does not gain write access to project B just because it can read B.

Use separate repository read operations (permitted-repository listing, file listing/search/range reads) and repository mutation operations. Bind mutation operations to the current owning project/repository on the backend rather than accepting an arbitrary absolute repository path from the model.

Outside chats should not receive repository-write schemas in either their direct core or `lookup_tools` results. This reduces confusion; backend canonical-path/membership checks remain authoritative even if the model invents a call or remembers an old schema. Terminal, Git and MCP paths must retain the same read-only boundary.

Memory/notes writes are separate scoped capabilities. A permanent Shared section chat may update permitted agent-wide memory/notes with no repository attached. A permanent Closed chat may update only its local section context/notes. Temporary chats cannot make durable updates. Do not grant broad filesystem write access merely because some memory updates are permitted.

The approved creation of a project's first repository uses the existing dedicated attach/create workflow. It does not grant outside chats free-form repository-write access as a bootstrap shortcut. Requests to edit a readable repository from outside its project use the existing between-run project-entry flow; temporary chats must first be kept, and Closed-source movement restrictions still apply.

## Context tools are distinct from repository tools

Use a compact native read-only context toolset, available directly where the chat has eligible sources:

| Illustrative tool | Purpose |
| --- | --- |
| `list_context` | Browse permitted section/project/chat entries and knowledge notes with stable source IDs, brief labels and pagination. |
| `search_context` | Search permitted saved titles, summaries, messages and notes; return bounded hits with excerpts and source references. |
| `read_context` | Read a selected source or message range in more detail, within an output bound and after another access/deletion/revision check. |

`lookup_tools` finds available capabilities/definitions. `search_context` finds information in saved content. Searching context is a core harness function and need not go through tool discovery or an external MCP server.

## What conversation context is searchable

| Chat mode | Eligible other-chat/memory sources |
| --- | --- |
| Shared | Permanent content in this agent's Shared sections/projects/chats, plus permitted agent-wide user memory and knowledge notes |
| Closed | Permanent content and scoped context/notes in its own section and projects; no other sections' conversations or agent-wide user memory/notes |
| Temporary overlay | The parent section's permitted reads above, plus its own expiring history; no other temporary chats and no durable contributions |

The current chat's history is provided separately under the existing context policy. A temporary chat's own older messages may be read as same-chat state if needed; it is not inserted into the cross-chat index. Other temporary chats are unavailable even when they share a section.

Repository-file visibility and conversation visibility remain separate. For example, a Closed chat may read a repository belonging to a Shared section without gaining access to that section's chat transcripts, summaries or agent-wide memory.

## Retrieval flow

1. **Initial context:** include the current request/history, richer relevant project/section context, permitted user memory, and a small directory of relevant eligible remote topics/source IDs under the existing budget. Do not inject every chat or every title when the archive is large; `list_context` can continue the directory.
2. **Query:** the model asks for information such as `search_context("club event date decision")`, with optional section/project filters that can only narrow access.
3. **Scope first:** the backend computes the eligible source set before matching/ranking. Exclude other agents, disallowed sections, other temporary chats, deleted sources and inaccessible derived caches. A guessed ID or a broad query cannot expand it. Counts/titles/snippets are also filtered metadata.
4. **Text search:** start with indexed database/text search over existing titles, saved summaries, messages and notes. Search the original saved messages as well as summaries so information omitted by a summary can still be found. No embeddings or extra model call is required just to perform this first search implementation.
5. **Bounded results:** return relevant snippets, section/project/chat labels, dates, stable source/message IDs and continuation information. Distinguish source messages from derived summaries. Prefer useful local matches by default, but honor a query explicitly targeting another permitted section instead of forcing irrelevant local results ahead of it.
6. **Read details:** the model selects a hit and requests a bounded message range/source through `read_context`. Revalidate access, existence and source revision; stale results cannot reopen deleted content. Summaries/directories identify sources but are not substitutes for verifying important details in the saved messages.
7. **Answer:** use the retrieved evidence, retaining enough source references for the user to see where it came from. Retrieval does not itself write a new durable memory or turn a cached excerpt into an independent source.

Use incremental summaries already maintained for meaningful completed turns; do not generate fresh summaries of every section/chat on every request. Existing source deletion rules still remove deleted-source search entries and invalidate unsupported caches without rewriting surviving chats. Long-term ranking, semantic retrieval and richer packing remain optimizations in [[Things to Optimize]].

## Enforcement across storage paths

Generic file/terminal/MCP operations must not expose the raw chat database or unfiltered internal context stores as an alternate retrieval route. Use scoped context operations for model access. The device owner can still manage user-facing files under the existing human-editing policy; these restrictions apply to the agent's capabilities.

Listing a repository or context source makes only the permitted resource available to the model. It does not automatically load all its contents, grant a project move or enable a write tool. Access is checked again when actual content is read or changed.

## Examples

- A permanent General chat asks about a decision in a Shared club section. Search finds permitted planning-chat excerpts; the model reads the relevant messages and answers without receiving the whole archive.
- A Closed chat asks the same question about another section's conversations. Those chats do not appear in listing, search or direct reads, even if that section's Shared repository is readable.
- A section-level temporary chat researches its section's project. It can search/read permitted permanent context, but its own messages remain excluded from shared search and no repository edits are allowed.
- A section chat asks to change the club website. Read tools remain available, but repository edits wait for the existing approved permanent project move. A generic memory-write tool or an MCP lookup cannot bypass that transition.

Pass 4 implements native scoped context retrieval; pass 5 adds optional integration discovery. Exact context schemas and search mechanics remain implementation choices within this policy. Same-section cross-project edit grants and isolated worktree targets belong to v0.2 in [[Repository Access & Worktree Plan]]; they are not currently granted by read access.
