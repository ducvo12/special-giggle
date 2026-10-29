# Decision Register

> Current decision reference, consolidated October 29, 2026. IDs remain stable for diagrams and verification records. Rules live in the linked specifications; old proposal/question histories and reversed alternatives have been removed from the active docs.

| Decision IDs | Current rule | Specification |
| --- | --- | --- |
| D-001–D-003 | Plan in the shared `docs/vault`; harness first; no delegated subagents in v0.1. | [[Harness Design]] |
| D-004, D-006–D-007, D-014–D-015, D-022, D-028 | Shared/Closed sections; Closed → Shared only; Closed chats cannot leave before whole-section conversion; projects stay in their section; one Shared General with no projects. | [[Harness Design]] |
| D-009–D-011, D-016–D-018, D-027, D-032 | Eligible chat moves; repository-project chats permanently bound; one repository; Keep then separately approve project entry; active runs lock Keep/moves. | [[Harness Design]] · [[Container & Settings Rules]] |
| D-012, D-019–D-020, D-023 | Recent history, personality, richer local context, brief eligible remote directory, incremental source-linked memory/summaries and model-aware compaction. | [[Memory & Context Policy]] |
| D-021, D-026, D-033, D-048, D-054 | Temporary chats only under sections; normal permitted reads, no durable contributions; one-hour idle countdown, held during active/queued work, reset by replies/actions; approval/input-only waiting counts down. | [[Run Lifecycle Design]] · [[Memory & Context Policy]] |
| D-025, D-029 | Delete a source without rewriting other chats; keep independently supported facts; derived caches do not supply independent support. | [[Memory & Context Policy]] |
| D-030–D-031, D-035–D-036, D-041, D-044–D-045 | Provisional streaming and structured tool loop; steering preserves original task/corrections/outcomes and uses safe execution boundaries. | [[Run Lifecycle Design]] |
| D-013, D-037–D-040, D-058 | Bounded reads/search, standing own-project writes, eligible Shared/same-Closed-section reads, actual diffs/counts and native scoped context retrieval. | [[Repository & Context Tools]] |
| D-024, D-052–D-054, D-062 | One run/chat; sequential tools; project reservation plus model-capacity queues/reason/position; duplicate links permitted; no whole-run budgets; queued temporary work protected. | [[Run Lifecycle Design]] |
| D-042, D-046–D-047, D-057 | One stale/technical correction, one transient pre-output request retry, Continue as a new run, exact approvals and evidence-based unknown-outcome recovery. | [[Run Lifecycle Design]] |
| D-034, D-043, D-049, D-055–D-056, D-067 | Stop/crash/chat deletion keep completed edits; settle writers, preserve uncertainty, popup on reopen; queued prompts require explicit restart. Automatic restoration/Undo is deferred. | [[Run Lifecycle Design]] · [[Things to Optimize]] |
| D-050–D-051, D-064 | Scoped automatic operations, separate Git/network/remote authorization, instruction authority and permission refresh before later requests/actions. | [[Tools & Permissions]] |
| D-059–D-061, D-063 | Cascade owned folders/data, preserve external links, current manual/agent memory equal, missing-folder relink exception, fixed chat/model sessions. | [[Container & Settings Rules]] |
| D-065–D-066 | Requested existing-skill import and compact native core plus permission-filtered optional-tool discovery in pass 5. | [[Tools & Permissions]] |
| D-068–D-069 | Pass 3A split into command foundation and autonomous setup workflow; both implemented with recorded evidence. | [[Repository Project Setup Plan]] |
| D-070 | Preserve one repository/no release; missing-folder recovery remains the exception. | [[Container & Settings Rules]] |
| D-071–D-072 | v0.2: same-section project edit grants and isolated worktree groups; close after successful user-requested merge. Not implemented v0.1 permissions. | [[Repository Access & Worktree Plan]] |
| D-073–D-074 | v0.1 finishes current passes; v0.2 adds capabilities; v0.3 optimizes and adds parent-directed mixed-model/provider subagents. Later versions have no numbered passes yet. | [[Granite Vision & Roadmap]] |

D-005 (permanently fixed section modes) was replaced by D-007. D-008 (Shared-only moves) was replaced by the final movement rules above. D-043's earlier automatic-restoration implementation was deferred by D-067. General/Temporary separation, isolated-only temporary context, project-contained temporary chats, global unique repository ownership and separate preview approval are not current requirements.

The October 27 preview amendment allows useful agent-chosen local previews without separate preview authorization; terminal enablement, confined serving, explicit opt-outs and Stop remain. Download/deployment permissions are separate. See [[Tools & Permissions]] and [[Pass 3A.2 Implementation & Testing]].

The unresolved product choices for future v0.2 grants/worktrees live only in [[Repository Access & Worktree Plan#7. Recommendations and choices not yet settled]]. Exact schema, transaction, event and renderer implementation choices within settled behavior can be made during delivery. Do not reopen resolved questions merely because an old proposal referenced them.
