# Harness Design

> Working draft from the user's design discussion. This describes intended behavior, not existing implementation. User directions, recommendations, and unresolved choices are labeled separately. No subagents in this version.

Start visually: [[Agent Structure.canvas]] · [[Memory & Context.canvas]] · [[Repository Access.canvas]] · [[Temporary Chat Flow.canvas]]

Run behavior design: [[Run Lifecycle Design]] · [[Run Lifecycle - Text Only.canvas]]. Start with one successful text-only answer before adding tool/approval/error branches.

Repository execution: [[Run Lifecycle - Repository Edits.canvas]] — successful edits and first failed-edit recovery agreed. [[Run Lifecycle - Stop & Rollback.canvas]] records Stop with edits retained (D-067); [[Deferred File Restoration]] keeps the earlier rollback design as future work. [[Run Lifecycle - Steering.canvas]] records how new messages redirect an active run. [[Run Lifecycle - Model Request Failures.canvas]] records connection-error and incomplete-reply handling. [[Run Lifecycle - Approvals.canvas]] records identity-edit approval. [[Run Lifecycle - Temporary Expiry.canvas]] records the revised timer rules and proposed cleanup. [[Run Lifecycle - Chat Deletion.canvas]] records permanent-chat deletion during repository work.

Existing execution maps: [[Harness Overview.canvas]] · [[Run Lifecycle.canvas]]

Unexpected application closure: [[Unexpected Closure Recovery]] · [[Run Lifecycle - Unexpected Closure.canvas]] — agreed Stop-equivalent recovery on reopening, with an error popup (D-055).

Later improvements: [[Things to Optimize]] — large-repository work and model-context optimization after the basics.

Planning finish line: [[Remaining Harness Decisions]] — behavior groups are reviewed; implementation defaults, explicit deferrals and acceptance cases remain to consolidate. Final container/relink/memory/settings choices: [[Container & Settings Rules]] · [[Container & Settings.canvas]] (D-059–D-066).

Implementation sequence and planned tests: [[Harness Implementation Plan]] — six passes, with automatic file restoration deferred under D-067.

Tool inventory and reuse direction: [[Tooling Strategy]] — current implementations and a proposed approach to reuse established repository tools behind Granite's controls.

## 1. Organizing the ideas

Product vision and version priorities: [[Granite Vision & Roadmap]] (D-073/D-074) keeps the existing first-version plan as v0.1, broad practical capability as v0.2, and optimization plus parent-directed mixed-model/provider subagents as v0.3. The user reaffirms orchestration as a long-term goal. “No subagents in this version” below applies to the original v0.1 design, not a permanent rejection. Separate user-selectable agents, chat sessions and delegated subagents remain distinct concepts. Neither later version has implementation passes yet.

Latest repository/workspace amendment, October 27: [[Repository Access & Worktree Plan]] (D-070–D-072) preserves one attachment/no release, adds user-granted same-section project edits and represents isolated worktrees as project subgroups that close after successful user-requested merge. It revises earlier owner-only editing/project-wide scheduling and deferred-worktree descriptions in this design where they conflict. Other-Shared-section repositories remain read-only, Closed boundaries remain enforced, and subagents remain deferred. Detailed scope and unsettled recommendations are in that note; this is not implementation status.

There are three related parts to design:

1. **Organization:** which agent, section, project, and chat something belongs to.
2. **Context:** what information a particular model call receives or can retrieve.
3. **Permissions and retention:** what the agent can change, what requires approval, and when data expires.

Folders organize content, but they do not by themselves enforce context or tool permissions. The harness must enforce those rules.

## 2. The hierarchy

**User direction:** each agent has its own folder, identity, user memory, and notes. Every chat belongs to a section, either directly or through a project. There is one built-in General section, which cannot be deleted or contain projects; projects belong only to custom sections. The user can create and delete custom sections.

**Agreed built-in layout:** General and Temporary are combined into one undeletable, chats-only General section containing permanent and temporary chats together. General is always Shared and cannot contain projects. Temporary is a chat-retention setting, not a separate section; it follows its parent section's permitted read context.

**Agreed hierarchy:** Agent → Section → Project → Chat, with chats also allowed directly under a section. A section cannot own a repository. Only a project can own one, and a project has zero or one repository. A project without a repository is simply a collection of chats.

