# Tooling Strategy

> Current-code inventory checked October 23, 2026, followed by a proposed implementation direction. This note does not implement the target harness or settle the remaining terminal/MCP permission rules.

Related: [[Harness Design]] · [[Remaining Harness Decisions]] · [[Run Lifecycle Design]] · [[Things to Optimize]]

## User preference

Reuse established repository tools where the work is the same as other coding harnesses. Build Granite-specific behavior around those implementations rather than rewriting ordinary repository operations without a concrete need.

## What exists today

Granite owns the model/tool loop and its tool registry. A model proposes a tool name and structured arguments; Granite validates the request, checks the current approval setting, executes the implementation, and returns the result to the model. These built-in tools do not require an MCP server.

| Tool | Current behavior | Implementation ownership |
| --- | --- | --- |
| `ls` | List a directory. | Granite schema/adapter over Deep Agents `FilesystemBackend`. |
| `read_file` | Read a bounded text-file range. | Granite schema/adapter over the same backend. |
| `glob` | Find filenames by a simple pattern. | Granite schema/adapter over the same backend. |
| `grep` | Search literal text, with at most 100 returned matches. | Granite adapter over the backend; the installed backend uses ripgrep when available, with a substring-search fallback. |
| `write_file` | Create a text file. | Granite schema/adapter over the same backend. |
| `edit_file` | Replace exact text, optionally every occurrence. | Granite schema/adapter over the same backend. |
| `write_todos` | Return a short structured task list to the harness. | Custom Granite tool; it does not itself persist a task database or write a file. |
| `load_skill` | Load an available skill's instructions. | Custom registry tool, present when skills are enabled and a catalog exists. |
| `terminal` | Run an approved shell command, with cancellation, bounded output and a 30-second limit. | Custom Node process runner using macOS `sandbox-exec`; optional and currently macOS-only. |
| Configured MCP tools | Discover and call tools offered by enabled servers. | Official MCP TypeScript SDK plus Granite connection, validation, approval and result adapters. Server implementations are external. |

The six file tools currently address the agent folder through virtual paths. Granite subclasses the backend to check containment, reject symbolic links and protect identity/configuration/skills from writes. They do not yet implement the planned external-project repository mounts, section visibility, per-run undo journal or change-count display. There is no dedicated Git, repository-diff or patch tool in the current registry; shell commands are the current general execution mechanism.

Current approval behavior is also a baseline: terminal and MCP calls require approval, and file writes depend on `approveWrites`. The planned standing permission for ordinary edits inside a repository project still needs to be implemented. Local MCP server programs currently execute outside the terminal sandbox, so connecting an arbitrary filesystem server is not sufficient to enforce the target access rules.

Source locations, relative to the Granite repository:

- `src/backend/harness/tools/workspace.ts`
- `src/backend/workspace/filesystem.ts`
- `src/backend/harness/tools/registry.ts`
- `src/backend/harness/tools/terminal.ts`
- `src/backend/harness/tools/mcp.ts`
- `src/backend/harness/loop.ts`

## Recommended direction — proposed

1. **Reuse repository mechanics.** Prefer maintained implementations for listing, ranged reads, search, edits and command execution. Use Git for Git operations and diffs rather than creating a version-control engine. Retain the current Deep Agents backend unless a specific requirement or comparison justifies replacing it.
2. **Keep Granite's policy and lifecycle in Granite.** Repository ownership, section access, approvals, cancellation, undo recording, conflict detection and visible change counts remain harness responsibilities. A reused tool must execute through those controls. A working-directory argument alone is not a permissions boundary.
3. **Evaluate Pi as an alternative tool source.** Pi exports individual TypeScript factories for read, write, edit, bash, grep, find and listing. Its edit tool accepts replaceable filesystem operations, which offers an integration point for Granite's checks and write recording. That makes it a candidate for a small compatibility comparison, not an adopted dependency or a reason to replace the entire model loop.
4. **Verify behavior before adoption.** Compare dependency size, license obligations, model/schema compatibility, output limits, cancellation, path confinement, stale-edit behavior and integration with the accepted Stop policy. Reuse should reduce implementation work without silently changing agreed behavior. Command and external-service effects still need the separate boundary in R-01/R-03.

A useful execution shape is: model proposal → Granite validation/access/approval → established tool implementation using controlled filesystem/process operations → recorded outcome/diff → model result. Mutation recording must cover the actual writes, not only the initial proposal. Arbitrary commands and MCP side effects cannot inherit a file-edit rollback guarantee merely by being placed behind the same registry.

R-01 in [[Remaining Harness Decisions]] now has agreed terminal/Git/network action defaults and skill/MCP configuration/instruction precedence in [[Skills & MCP Policy]] (D-050/D-051). Selecting a particular tool package is an implementation choice once it can satisfy those rules. Large-repository maps and context optimization remain deferred.

The initial execution-permission defaults are agreed in [[Tool Permissions]] (D-050, accepted from P-010). They preserve automatic ordinary repository edits and distinguish existing user authorization from a new approval prompt.

Visible tool selection by task, model context and tool-use compatibility is discussed in [[Tool Selection & Context]] (P-016, proposed). This does not change the implementation ownership or permissions above.

## Primary references checked

- [Deep Agents JavaScript filesystem backend](https://github.com/langchain-ai/deepagentsjs/blob/main/libs/deepagents/src/backends/filesystem.ts). The installed package is `deepagents` 1.15.1; local installed source was used for the current-code inventory.
- [Pi individual tool exports](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/index.ts).
- [Pi edit operations interface](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/tools/edit.ts).
- [Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) and [MIT license](https://github.com/earendil-works/pi/blob/main/LICENSE). Preserve required notices if code is copied. No Pi package has been installed for this planning discussion.
