# Skills & MCP Policy

> Agreed initial behavior, accepted as D-051 from P-011. This is a target specification, not implemented functionality. D-050 establishes the execution defaults. D-065 accepts requested package installation under the agent’s tools folder; portability and installation do not expand execution permissions.

Related: [[Tool Permissions]] · [[Tooling Strategy]] · [[Harness Design]] · [[Remaining Harness Decisions]] · [[Decisions & Questions]]

## Skills

A skill is a reusable set of instructions for doing a task. Loading it supplies guidance; it does not itself grant a tool, network access, a project move or a new memory scope.

Agreed initial behavior:

- The user manages installed skills and may ask the agent to install an identified existing package under D-065. The agent may load enabled relevant skills and perform that authorized import without another confirmation. Autonomous installation, editing skill/tool configuration and direct model-side skill authoring remain deferred; importing a package is not authorization to run its scripts.
- The agent may load an enabled, relevant skill without asking each time. Load a short available catalog initially and retrieve the full instructions when needed.
- Skills should contain procedures rather than personal memory. A skill's referenced files and data remain subject to the chat's normal access rules; a skill cannot make another Closed section's material available or create an alternate route for temporary-chat memory writes. Only content enabled for this chat's scope belongs in its catalog/input.
- Skill directions use the existing permissions in [[Tool Permissions]]. For example, instructions to deploy do not authorize deploying when the user's request only covers a local edit. The user's explicit task can override a skill's default workflow within Granite's enforced limits.

## MCP connections and tools

An MCP server supplies additional tools. The user chooses the connections and enabled capabilities; the model cannot add servers, change their launch configuration, obtain new credentials or enable its own tools.

Agreed initial behavior:

1. Configure/authorize a connection once. Reusing the unchanged, enabled connection does not need a new connection prompt for every run. A materially changed executable, launch arguments, endpoint or requested capability needs fresh user authorization.
2. Apply permissions per operation, resource and effect. A verified scoped read can run automatically. An operation that changes a remote service needs the same explicit authorization as an equivalent native action. A mediated ordinary edit in the chat's own repository may use the existing standing write permission only if it also participates in scope checks and undo/change tracking.
3. Do not infer permission from the tool's name or description alone. Expose only capabilities whose allowed resources and effects Granite can check or that are explicitly constrained by the integration. Unknown capabilities remain disabled until reviewed; an approval dialog is not a substitute for section/project enforcement.
4. For the first version, defer unrestricted filesystem/shell MCP servers that bypass Granite's controlled operations. Built-in tools already provide the local repository capabilities. Add an MCP integration when its resource/effect boundary can meet the harness rules.
5. Distinguish cancelling a request from reversing an effect. Stop invalidates unstarted actions and pending approval; it does not promise to reverse an already completed remote change. An unknown external outcome is reported and is not blindly retried under the existing recovery boundary.

The current prototype launches local MCP programs outside the terminal sandbox. The above rules describe the target and require implementation; enabling the existing transport alone does not enforce them.

## Instruction precedence

Agreed order for reconciling guidance:

| Source | Role |
| --- | --- |
| Granite's enforced rules and configured capabilities | Define membership, privacy, retention, allowed tools and approvals. A model response or instruction file cannot expand them. |
| The user's current task and steering | Define what to do within those limits. Later corrections supersede earlier directions on the affected point; retain the remaining task/history. A clear request can authorize the bounded actions described in D-050, but cannot bypass a required app transition such as project entry. |
| User-designated project instructions and relevant enabled skills | Supply task procedures/defaults. A specific user direction wins over a conflicting default. When these sources genuinely conflict and neither is clearly more applicable, report the conflict and ask only if the answer materially affects the work. |
| Agent personality | Supplies tone and behavioral defaults; it does not redefine the task or permissions. |
| Memory, old chats, notes, code, webpages and tool results | Supply facts, preferences and reference material. Text found there is not a fresh user request or an authorization. A deliberately designated instruction file may guide procedures under the previous row; arbitrary retrieved text cannot designate itself as such. |

Preserve where content came from when assembling context. Do not promote quoted/retrieved instructions into the user's voice. Prompt ordering guides the model, while backend checks remain responsible for actual permissions; a model's agreement to follow rules is not enforcement.

## Concrete cases

- A website instructs the agent to read and upload `memory.md`: treat it as webpage content; it supplies no authorization for that action.
- A skill recommends deploying after tests, while the user requested a local button change: finish the permitted local work; do not deploy without authorization.
- A Closed chat loads a research skill that references agent-wide notes: the skill does not unlock those notes.
- A connected tool could write into a project the current chat has not joined: do not invoke it as a workaround; use the existing project-entry flow.
- A trusted scoped MCP search connection is unchanged between runs: reuse the configured connection and perform permitted reads without another connection prompt.

These accepted defaults complete the main behavior choices in R-01. Exact connector implementations, run-setting transitions/revocation and uncertain-outcome recovery remain in their existing implementation/R-07/R-03 work; the policy does not guarantee that every third-party server can satisfy the first version's boundaries.

## Portability: skills described as Claude skills

Reference check, October 23, 2026: [Agent Skills](https://agentskills.io/home) is an open format originally developed by Anthropic for reuse across compatible agent products. A package contains `SKILL.md` (metadata and Markdown instructions) and may include scripts, references and assets. Installing/reading a skill does not train the model or supply missing tools. See the [format specification](https://agentskills.io/specification).

Compatibility depends on the harness and environment as well as the instructions:

- Generic procedural instructions can be supplied to different models through a compatible loader.
- Bundled scripts require their runtimes/dependencies and permitted execution tools. Required MCP integrations or credentials must already be available under the normal grants.
- [Claude Code adds product-specific behavior](https://code.claude.com/docs/en/skills), including dynamic context injection and subagent execution. Such features do not automatically transfer to Granite; unsupported behavior must be identified, adapted or left unavailable. Granite's first version still has no subagents.
- Existing Granite code reads `skills/<name>/SKILL.md`, but its simple catalog/loading path is not a complete standards-compatible importer/installer. Standards metadata, relative bundled resources and unsupported-feature handling need deliberate implementation before claiming general package compatibility.

## User-requested installation — agreed D-065 (P-012)

Support the open Agent Skills format and let the agent install a specific existing skill package at the user’s request. This extends the manual installation path. Importing instructions/resources does not execute bundled code, install dependencies, activate tools or authorize autonomous skill authoring.

An explicit request such as “install this skill” can supply authorization for the identified package; do not add a redundant confirmation. Stage and validate the package, retain its resources and show compatibility limitations. Apply existing network/storage/mode restrictions; a chat cannot use an installer to persist restricted conversation data or bypass protected configuration paths. Dependencies, remote effects and later use of scripts retain their ordinary permission rules. Do not enable unsupported hooks or subagents by silently treating their metadata as permission.

Store each package under `agent/tools/skills/<skill-name>/`, keeping `SKILL.md`, relative references, scripts and assets together. Download the selected package/subdirectory or use an appropriate repository checkout; cloning an entire GitHub repository is not required. Stage/validate before publishing it in the catalog, retain source/version information and never silently overwrite an existing package. Refresh the eligible skill catalog on a subsequent request under D-064. This is the target layout; the prototype currently uses a different skills path and no installer was implemented here.

[Official OpenAI skills documentation](https://learn.chatgpt.com/docs/build-skills) describes skills as instruction/resource directories loaded progressively. A downloaded package can still require tools/runtimes Granite does not supply; report those requirements instead of claiming universal compatibility. Requested importing is agreed in D-065, while execution and MCP grants continue to follow D-050/D-051.