**Agreed:** a project stays in the section where it was created, whether it has a repository or not. It cannot move to another section. Projects inherit the parent section's context mode.

```text
Agent
├── identity.md                  personality
├── memory.md                    durable facts/preferences about the user
├── notes/                       reusable knowledge
├── General                     built-in section
│   ├── Chat 1
│   ├── Chat 2
│   └── Temporary chat           retention flag; normal section context
└── Computer Science Club        user-created section
    ├── Club event planning      direct section chat
    ├── Computer science research
    ├── Temporary research chat  reads club/project context; no durable memory
    ├── Club Website             project; one attached repository
    │   ├── Frontend chat
    │   ├── Backend chat
    │   └── Another frontend chat
    └── Planning                 project; no repository
        ├── Event topics chat
        └── Slides chat
```

This is the product hierarchy. Chats remain database records, not transcript files. A project is a logical container, while its repository attachment identifies a real codebase folder. The folder may be anywhere the user explicitly attaches on their device; it need not live under the agent's folder. Linking an existing folder does not copy its code into the agent folder.

**Agreed repository setup options:** the user can link an existing local folder to a project, or ask the agent to create a new repository for that project inside the agent's file structure. A chat-only project can gain its first repository later. D-061 allows relinking an unavailable attachment, including to a different codebase. There is still only one current attachment, no detach-to-chat-only and no project move. D-062 permits multiple projects to link the same folder with a concurrency warning.

**Recommendation:** store section/project/chat membership in the database. Use actual folders only for editable content. A possible content layout is:

```text
agent/
  identity.md
  memory.md
  notes/
  sections/<stable-section-id>/
    summary.md
    notes/
    projects/<stable-project-id>/
      repo/                     optional internally created codebase
```

This disk layout, including the internal `repo/` path, is a proposal. An external attachment uses a managed path reference instead of an internal `repo/` folder. Section display names can change without moving files when storage uses stable IDs. The repository attachment should be a managed reference, not a filesystem symlink through the agent workspace.

## 3. History, memory, and notes are different things

| Information | Purpose | Suggested storage | How the model gets it |
| --- | --- | --- | --- |
| Current chat transcript | What was said and done in this conversation | Existing database | Current-chat history or compatible saved provider state, within context limits |
| User memory | Durable facts and preferences about the user | Agent `memory.md` | Loaded only when the section allows agent-wide memory |
| Agent identity | Personality and voice, not user-specific memories | Agent `identity.md` | Loaded in every mode, including temporary chats |
| General notes | Reusable research, procedures, and knowledge | Agent `notes/` | Retrieve relevant notes only in an allowed scope |
| Section context | Decisions, tasks, research and facts shared by chats/projects in one section | Proposed section summary and section notes | A short scoped summary plus relevant retrieval |
| Other chat transcripts | Detailed evidence for a recalled fact | Existing database, with section membership added | Scoped retrieval when needed, rather than attaching every transcript |

### Context follows the current section

**User direction:** a chat receives more detailed information about its current section, plus summaries of other eligible sections or chats that it can look up when needed. Moving the chat changes which section is treated as local. Closed and Temporary visibility limits still apply; summaries must not expose otherwise ineligible content.

**Accepted baseline:** the user explicitly accepted [[Memory & Context Policy]], including automatic memory rules, context priority, lookup, and compaction defaults. It may be optimized or replaced later after evaluation or new provider/research capabilities. Assemble a request as follows:

1. Include the current chat's own history, within its context budget.
2. Include richer context from the current section: relevant decisions, project state, and recent activity, rather than every local transcript.
3. In Shared mode, include a concise directory/summary of other Shared sections of the same agent, with identifiers for scoped lookup. Do not load all remote transcripts or let summaries bypass Closed/Temporary isolation.
4. Let the model request more detail about eligible chats or sections when needed. User memory and agent-wide notes remain subject to the section's mode.
5. Resolve repository read/write access separately from conversation context.

Use small incremental memory updates when meaningful information changes and refresh summaries after materially changed completed turns. Initial context/compaction budgets are model-aware and defined in [[Memory & Context Policy]]. Exact formats and token-counting integrations remain implementation work. More detailed local context is a priority, not an unlimited context budget.

