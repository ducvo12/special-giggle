# Repository Access & Worktree Plan

> Scope accepted October 27, 2026 (D-070–D-072). This is planned behavior, not implemented or verified functionality. The user requested documentation only while another agent works on the backend. Preserve the current implementation, its uncommitted changes and recorded pass-3A results; implement this extension in a separate change set. Delivery sequencing has not been assigned a numbered pass.

Version assignment: **v0.2**, under [[Granite Vision & Roadmap]] (D-073). The user is still adding scope; do not structure v0.2 into passes. Subagent orchestration is a separate v0.3 goal (D-074), not required by this worktree feature.

Related: [[Harness Implementation Plan]] · [[Decisions & Questions]] · [[Container & Settings Rules]] · [[Repository & Context Tools]] · [[Tool Permissions]] · [[Concurrency & Limits]] · [[Remaining Harness Decisions]]

## 1. Keep the original repository attachment behavior

Each project has zero or one current repository attachment. Attaching a repository identifies the codebase that project primarily works on and supplies its default coding target. It does not make the project the exclusive place from which that repository can be edited.

**Repositories cannot be released or detached from projects.** The user withdrew the earlier release proposal because the remaining chats depend on their repository context. Preserve D-016/D-018/D-061: first attachment binds existing project chats, repository-bound chats cannot leave their project, and a project cannot return to chat-only by removing its attachment. Multiple simultaneous repository attachments are not part of this plan.

Keep the original missing-folder recovery exception: warn when the attached folder is unavailable and allow user-selected relinking after affected work settles, including to different code as already agreed in D-061. This is not unrestricted replacement of a reachable repository. Preserve old operation records against their original resource, refresh caches and re-orient the agent before fresh work. Failed first attachment leaves the project chat-only and must not delete existing user code.

Existing deletion rules remain separate: deleting a project is not a repository-release operation. Internal code follows its actual storage lifecycle under D-059; external linked code survives. Duplicate attachments across projects remain allowed with the existing warning under D-062.

## 2. Repository access follows section boundaries

The following matrix applies within the same Granite agent. It extends project-level editing permission without widening conversation/memory sharing or cross-agent access.

| Target repository | Read access | Edit access |
| --- | --- | --- |
| Attached to the current project | Allowed | Standing project permission, subject to normal tool/action controls |
| Attached to another project in the same section | Allowed | Requires user-granted access to that target repository |
| Attached to a project in another Shared section | Allowed | Read only; the same-section grant cannot authorize cross-section writes |
| Attached to a project in another Closed section | Unavailable | Unavailable |
| Belongs only to another agent | No access granted by this plan | No access granted by this plan |

A permanent chat in a project can receive a same-section grant even when its own project has no attached repository. Granting access does not add a second attachment, move the chat, change the target's owning project or unbind existing repository chats. A Closed section still permits collaboration among its own projects; it does not expose its repositories to other sections.

Section-level chats and temporary chats do not gain this new project-level editing exception. Preserve their existing read, Keep and eligible project-entry rules. A generic tool approval, repository instruction, model argument or guessed resource ID cannot create a grant. A clear user authorization should not require repeated per-file approvals within its scope. Git mutations, networking and remote actions retain their separate authorization requirements.

Read/write schemas, tool lookup, file operations, terminal sessions, Git operations and MCP paths must enforce the same target/grant/section checks on the backend. Extend the current owner-only tool boundary only for eligible granted targets; never expose arbitrary host paths. Recheck permissions before subsequent requests/actions under D-064 and prevent queued or stale calls from retaining revoked access. A grant does not bypass target scheduling or unresolved-outcome recovery.

The exact grant lifetime, persistence and UI remain implementation proposals to settle before enabling this capability. Access to repository files does not itself grant access to another project's chats or privileged configuration.

## 3. Worktrees appear as isolated subprojects

A project can contain worktree groups alongside ordinary project chats. Each group is a logical child of its parent project, representing one isolated checkout for a feature or task. It is not another independently attached project.

The user can open a worktree group, create chats inside it and prompt the agent directly there. Chats in a group target that group's checkout. Ordinary project chats target the main attached checkout. Worktree groups inherit their parent project's context eligibility and section rules; they do not create a new Shared/Closed boundary or authorize additional repositories.

```text
section/
├── project1/
│   ├── repository → main checkout
│   ├── worktree-frontend/
│   │   ├── chat1
│   │   └── chat3
│   ├── worktree-search/
│   │   └── chat4
│   └── chat2
└── project2/
    ├── repository → another repository
    └── chat5
```

This tree describes sidebar organization. It does not require nesting worktree files physically inside the original repository. Groups persist between messages until merged/closed; a new message must not silently create a fresh checkout or retarget the existing one.

Worktrees require Git. Ordinary projects may still reference folders without Git; do not silently initialize Git solely to offer worktrees. Show a useful unavailable state until the required initialization is authorized.

## 4. User-requested merge closes the worktree group

The agreed lifecycle is:

1. Create an isolated worktree for a feature or task.
2. Work through one or more chats in that group.
3. Keep the worktree available between messages.
4. When the user requests a merge, integrate its changes into the designated destination.
5. After a successful merge, automatically close the worktree and its active sidebar group.

A request to merge authorizes this successful-merge closure without another routine confirmation. A finished response alone does not request a merge. A failed, conflicted or genuinely uncertain merge keeps the group open and reports the actual state; never discard it because a merge was merely attempted.

Closing must not race with active writers, queued chats or previews. Integration needs to preserve unrelated destination edits and account for all work in the group, not just the requesting chat's last run. Stop/crash keeps completed edits under D-067; it is not permission to auto-merge, auto-close or replay an uncertain merge.

