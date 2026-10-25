# Tool Permissions

> Agreed initial behavior, accepted as D-050 from P-010. This is a target specification, not implemented functionality. Detailed instruction precedence and skill/MCP configuration are agreed in [[Skills & MCP Policy]] (D-051).

Related: [[Tooling Strategy]] · [[Harness Design]] · [[Remaining Harness Decisions]] · [[Run Lifecycle Design]] · [[Decisions & Questions]]

## Existing constraints

Repository-project membership grants ordinary local repository read/write access without per-edit approval. Outside chats retain only their permitted reads; gaining a generic tool approval cannot bypass project membership or section scope. Identity changes retain the exact-action approval flow. Keep and project entry happen between runs. These constraints already apply across file, terminal and MCP paths.

## Agreed defaults

| Action | Initial permission |
| --- | --- |
| List, search and read permitted files | Automatic. |
| Ordinary local code edits in the chat's own repository project | Automatic under the agreed standing permission; show actual changes. |
| Local tests, builds, formatters and linters | Automatic when execution is confined to permitted locations and repository mutations are covered by change/outcome tracking. Use isolated temporary/cache locations where needed. Network access is separate. |
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

## Related agreed skill/MCP rules

Skill loading/authoring, external MCP capability grants, and detailed instruction precedence are agreed in [[Skills & MCP Policy]] (D-051). Instructions found in files may guide work, but cannot grant additional access. Connecting a local MCP server currently runs a program outside the terminal sandbox; connection approval alone cannot establish the target repository/memory boundaries. The current inventory in [[Tooling Strategy]] remains distinct from this agreed target policy. D-065 accepts a controlled user-requested installer for existing skill packages under `agent/tools/skills/`; importing files does not grant execution or new capabilities. D-064 applies changed permissions to the next request/tool execution without automatically cancelling work already in progress.