**Answer about previous chats:** saving a transcript does not automatically make it available in another chat. The application must explicitly include it, a summary, a saved memory, or a retrieved excerpt in the request. A new chat does not inherently remember the previous one.

### Current implementation, checked in this discussion

- `src/backend/agents/store.ts` stores messages by conversation and saved native state by conversation/model key.
- `src/backend/agents/runtime.ts` loads `identity.md` and `memory.md` and passes the selected conversation's history/state into the harness.
- `src/backend/harness/loop.ts` uses that native state when available, otherwise reconstructs input from that conversation's visible messages and tool activity.
- These paths do not automatically inject other conversations or implement section sharing. Sections, temporary retention, and scoped retrieval would be new behavior.
- `src/backend/workspace/filesystem.ts` currently prevents model tools from editing identity. An approved identity-edit action would also be new behavior.

**Chosen:** do not put every chat summary into `memory.md`. Keep that file about the user, put club/project continuity into its section context, and retain source references for generated items. Do not send all notes or all previous chats on every request. Deletion removes the selected source and unsupported managed memories without deleting or rewriting other chats; details are in [[Memory & Context Policy]].

## 4. Context scope and chat retention

**Confirmed clarification:** when a section has memory off, chats and projects within that section still share information with each other. Call this mode **Closed** (previously Section only), not independent chats.

Section context modes (durable-write behavior below is for permanent chats):

| Mode | Model may use | Model may save automatically |
| --- | --- | --- |
| Shared | This chat, its section context, relevant information from other Shared sections of the same agent, agent user memory, and relevant agent-wide notes | User facts to agent memory, reusable knowledge to agent notes, section details to section context |
| Closed | This chat and other chats/projects/context in this section, plus personality | Section context only; no agent-wide identity, memory, or notes writes |

**Agreed separate retention setting:** a chat is permanent or temporary. A temporary chat lives directly under its section, never inside any project. It can read its section's normal permitted context and project information, but cannot create durable memory, knowledge notes, shared summaries or cross-chat search entries. Its own transcript/context expires after one hour of inactivity unless kept.

**Agreed:** choose Closed or Shared when a section is created. A Closed section may later be converted to Shared. A Shared section cannot be converted to Closed. This one-way conversion replaces the earlier rule that modes were permanently fixed. Memory and note contents remain editable under their normal permissions. Shared means available to other eligible Shared sections of this agent, not public internet access.

**Agreed:** Shared sections can retrieve relevant information from other Shared sections belonging to the same agent, as well as agent-wide user memory and notes. Closed and Temporary content are excluded from cross-section retrieval. Retrieval permission does not mean every transcript must be loaded into every request, and it does not grant edits to another section's files or repositories.

**Agreed defaults:** General is always Shared. Each new custom section explicitly chooses Shared or Closed. The built-in General section contains chats only, never projects; there is no separate Temporary section. Personality loads in every mode and contains no user-specific memory. Temporary retention is not a third section context mode.

**Agreed:** projects inherit their section's mode, with no separate project memory switch. Every chat and project within the section shares context subject to that mode.

### Isolation needs a rule in both directions

While a section remains Closed, its content must not be read by other sections, even if those sections have Shared mode enabled. Otherwise section isolation would fail when the other section retrieves it. Temporary content must also be excluded from all other chats.

**Chosen:** enforce conversation/memory scope across summaries, search, file tools, terminal access, MCP access to local data, and cached model context. Excluding a file from the initial prompt is insufficient if the model can read it through a tool afterward. Closed blocks reads and writes of agent-wide user memory/knowledge notes. Identity is a separate read-only personality source, subject to the identity-edit rules. Repository files follow the explicit access rules below; their visibility does not expose the owning project's chat transcripts.

**Agreed repository read scope:** a repository in a Shared section is automatically readable by all chats under the same agent, including temporary chats and chats in Closed sections, without a read-permission prompt. A repository in a Closed section is automatically readable only by chats in that same section. Chats outside the owning project remain read-only. This file-access rule is separate from conversation-memory scope: it never grants access to another Closed section's conversations, agent-wide memory in a Closed chat, or another temporary chat. Availability to tools does not load the whole repository into the model request.

