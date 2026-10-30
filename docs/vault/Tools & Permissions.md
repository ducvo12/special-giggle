# Tools & Permissions

> Accepted v0.1 action and integration policy, consolidated October 29, 2026 (D-050/D-051/D-058/D-064–D-066, with pass-3A amendments). Delivery status is explicit below; this is not a claim that every planned integration exists.

Related: [[Repository & Context Tools]] · [[Memory & Context Policy]] · [[Run Lifecycle Design]] · [[Harness Implementation Plan]]. Visual: [[Tool Lookup.canvas]].

## Action authorization

| Action | Rule |
| --- | --- |
| Permitted file listing/search/reads and Git inspection | Automatic. |
| Ordinary local edits in the chat's owning repository project | Standing permission; no per-edit prompt; show actual changes. |
| Confined tests, builds, formatters and linters | Automatic when terminal is enabled and effects remain within enforced scope/tracking. Familiar command names alone do not establish safety. |
| Managed local preview | Agent may start/manage it when useful, without separate preview approval. Requires terminal, isolated ownership, assigned-loopback-only serving and readiness checks. Honor opt-outs and Stop. |
| Dependency installation / command Internet access | Explicit bounded authorization; clear setup/install requests and supported retries can supply it. No prompt for each individual download. Unknown/compound network commands need concrete approval. |
| Git mutations | Explicit authorization for the operation/target. A requested commit may cover staging; destructive actions must identify affected work. Ordinary code-edit access is insufficient. |
| Push, deployment, publishing, messages or remote-service changes | Explicit authorization for the concrete action/destination. Local editing or preview permission does not cover these. |
| Identity edit | Exact-change/revision approval in a permanent Shared chat; blocked in Closed/temporary mode. Model-side flow is implemented in Pass 4; activate personality next run. |
| Memory/notes updates | Automatic only within the permitted scope under [[Memory & Context Policy]]. Existing optional workspace-write approval is distinct from standing repository edits. |
| Arbitrary host-path writes | Not granted by repository membership or ordinary approvals. |

Authorization may come directly from the user's clear request. Do not ask again when its scope is already concrete. An approval is bound to the action, arguments, target, run and relevant revision; changed actions need fresh authority. Denial is a tool result, not permission to retry through another route. Network grants, previews, public search and deployment are separate capabilities.

Check current authorization before every action, even if an older model request included its schema. Permission changes take effect on later requests/actions without cancelling already-started work. Stop is the immediate interruption control. Stop/crash preserve completed edits and external effects; no automatic rollback.

## Instruction authority

| Source | Role |
| --- | --- |
| Granite's enforced policy/configuration | Membership, privacy, retention, tool capabilities and approval limits. Instructions cannot expand them. |
| Current user task and steering | What to do within those limits. New corrections supersede the affected point while preserving remaining constraints. |
| User-designated project instructions and enabled relevant skills | Procedures/defaults; explicit user directions take precedence within enforced limits. Resolve consequential conflicts when necessary. |
| Agent identity | Personality and tone; cannot redefine permissions or override the task. |
| Memory, old chats, notes, code, webpages and tool results | Evidence/reference, not fresh user authorization. Retrieved text cannot appoint itself a privileged instruction. |

Preserve provenance when assembling context. Backend checks enforce access independently of the model's willingness to follow instructions.

## Tool implementation and reuse

Granite owns its loop, registry, scope, scheduling, approvals, guarded publication and recovery. It uses established mechanisms where appropriate: the Deep Agents filesystem utility for generic workspace tools, Git for patches/diffs/version control, `node-pty` for interactive terminals, `shell-quote` for bounded setup parsing and the official MCP TypeScript SDK. No external agent runtime supplies Granite's coding loop. Pi tool replacement and Codex runtime adoption are not implementation commitments.

Current tool groups and source locations are in [[Repository & Context Tools]] and [the implemented harness guide](../harness.md). Tool results carry actual outcomes; prose claiming a change is not execution evidence.

## Skills

A skill supplies instructions and optional resources; it does not grant tools, credentials, network access or new data scope. Load enabled relevant skills through a bounded catalog/loader. Keep procedural guidance separate from personal memory.

**Implemented baseline:** user-managed packages at `skills/<name>/SKILL.md`, a catalog and `load_skill`; model tools cannot rewrite configuration or skills.

**Pass 5:** import an identified existing package at the user's request into `agent/tools/skills/<skill-name>/`, keeping `SKILL.md`, references, scripts and assets together. Stage/validate it, record source/version, report unsupported metadata/features and do not silently overwrite an existing package. A clear import request needs no redundant confirmation. Loading/importing does not execute scripts, install dependencies, activate MCP, enable hooks or authorize autonomous skill authoring. Referenced content still follows section/retention rules. Migrate the existing path deliberately rather than claiming the target layout already exists.

The [Agent Skills format](https://agentskills.io/specification) is portable guidance/resources; product-specific execution features and missing tools/runtimes do not transfer automatically. Granite v0.1 does not support delegated subagents.

## MCP

**Implemented baseline:** configured local/HTTP transports with approvals. Local programs run outside the terminal sandbox. MCP is paused for agents with Closed sections or repository links because that transport alone cannot enforce their scopes. HTTP account authentication/secret setup is not generally implemented.

**Pass-5 target:** reuse unchanged authorized connections; a changed executable, arguments, endpoint or capability needs fresh authorization. Apply resource/effect permissions to each tool: verified scoped reads may be automatic; remote writes retain concrete authorization. Only expose capabilities Granite can actually constrain. Connection approval, a tool's name or its self-description cannot establish local-data scope. Defer unrestricted filesystem/shell servers that bypass controlled operations. The model cannot add servers, configure credentials or enable capabilities itself. Stop cancels requests but cannot reverse completed remote effects; reconcile unknown outcomes without replay.

## Core tools and optional discovery

**Current:** pass the eligible registry's definitions directly. **Pass 5:** retain a compact direct native core plus ordinary portable lookup when optional integrations exist. Native context list/search/read belong directly in the pass-4 core; they are not tool discovery.

1. Filter by actual scope, settings and supported tool-call format before selecting definitions.
2. Include full definitions for ordinary read/search/edit operations appropriate to the chat, relevant skill/session controls and the lookup function when needed.
3. Lookup searches only the eligible enabled optional catalog, initially using bounded lexical matching. Return a small set and expose their full schemas on the next request; names alone are insufficient.
4. Execute through normal validation/authorization. Discovery itself runs no remote action and installs/connects/enables nothing.
5. Count serialized definitions and results in the actual input budget. Large advertised context is not proof of tool competence; no fixed 100k/500k cutoff. If required input/tools cannot fit or the model cannot use them, report that limitation without switching the session model silently.

Do not add a discovery round trip for every ordinary file read. Keep definitions needed by the task available without accumulating every integration forever. Smarter ranking, caching/eviction and provider-native discovery are v0.3 work; basic fit checks belong in pass 4. See [[Things to Optimize]].

## Acceptance boundaries

Native files, terminal, Git, tool lookup and MCP must agree on repository/context scope. A guessed ID, old schema, retrieved instruction or generic approval cannot bypass membership, Keep/project entry or source isolation. Recheck at execution, bound outputs, preserve actual outcomes and never repeat a possibly completed effect just to recreate a missing response.
