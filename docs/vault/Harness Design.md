# Harness Design

> Accepted v0.1 design, consolidated October 29, 2026. This specification includes delivered and still-planned behavior. [[Harness Implementation Plan]] records delivery; [[Start Here]] is the navigation/status index.

Visuals: [[Harness Overview.canvas]] · [[Agent Structure.canvas]] · [[Repository Access.canvas]] · [[Memory & Context.canvas]].

## Purpose and scope

Granite is a personal-agent workspace with coding capabilities. It owns the model/tool loop, context assembly, permissions, persistence and recovery. Model providers propose text and actions; Granite performs permitted actions and returns actual outcomes.

Finish the six v0.1 passes plus implemented pass 3A before treating the foundation as complete. No delegated subagents in v0.1. [[Granite Vision & Roadmap]] assigns same-section repository grants/worktrees to v0.2 and mixed-model orchestration to v0.3. Those later features do not change current v0.1 permissions.

## Organization

```text
Agent
├── identity.md                 personality
├── memory.md                   durable user facts/preferences
├── notes/                      reusable knowledge
├── General                     built-in Shared section; no projects
│   ├── permanent chat
│   └── temporary chat          planned retention mode
└── Computer Science Club       custom Shared or Closed section
    ├── event-planning chat
    ├── temporary research chat
    ├── Website                 project; one repository attachment
    │   ├── frontend chat
    │   └── backend chat
    └── Planning                project; no repository required
        └── slides chat
```

Chats and membership are database records. Editable content has stable-ID folders. An attached repository is a managed reference to a local folder, not necessarily a folder under the agent. Linking existing code does not copy it into agent storage. Storage details and the current source layout are in [the development guide](../development.md).

| Container | Rule |
| --- | --- |
| Agent | Own folder, identity, memory, notes and chats; separate agents do not share context by default. |
| General | Exactly one built-in Shared section per agent; permanent/temporary chats together; cannot be individually deleted or contain projects. No separate Temporary section. |
| Custom section | Shared or Closed; holds direct chats and projects; cannot own a repository. Closed can become Shared, never the reverse. |
| Project | Fixed parent section; inherits that context mode. A collection of chats with zero or one current repository attachment. |
| Repository attachment | Existing external folder or first internally created codebase. Adding it binds every existing project chat. No detach/release to chat-only and no simultaneous second attachment. Missing-folder relinking is a separate pass-5 recovery flow. |
| Temporary chat | Directly under a section, never any project. Normal permitted read context, no durable contributions or repository writes. Full lifecycle arrives in pass 5. |

## Moving and keeping chats

- A chat cannot leave a Closed section until the user converts the entire section to Shared. Conversion exposes the whole section to eligible Shared retrieval.
- Chats in a repository project cannot leave that project, even if they never edited code. Projects cannot move between sections.
- Other eligible permanent chats may move; retain their ID/transcript and rebuild context/access for the destination.
- Active runs lock Keep and moves. An eligible never-started queued chat can move, but dispatch must revalidate its location. See [[Run Lifecycle Design]].
- A temporary chat must first be kept permanently in place, then separately approved for permanent entry into a repository project. Keep alone gives no repository writes. Declining the move does not undo Keep.
- End the current run before requesting the Keep/move transition; do not wait for an in-run approval that its own active lock prevents.

## Context and memory

| Source | Purpose |
| --- | --- |
| Current transcript | The actual conversation and recorded outcomes; stored separately from summaries. |
| Identity | Personality in every mode; no user-specific memories. Agent changes need exact approval in permitted Shared permanent chats and activate next run. |
| User memory | Durable confirmed user facts/preferences, not a summary of every chat. |
| Knowledge notes | Reusable procedures and evidenced research, with descriptive names. |
| Chat/project/section context | Scoped goals, decisions, constraints, outcomes and open work; retrieve source messages when detail matters. |

Shared chats can use permanent content from other Shared sections of the same agent, eligible user memory and notes. Closed chats use their own section's permanent content only, plus personality. Temporary chats read their parent section's permitted sources and their own expiring history, but other chats cannot retrieve them and they cannot make durable contributions.

Pass 4 implements the full [[Memory & Context Policy]]: richer local context, brief eligible remote directories, native scoped text search/read, incremental meaningful-turn summaries, source references, fresh editable files and model-aware compaction. It does not attach every transcript on every request or require embeddings.

Deleting one source does not rewrite surviving chats or erase independently supported facts. Generated summaries/caches are not independent evidence. Pass 4 provides source cleanup; pass 5 connects it to complete container/expiry lifecycles.

## Repository access in v0.1

| Target | Read access | Write access |
| --- | --- | --- |
| Repository in a Shared section | Any chat of the same agent | Permanent chats inside its owning project |
| Repository in a Closed section | Chats in that same section only | Permanent chats inside its owning project |
| Another agent's repository | No access granted by this design | No access granted by this design |

Repository visibility is separate from conversation visibility: a Closed chat may read Shared code without reading that section's conversations or agent-wide user memory. Read access means bounded tool access, not automatic loading of all files.

Ordinary member edits have standing permission; Git mutations, downloads and remote effects keep separate authorization. Outside edit requests use explicit permanent project entry. Scope is enforced across native files, terminal, Git and integrations, including remembered/invented tool names. [[Repository & Context Tools]] describes the APIs; [[Tools & Permissions]] owns the action rules.

Show actual changed files, inspectable diffs and added/removed lines against the run's starting content, preserving pre-existing edits. Binary/generated output needs truthful notices. Concurrent external edits may appear in observed deltas; counts are not proof of exclusive authorship or correctness.

## Execution and lifecycle

[[Run Lifecycle Design]] owns the run contract: provisional streaming, same-run steering, one active run per chat, project/model queues, sequential tools, exact approvals, Stop, Continue and outcome recovery. No fixed or optional whole-run time/step/tool-call budgets.

Stop, failures and unexpected closure keep completed edits. Settle owned processes and report actual outcomes; never automatically replay uncertain actions or reset code. Automatic restoration/Undo is unassigned future work in [[Things to Optimize]].

[[Container & Settings Rules]] owns cascade deletion, missing-folder recovery, duplicate-link warnings, fixed model sessions and next-request/action permission changes. Folder deletion follows physical storage: internal code is deleted with its container; external linked targets survive.

## Delivery boundaries

Passes 1–3/3A deliver organization, the core run loop and repository/setup work. Closed-section execution awaits pass-4 isolation. Temporary execution/expiry, project/section deletion, full skill importing and scoped integrations remain pass 5. v0.2 worktree groups and cross-project grants are planned separately in [[Repository Access & Worktree Plan]]; they are not current exceptions to the v0.1 access matrix.