### One-way conversion and moving conversations

Converting Closed to Shared applies to the entire section, including its existing chats, projects, summaries, and notes. Those become eligible for retrieval by other Shared sections of the same agent. The converted section also gains access to the Shared information pool. Its repositories become readable by all chats under the agent under the repository read rule; editing remains restricted to each owning project's chats. Conversion does not automatically copy everything into agent-wide user memory.

**Recommendation:** describe that effect clearly on the conversion control, including that it cannot be reversed. D-064 applies new visibility on the next model request/read without stopping active work; refresh affected caches. Exact cache mechanics remain implementation work.

**Agreed chat-move rules, within the same agent:**

| Source | Destination | Allowed? |
| --- | --- | --- |
| Shared-section chat outside a repository project | Another Shared or Closed section | Yes; destination controls future context loading |
| Chat in a Closed section | Any different section, including a project under it | No; first convert the entire source section to Shared, then apply the other movement rules |
| Chat outside a repository project | A repository project in the same section, or in another section when the source is Shared | Yes; user-approved entry grants read/write access to that project's repository without per-edit approval |
| Chat inside a repository project | Anywhere outside that project, including another repository project | No |
| Temporary chat | Any project | No while temporary; first agree to Keep chat, then separately approve a normal eligible project move |

**Agreed:** individual chats cannot leave a Closed section until the entire section has become Shared. A permanent chat may move between direct section chats and chat-only projects, or into a repository project within that same Closed section, without crossing the section boundary. Temporary chats must first be kept before entering any project. Projects themselves never move between sections. Keeping a temporary chat does not open a Closed section or bypass movement rules.

**Consequence to make visible:** opening a Closed section exposes the entire section to Shared retrieval before any eligible chat can leave. A later chat move transfers its existing transcript, including any outside information quoted or learned earlier. The destination controls new context and retrieval; it cannot make the conversation forget. Moving Shared to Closed does not retract information already shared or saved elsewhere. Opening a section never unlocks chats bound to repository projects.

**Recommendation:** preserve the chat ID and transcript, update membership atomically between runs, rebuild request context and tool scope before continuing, and refresh affected section summaries/search eligibility. Do not reuse cached context that continues to inject the former section's privileged context. Existing transcript content is separate from those newly injected sources.

**Run lifecycle decision:** Keep chat and location moves are blocked while a run is active; perform them between runs. Deleting an active chat stops the run before its data is removed. See [[Run Lifecycle Design]] for the resulting temporary-to-project handoff and the distinction between a run and one model request.

## 5. Editing permissions

| Resource | Human user — requested | Permanent chat in Shared | Permanent chat in Closed | Temporary chat in any section |
| --- | --- | --- | --- | --- |
| Identity | Edit contents | Exact edit requires user approval | Cannot edit, even via an approval request | Cannot edit |
| User memory | Edit contents | Edit without approval | Cannot read or edit | Read only if section allows; cannot edit |
| Agent-wide notes | Edit/create contents | Create/edit without approval | Cannot read or edit | Read only if section allows; cannot edit |
| Section context | Edit contents | Automatic scoped updates under the memory policy | Automatic scoped updates within this section | No shared context writes; same-chat temporary summary expires with chat |
| Repository files | User controls attachments and chat moves | Automatically read Shared repositories; read/write own project's repository without per-edit approval | Automatically read own section's and Shared repositories; read/write own project's repository without per-edit approval | Automatically read repositories allowed by the repository read scope; Keep chat and separate project-move approval required before edits |

**User direction:** no filename renaming in the app for the first version. Agents may create descriptively named notes. Creation needs to choose a name even if later renaming is disabled.

**Critique:** freezing `identity.md`, `memory.md`, and structural folder names is useful. Freezing descriptive note names is optional simplification, not an architectural need. It is reasonable to defer a Rename feature, but build storage references around stable IDs rather than display names.

**Recommendation:** interpret “the user may edit any file” as any user-facing content file. Keep database files and internal app configuration out of the document editor. Restrictions in the app do not stop the device owner from changing files in another editor.

An identity-edit approval should show the proposed change and apply only that change. Personality changes must not change tool permissions. Notes and memories are content, not authority to override harness policy.

