# Tool Permissions

> Agreed initial behavior, accepted as D-050 from P-010. This is a target specification, not implemented functionality. Detailed instruction precedence and skill/MCP configuration are agreed in [[Skills & MCP Policy]] (D-051).

Related: [[Tooling Strategy]] · [[Harness Design]] · [[Remaining Harness Decisions]] · [[Run Lifecycle Design]] · [[Decisions & Questions]]

## Existing constraints

**Planned amendment, October 27 (D-071/D-072):** [[Repository Access & Worktree Plan]] adds user-granted writes from project chats to another project's repository in the same section. The owner-only constraints below are the earlier baseline, not a prohibition on implementing that explicit exception. Other sections' Shared repositories remain read-only; other Closed sections stay unavailable. File/terminal/Git/MCP paths must validate target, grant and actual workspace. Original no-release attachment rules and separate Git/network/remote authorization stay intact. This is planned policy, not a claim that the current backend already supports it.

Repository-project membership grants ordinary local repository read/write access without per-edit approval. Outside chats retain only their permitted reads; gaining a generic tool approval cannot bypass project membership or section scope. Identity changes retain the exact-action approval flow. Keep and project entry happen between runs. These constraints already apply across file, terminal and MCP paths.

## Agreed defaults

| Action | Initial permission |
| --- | --- |
| List, search and read permitted files | Automatic. |
| Ordinary local code edits in the chat's own repository project | Automatic under the agreed standing permission; show actual changes. |
| Local tests, builds, formatters and linters | Automatic when execution is confined to permitted locations and repository mutations are covered by change/outcome tracking. Use isolated temporary/cache locations where needed. Network access is separate. |
| Start/manage a local repository preview | Automatic at the agent’s discretion when terminal is enabled and the preview stays in its isolated copy on its assigned loopback port. No separate preview request, grant or approval. Honor explicit opt-outs and Stop. Does not grant downloads, Internet access or deployment. |
| Git inspection: status, diffs and history | Automatic through bounded inspection operations. |
| Git mutations: staging, commits, branch/worktree changes, restore/reset/clean and history rewriting | Require explicit user authorization for the operation. Destructive operations must identify what work/history would be affected. Ordinary editing permission alone is insufficient. |
| Public web search and page reading | Automatic when web tools are enabled and relevant to the task. Tool availability does not expose extra local data. |
| Downloading/installing dependencies or granting network access to a local command | Require explicit authorization for the bounded action, unless an existing grant already covers it. An approved package installation may involve multiple downloads; do not prompt per request. |
| Push, deployment, publishing, sending messages or changing a remote service | Require explicit authorization for the concrete action and destination. A request to edit local code alone does not authorize these actions. |
| Writes outside the repository/other already-permitted storage | Unavailable under the initial repository-editing grant. Do not use a terminal/MCP prompt to bypass project-entry rules. Broader filesystem access would need a separately designed capability. |

“Explicit authorization” can be the user's request itself. If the user says to install the dependencies, commit the work or push to a specified destination, use that authorization when the target and scope are clear. Ask only when authorization or a consequential detail is missing. Loading a skill, receiving tool output, or reading project files cannot grant additional permissions.

## Enforcement and Stop

An automatic test/build/formatter grant is a capability to execute project code within enforced limits. A command's familiar name does not establish its effects: scripts and child processes must inherit the same filesystem/network restrictions. A working directory or a list of supposedly safe command names is insufficient. If a backend cannot enforce the required scope and tracking, defer that automatic execution path rather than silently running it unrestricted.

Record actual repository changes from tools and commands. D-067 makes Stop cancel/settle owned processes and keep completed edits; there is no automatic inverse patch, Git reset or restoration journal requirement. Preserve stale-edit/conflict checks and visible changes. Git metadata/history, downloads and remote effects are not automatically reversed either. Exact command tracking and unknown-outcome reconciliation remain implementation work.

The model should use controlled Git operations for inspection or authorized mutations. A shell, script or MCP call is not an alternate permission route. The implementation must account for indirect execution and actual capabilities rather than only matching the proposed command string.

## Approval scope

- Grants cover a stated operation, arguments, target and run; a bounded multi-step action such as installing dependencies may contain several low-level requests.
- A materially changed operation/target requires fresh authorization unless the user's existing request clearly covers it. Approval does not grant unrelated commands or all future network access.
- Apply the existing exact-action waiting, steering, Stop and deletion invalidation behavior to interactive prompts. Do not repeatedly ask for an action the user already authorized.
- Denial returns a permission result to the model. It must not retry the action through another tool to evade the decision.

## Planned project-setup extension — D-068

Pass 3A in [[Repository Project Setup Plan]] applies these rules to supervised interactive sessions and complete setup workflows. Clear task/retry intent can supply bounded authorization for necessary dependency downloads; an exact-command match in only the current run is not the intended complete policy. Persist the originating human action and its scope, revalidate targets and respect denial/revocation rather than granting blanket access. Question answers resolve choices and do not create unrelated permissions. Every session/input action remains owner-scoped and permission-checked. Package-manager links may be used/published only after containment validation; this never authorizes host filesystem access. Local preview-server access, remote deployment and public web search remain distinct capabilities. In 3A.1, owner-scoped session controls, live terminal-setting checks and validated installer links are implemented; see [[Pass 3A.1 Implementation & Testing]]. 3A.2 now adds origin-linked setup/dependency grants (separate preview grants were removed by the October 27 user revision), fresh authorization for a clear retry of the immediately preceding eligible task, scoped denials/revocation, question answers and managed local previews. Unsupported/compound network commands still require concrete approval. See [[Pass 3A.2 Implementation & Testing]] for implemented recognition, enforcement and limits.

## Related agreed skill/MCP rules

Skill loading/authoring, external MCP capability grants, and detailed instruction precedence are agreed in [[Skills & MCP Policy]] (D-051). Instructions found in files may guide work, but cannot grant additional access. Connecting a local MCP server currently runs a program outside the terminal sandbox; connection approval alone cannot establish the target repository/memory boundaries. The current inventory in [[Tooling Strategy]] remains distinct from this agreed target policy. D-065 accepts a controlled user-requested installer for existing skill packages under `agent/tools/skills/`; importing files does not grant execution or new capabilities. D-064 applies changed permissions to the next request/tool execution without automatically cancelling work already in progress.