Recommended retention detail, still distinct from an agreed deletion policy: archive the closed group with its chats, change history and merge record rather than deleting the conversation. Remove the working folder only after processes settle and uncommitted, unmerged or otherwise unpreserved work is accounted for. Define recovery and retention before implementing automatic folder cleanup.

## 5. Concurrency and implementation implications

Keep one active run per chat. Different worktree groups can work concurrently on the same repository, subject to model capacity. Multiple chats inside one group share its files; they are not isolated from one another. Recommended scheduling default: queue writing runs against the same checkout, while permitting independent worktrees to proceed.

The current per-project reservation is a baseline to extend, not a reason to serialize every isolated group in that project. Record repository identity, workspace identity, source commit, destination, parent project and owning group independently of a mutable path. Bind operations, diffs, sessions, grants, previews and recovery records to the actual workspace they used.

Create and manage worktrees through controlled backend operations. Validate the linked worktree's metadata and its relationship to the expected Git repository without exposing shared Git metadata through generic file tools. Commands currently execute in isolated disposable copies with guarded publication; preserve that behavior and publish to the correct worktree. Do not copy a linked `.git` pointer into a command copy and let it operate on live shared metadata. Coordinate Git operations affecting shared state separately from file-edit reservations.

Duplicate links, granted cross-project edits and merges must not bypass the destination checkout's coordination or D-057 recovery blocks. A worktree isolates working files; it does not isolate shared Git state, service ports, databases or external effects. Keep actual conflict checks and report outcomes honestly.

Retain original-resource identity across missing-folder relinking. An existing worktree or old queued merge must not silently become associated with newly linked, different code. Do not remove worktree recovery data just because the parent project's displayed attachment path changed.

## 6. User interface direction

- Show the primary repository link and worktree groups beneath the parent project, with ordinary chats alongside them.
- Make the current editing target visible in a group's chat header and changes panel. Folder/editor actions must open that checkout.
- Show preparation, active work, ready-to-merge, merge conflicts and successful closure as distinct states. A completed chat response does not imply merged code.
- Show the merge destination and actual changes, plus a clear merge action. Successful merge removes/closes the active group; failed merge leaves a usable group.
- Identify the target repository when requesting same-section edit access; distinguish permission from attachment. Grant expiry/revocation controls follow the final grant-lifetime design.

## 7. Recommendations and choices not yet settled

These details are not new agreed behavior merely because they were discussed:

- **Grant lifetime:** decide whether same-section grants apply to a run, chat or longer-lived project scope; define persistence, revocation and queued-call invalidation.
- **Cross-project edits from an isolated group:** recommended default is no direct writes into another project's main checkout. Use a separately isolated target or an explicitly separate operation. Define this before combining grants and worktrees; do not silently weaken the isolation promise.
- **Starting state and integration:** choose explicit source/destination handling, committed-versus-dirty starting state, branch naming, merge method and conflict recovery. Never assume another session's unfinished edits are already in the new worktree.
- **Creation authority:** user-created groups are in scope. Whether an agent may create additional groups automatically under a standing setting, and how it exposes their purpose, remains to be decided. Creating a workspace does not authorize spawning another agent.
- **Storage and cleanup:** use a configurable managed location outside the main checkout and deletable project tree; the suggested `~/Granite Workspaces/<repository-id>/<workspace-id>/` is a proposal, not a fixed path. Define archival history, recoverable cleanup, ignored-file preservation and parent-container deletion of surviving workspaces.
- **Group context details:** inherit existing eligible project/section context; exact group summaries, history presentation and reopen behavior remain UI/storage choices.

Subagents remain deferred under D-003. Separate sessions are independently prompted chats/tasks; a subagent is work delegated and supervised by a parent agent. Either form needs explicit workspace isolation to avoid shared-file collisions. This plan enables isolated user-directed sessions, not subagent orchestration.

## 8. Acceptance checks for the future implementation

These are planned checks, not results:

1. Preserve existing attachments/chats across migration and reopen. Reject detach/release and a second attachment, retain repository-bound chat movement rules, and preserve original missing-folder recovery.
2. Exercise own-project, same-section granted/ungranted, other-Shared-section, other-Closed-section, temporary, section-level and different-agent access. Same-section grants must work for eligible chat-only projects without adding an attachment.
3. Ensure reads do not grant writes and file/terminal/Git/MCP paths cannot bypass scope. Revoked or stale grants fail before a new action; clear valid authorization avoids repeated per-file prompts.
4. Create/reopen two worktree groups in one project and prompt their chats independently. Confirm exact editor/command/diff/preview targets, persistent group membership and no changes to the main checkout during ordinary isolated edits.
5. Run separate groups concurrently; prevent colliding writers in the same group or destination checkout, including through duplicate links and granted cross-project access. Shared context writes retain revision guards.
6. Request a merge with unrelated destination edits, another active group chat and managed previews. Settle/coordinate affected work, preserve unrelated edits and integrate the intended group changes once.
7. Successful merge closes the active group; conflict, cancellation, failure and unknown effects preserve an actionable group and recovery state. Reopening after a crash must not blindly repeat integration or cleanup.
8. Verify cleanup preserves the final retained history/work policy, handles ignored or unmerged files and never deletes external targets merely by following a link. Exercise parent deletion and missing-folder relinking against old groups and operation records.

Before implementation, resolve the listed behavior choices needed by that change set, inspect the current backend rather than assuming this plan is already present, and add migrations/tests without overwriting concurrent work. Broader performance optimization and subagent design remain separate.