The agreed lifecycle for preview, waiting, Approve/Deny, stale requests and steering is in [[Run Lifecycle Design]] and [[Run Lifecycle - Approvals.canvas]]. It adds no approval prompts for ordinary repository edits; an approved personality change loads from the next run.

### Repository projects

**Agreed:** only projects may own repositories; neither agents nor sections have a direct repository attachment. Being inside a repository project implicitly grants the chat read/write access to that repository. The user does not approve every file change or every edit tool call. The harness still validates the target path and membership for every modifying action. Outside chats may read files when the repository read scope permits, but cannot change them, even when they share the same section or know the repository path.

Chats can enter a repository project when the source-section movement rules permit it, but once inside they cannot leave or move to another project. This applies to all chats inside the project, not just those that have already edited code. Adding the first repository to a populated chat-only project therefore binds all its existing chats. Projects without repositories remain ordinary organizational containers. Membership supplies standing permission for ordinary local repository edits across file, terminal, or other tools. Terminal, Git, network and remote-action permissions follow D-050 / [[Tool Permissions]]; detailed skill/MCP configuration and instruction precedence follow D-051 / [[Skills & MCP Policy]].

| Repository's parent section | Who can automatically read its files? | Who can change its files? |
| --- | --- | --- |
| Shared | All chats under the same agent, including temporary and Closed-section chats | Permanent chats inside its owning project; no per-edit approval |
| Closed | Only chats in that same Closed section, including its temporary chats | Permanent chats inside its owning project; no per-edit approval |

### Visible repository changes

**Agreed direction:** show added and removed line counts while repository work runs and retain the result with the run. This is visibility into edits, not an approval gate. Ordinary editing continues without asking the user to approve each change.

**Recommended presentation:** show a compact summary such as `3 files changed · +42 / −18`, with a file list and an inspectable diff. Calculate the summary from actual filesystem changes against a pre-run baseline, not the model's description or the repository's last commit. Preserve the distinction between pre-existing user edits and changes made during the run; include newly created files. Show binary changes, renames, and deletions even when line counts are not useful. Counts describe the current net diff, so an edit later undone may return to zero; they are not a complete activity log or proof that a change is correct.

The exact change-tracking mechanism, attribution when the user edits concurrently, and integration with Stop cancellation and retained-change reporting remain implementation work. Do not claim all current repository differences were made by the agent.

### Project and repository lifecycle

| Current state | Requested action | Allowed? |
| --- | --- | --- |
| Chat-only project | Keep a collection of chats without code | Yes |
| Chat-only project | Link an existing folder on the device | Yes; binds all existing chats and cannot detach to chat-only |
| Chat-only project | Ask the agent to create a repository inside its project storage | Yes, at the user's request; exact creation/registration steps remain to design |
| Repository project | Attach a second simultaneous repository | No |
| Repository project with unavailable folder | Relink to a user-selected folder, even a different codebase | Yes, after active work settles; refresh state and notify the model (D-061) |
| Multiple projects | Link the same physical folder | Yes, with a concurrent-edit warning (D-062) |
| Repository project | Detach the repository and return to chat-only | No |
| Any project | Move to another section | No |

An external folder and an internally created repository use the same project editing rules. Logical ownership does not require the code to live in the agent's folder. D-059 deletes the container’s actual folder tree and descendant chats. An externally linked folder survives; a repository physically inside the deleted tree is deleted too, even if another project linked it. See [[Container & Settings Rules]].

**Recommendation:** when adding a repository to a populated project, show that the attachment is permanent and all current chats will become bound to the project. For an agent-created repository, use a dedicated creation/registration operation authorized by the user's request, then enable normal editing only after the project attachment succeeds. Do not require an outside chat to write an unregistered codebase and bypass the membership rule as a bootstrap step. If the requesting chat belongs to another section or project, normal movement rules apply before project work continues.

**Agreed edit-request flow:**

1. A user asks a chat outside the project to change a repository.
2. If the chat is temporary, first ask the user to keep it. Until they agree, it remains temporary and cannot edit the repository or enter the project. Keeping changes retention in place and removes expiry; it does not grant editing access.
3. Check whether the move is allowed. If the source is a different Closed section, the entire source section must become Shared first. A chat already bound to another repository project cannot move. Otherwise, separately ask whether the user wants to move this chat permanently into the repository's project. The destination and the fact that the chat cannot later leave must be clear.
4. If the user accepts, the app moves the chat into the project and resolves its parent section's context plus repository tool access.
5. Only after both retention and membership requirements succeed may the agent perform local repository edits, using its implied read/write permission without per-edit prompts.
6. If keeping is declined, the chat remains temporary and read-only. If keeping is accepted but moving is declined, it stays permanent under the section, outside the project and still read-only. No rejection silently undoes an earlier accepted Keep chat action.

**Recommendation:** enforce project membership in the backend for every modifying action, including file tools, terminal commands, Git operations and MCP tools capable of touching the repo. Knowing a path or obtaining an ordinary tool approval must not bypass membership. Validate the destination project and canonical repository path; changing membership while a run is active must not leave stale write access.

**Revised by D-062:** multiple projects may link the same physical folder. Store linked paths and warn about conflicting independent edits rather than rejecting duplicate ownership. Serialize repository-capable runs within each project; separately linked projects may run concurrently. Fresh-read/conflict checks remain. D-067 makes Stop retain completed edits; automatic rollback is deferred. Stronger overlap/worktree detection and cross-project coordination are in [[Things to Optimize]].

Open details: read-only access must also hold for commands that can create generated files, indexes, caches, or lockfiles. Creation/registration failure handling, unavailable or moved external folders, and overlapping repository paths still need implementation decisions. Recovery for a folder relocated by the user must not silently switch the project to a different codebase.

## 6. Section-level temporary chats

**Agreed:** temporary chats can be created directly under a section, but never inside a project, even a project without a repository. They use that section's normal permitted read context, including information/data about all of its projects. Relevant context is retrieved within the normal model budget, not loaded as every project transcript at once. Shared/Closed restrictions still apply.

Temporary retention is separate from context scope. A temporary chat in a Shared section may read eligible user memory, notes and other Shared sections; a temporary chat in a Closed section stays within Closed read scope. Neither writes durable memory/notes, contributes shared summaries, nor appears in other chats' search/retrieval. Other temporary chats are not made visible simply because they share a section.

**Agreed expiry, revised in D-048/D-054:** hold the timer at a full hour during active work and while an accepted message/continuing model request is queued, including repository/model-capacity waits. Agent responses and qualifying chat actions reset it. When no active/queued work remains or the chat waits solely for user input/approval, begin a fresh one-hour countdown. An unattended approval-only wait can still expire after that hour. For inactivity tracking, keep only the current expiry value plus ordinary run/queue state, not a separate activity log. Permanent chats need no inactivity tracking. The transcript and same-chat summary expire together unless the chat is kept. Detailed cleanup and passive UI-event classification remain proposed in [[Run Lifecycle Design]] and [[Run Lifecycle - Temporary Expiry.canvas]].

### Keep, then move, then edit

1. The user requests a repository edit from the temporary chat.
2. Ask whether to **Keep chat** permanently. If accepted, preserve its transcript, remove expiry, and keep it directly under its current section. Normal memory eligibility then applies under that section's scope.
3. Separately ask whether to **Move into the repository project permanently**, subject to existing section movement rules. Keeping alone never grants write access. Temporary chats cannot enter chat-only projects either without first being kept.
4. Only after the project move succeeds can repository editing begin, with implied read/write permission and no per-edit prompts. The chat is now bound to that repository project.

Keep/move approvals occur between runs, because active runs lock those actions. End the temporary run with the required transition request, obtain the two approvals, then begin a new editing run in the project. See [[Run Lifecycle Design]].

If keeping is declined, the chat remains temporary and read-only. If keeping is accepted but moving is declined, it remains permanent outside the project and read-only. A Closed source section still cannot be left without first becoming Shared; neither approval bypasses that rule.

Keep and expiry must not race: if Keep wins, cleanup cannot delete the retained chat; if expiry has completed, Keep is unavailable. Expired chats must not be loaded or retrieved while physical cleanup waits for reopening. If Granite is closed, perform overdue cleanup when it reopens.

This replaces the earlier proposal for temporary chats inside projects. Code editing while temporary is no longer an option. Files changed after keeping and entering a project follow normal persistent repository behavior.

### Combined General section — agreed

There is one built-in General section containing permanent and temporary chats together. It is Shared, undeletable and unable to contain projects. Temporary chats carry a visible retention marker and Keep chat action; choosing temporary retention does not move the chat to a separate section or remove its normal General read context.

Custom sections can also contain temporary chats directly under the section, with the same retention/no-durable-write rules and their own Shared/Closed context policy. Projects remain available only under custom sections and never contain temporary chats.

### Deletion and forgetting — agreed boundary

**Agreed limit:** deleting a chat does not delete or rewrite other chats that reference it. Information actually preserved in surviving eligible chats can remain retrievable and can continue to support memory. A fact mentioned in five chats remains known after one is deleted if surviving eligible mentions still support it.

Remove the deleted source's transcript/search entries and its memory support references. Keep facts supported elsewhere; invalidate managed memory items supported only by the deleted source or its generated caches. Cached summaries are not independent evidence. References cannot be used to fetch an already-deleted chat. Detailed source types and examples are in [[Memory & Context Policy]].

The original goal of removing memories of deleted content is bounded by this non-cascading rule: no promise to erase copies in other saved conversations. Container deletion and equal treatment of current manual/agent memory edits are settled in D-059/D-060; exact cleanup transactions and cache invalidation remain implementation work. Repository file deletion is separate from deleting remembered information.

**D-049 revised by D-067:** deleting an active permanent chat cancels/settles its run, keeps completed repository edits and removes chat data. Known retained edits do not pause deletion for rollback; genuinely unknown action/process outcomes still require reconciliation. Idle-chat deletion also preserves existing code. See [[Run Lifecycle Design]] and [[Run Lifecycle - Chat Deletion.canvas]].

## 7. Keeping the first version manageable

Recommended first pass, not yet an agreed implementation plan:

1. One agent → sections → optional projects → chats, without subagents or nested sections/projects.
2. Shared/Closed section context plus a separate permanent/temporary chat-retention setting, with projects fixed under their parent section. Closed can convert to Shared, never the reverse. Chats cannot leave a Closed section before that conversion, and repository-project chats cannot leave their project at all.
3. Current-chat history plus richer local-section context, brief summaries of other eligible Shared sections, and explicit scoped lookup for more detail. Skip embeddings/vector search initially.
4. Apply the selected automatic-memory, incremental-summary, source-reference, and model-aware compaction policies in [[Memory & Context Policy]]. No unconditional extra maintenance call for every casual message.
5. Separate user facts, section continuity, and reusable notes.
6. Section-level temporary chats, inactivity expiry, and Keep chat implemented together; no durable memory writes or project entry while temporary. General is the single built-in chats-only section for both retention types.
7. One approved action for editing identity. A project may gain one external or internally created repository and cannot detach back to chat-only; an unavailable folder may be relinked under D-061. Duplicate links across projects are allowed with a warning under D-062. Repository-project membership grants read/write access without per-edit approval; outside chats have automatic read access within repository scope and ask before an eligible move in. Show actual changes through line counts and a diff.
8. Use bounded repository listing, filename/text search, relevant file-range reads, and batching when supported, as accepted in [[Run Lifecycle Design]]. Track advanced large-repository workflows and model-context tuning in [[Things to Optimize]] after the basics work.

## 8. Behavior review and implementation handoff

The four remaining behavior groups are resolved in [[Container & Settings Rules]] (D-059–D-066): cascade container deletion, current editable memory/notes, missing-folder relinking, duplicate-link warnings, fixed session model, next-request/action permission changes, requested skill imports and core-plus-lookup tools.

Earlier immutable-attachment and unique-owner rules are explicitly revised. Keep/move locks, section isolation, no temporary durable writes, next-run personality changes, Stop cancellation and edit conflict checks and the no-budget policy remain. Deleting a physical container also deletes code inside it; links to external folders do not delete their targets.

[[Remaining Harness Decisions]] records the finish line. Choose storage/transaction/index details during implementation and defer advanced cross-project/worktree coordination and model/context tuning through [[Things to Optimize]]. Observable acceptance cases are included in [[Container & Settings Rules]]; consolidate the full first-version acceptance checklist before building each slice.
