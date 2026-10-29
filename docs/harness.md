# Granite’s agent harness

> Implemented behavior, reviewed October 29, 2026. For planned context/lifecycle features and version boundaries, use [the vault index](<vault/Start Here.md>) and [implementation plan](<vault/Harness Implementation Plan.md>).

Granite owns the agent loop. Model providers receive instructions, conversation items, and tool definitions, then return text or proposed tool calls. Granite validates those calls, applies permissions, requests approval, executes tools, and returns their results to the model. Codex is not started or used for authentication.

## Connect a model

Open **Settings → Connections → Add connection**.

- **ChatGPT account:** Choose **ChatGPT account**, then **Continue with ChatGPT**. Authorize Granite and eligible ChatGPT plan use in the browser. Select the saved account, optionally choose a default model and reasoning effort, and save one connection. In chat, select that connection and choose among its available models beside Send. Granite loads the account’s current catalog automatically, displays model names, remembers the selection per connection, and offers a refresh button. The backend checks the selected model against that account’s catalog before inference. This uses Granite’s own registration and encrypted credentials. It does not access Codex’s credentials or ChatGPT conversation history. The exposed catalog may differ from the ChatGPT app’s model picker; availability follows the account/workspace grant and OpenAI’s current local/open-source eligibility rules.
- **OpenAI API:** Choose **API connection**, set **API protocol** to **Responses**, enter `https://api.openai.com/v1` and your API key, load or enter a model, and save.
- **Local/compatible server:** Keep **Chat Completions**, enter the server’s API base URL, and load its models. Existing API connections keep their original protocol by default.

The earlier Codex app-server adapter has been removed. Legacy connection records remain readable and deletable. Edit one to reconnect through ChatGPT or configure an API connection. Existing agents, identities, memory, conversations, and legacy checkpoints are preserved.

ChatGPT model catalogs load in the background as soon as the app starts and remain cached per account for that app session. Messages and connection/model switches reuse the cached list. **Reload models** in Connections explicitly fetches a new list. A model-access error also refreshes the list, without automatically replaying the failed prompt or completed tools. New sign-ins load their own catalog; signing out clears that account's cached list. If discovery fails, use **Reload models** to retry.

The supported ChatGPT plan flow calls the public Responses endpoint directly with `store: false` and `stream: true`. Granite keeps the full required input history locally; it does not use HTTP `previous_response_id`. Function tools are grouped in the `granite` namespace. See [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), and [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Identity, memory, and instructions

Each run loads the selected agent’s profile/personality and user instructions; eligible `memory.md` is refreshed before subsequent model requests. Personality remains fixed during that run and changes take effect next run. Granite assembles these into the model’s instructions. New chats can use another provider while preserving the agent’s identity/memory; a used chat remains bound to its model/provider. Existing-session migration is not supported.

Memory is an ordinary protected-workspace file. Full Shared/Closed scoped retrieval, source-backed incremental summaries, model-aware compaction and model-proposed identity approval are planned for pass 4. Closed runs remain gated until isolation exists; temporary runs/expiry await pass 5. The agent can read and update explicit preferences through file tools; it is instructed to read first and avoid secrets or speculative facts. Granite does not create automatic embeddings or run a background memory extraction system.

Native Responses items, including opaque encrypted reasoning, are retained in SQLite’s `harness_state` table. They are replayed in order on subsequent requests to the same model/provider/account. They are not exposed through the renderer conversation bridge. Display messages remain separate from provider state. Recovering an interrupted run rebuilds compatible context from visible messages and recorded tool outcomes; it does not authorize provider switching within an existing chat. Unfinished tool calls are never automatically replayed.

## Tools and approvals

Open **Tools & skills** in the sidebar for the selected agent.

Workspace tools list/read/write/edit files, find filenames, search contents, and record task lists. The virtual root is the agent’s folder. Parent traversal and symbolic-link access are rejected. Identity, agent configuration, harness settings, and skill instructions cannot be modified through file tools. Enable **Ask before each workspace file change** to require approval for writes and edits.

Approvals are scoped to one pending action and one active request. **Allow once** resumes that action; **Deny** returns a tool error to the model. **Stop agent** cancels the run and invalidates pending approvals. A permission is enforced in backend code, independently of the model’s instructions. Tool inputs, results, and status appear in the conversation. Completed changes remain after Stop.

### Repository capabilities

Permanent owning-project chats receive standing repository reads/writes, patches, renames/deletions, controlled Git, commands and actual diff/count reporting. Other eligible chats can read Shared repositories or repositories in their own Closed section; only owning-project members may write in v0.1. Outside requests propose a separately confirmed permanent project move. The v0.2 same-section edit-grant/worktree proposal is not enabled by that visibility.

Runs serialize within a repository project, including text-only questions, while independent projects can proceed within model capacity. Duplicate physical links are allowed; they do not establish a global write lock. Revisions and unknown-outcome recovery remain enforced. Current tools and targets: [repository/context tools](<vault/Repository & Context Tools.md>).

### Skills

Create or edit skills in **Tools & skills**. Granite stores each skill at `skills/<name>/SKILL.md` inside the agent’s folder. A run exposes a bounded catalog and a `load_skill` tool so the model can retrieve relevant instructions. A skill does not grant permissions or execute scripts by itself. Skills are read-only to model tools and terminal commands; the user manages them through the application. Disable the skill catalog and loader per agent when desired. Ordinary workspace reads still follow the workspace file policy.

### MCP

Add a named MCP server using a local executable and separate arguments, or a Streamable HTTP address. Remote addresses require HTTPS; loopback HTTP is supported for local services. Enable only the servers this agent needs.

Granite asks before starting a local server or connecting to an HTTP server, and again before every MCP tool invocation. It discovers tools through its own MCP client, gives each an unambiguous name, validates arguments against the supplied schema, and forwards approved results to the model. MCP connects independently of the model provider. Connections are currently paused when the agent has Closed sections or repository links, because the existing transport cannot enforce those scopes. Scoped integrations, connection reuse and optional discovery remain pass 5.

Local MCP programs are trusted extensions: after approval, they run with the user’s computer permissions, outside the terminal sandbox. HTTP MCP authentication/OAuth and secret configuration are not implemented in this version. Do not put credentials in server arguments or URLs. Servers requiring account sign-in fail with an explanatory error. MCP clients are closed when the run completes, stops, or fails.

### Terminal

Terminal execution is disabled by default. Workspace terminal calls require approval when enabled; repository commands use the project grant and separate authorization for network or Git mutations. The current sandbox uses macOS `sandbox-exec`; the application disables this option on other platforms until a corresponding sandbox is implemented.

Commands run from a checked directory inside the agent workspace, with a minimal environment and no inherited model credentials. The sandbox permits eligible workspace paths and required system runtime reads, blocks reads of other user files, blocks network access, and denies changes to identity/configuration/skills. Commands run until completion or Stop with no fixed elapsed-time limit; output previews have a 32,000-character budget for memory safety. Stop cancels owned command work and settles its supervised processes; repository commands additionally use isolated copies so detached work cannot write the live repository. This workspace tool is noninteractive.

Repository project chats additionally expose `repo_command` for blocking noninteractive work and `repo_command_start`, `repo_command_read`, `repo_command_input`, `repo_command_stop` for supervised interactive work. A session has a real terminal, incremental sanitized output, input revision checks and resize support. Only its owning run can use it. The command panel shows status, output and staged/applied/discarded outcomes.

Each command runs against a disposable repository copy. Related commands in a run share an isolated HOME/cache; successful publication makes installed dependencies available to the next copy. A running shell preserves its own working directory and exported variables. New shells use their specified directory/environment. The live repository receives changes only after process settlement, safe-link validation and revision checks. Contained relative package-manager links are supported; escaping, absolute and protected targets remain rejected. Source changes are listed separately from summarized generated dependencies/build output.

The macOS boundary still denies host secrets and live-repository writes. A command can signal its own confined workers and use its own terminal, which framework builders require; it gains no host process control. Explicitly authorized command networking remains separate from web search. Stop settles owned processes, discards unfinished staged work and retains edits already published. Ordinary command sessions/cache close at run end. A verified ready preview has its own managed lifetime and can survive the reply.

`ask_user` shows missing consequential choices in a question panel, with suggested options and free text. Answering resumes the same task without holding a model slot while waiting. Stop or a new direction withdraws the old question; answers are tied to that task and stored in its transcript. The agent reuses known choices/defaults and should not ask for secrets in chat.

**Task permissions** shows bounded setup/download grants and their state, with a Revoke control. Clear Next.js/Vite setup requests, supplied supported package commands and necessary dependency steps can run under the task's grant. A clear retry derives fresh scope from the immediately preceding eligible action; it does not restore a denied grant or authorize unrelated networking/deployment. Unknown and compound network commands still need concrete approval. Terminal enablement remains separate.

`repo_preview_start/read/list/stop` let the agent start and manage local previews whenever useful, with no separate preview authorization or approval. Terminal must still be enabled; explicit user instructions not to preview and Stop actions still apply. Preview actions do not grant Internet downloads or deployment access. The UI shows status, output, code snapshot/time and address, with Open, Refresh and Stop controls. Bind to Granite's HOST/PORT; only the assigned loopback port is available and public networking is denied. Readiness checks HTTP and owned listener identity. A preview stays in an isolated copy, publishes no writes, and holds no model/project capacity while idle. Refresh prepares newer code; stale snapshots are labeled. Stop, deletion and shutdown settle owned previews; restart recovery reports interruption without replay. See [second-pass results](<vault/Verification/Pass 3A.2 Implementation & Testing.md>), [first-pass foundation](<vault/Verification/Pass 3A.1 Implementation & Testing.md>) and [full setup plan](<vault/Repository Project Setup Plan.md>).

Links in replies and rendered Markdown open in the system browser when clicked. Only absolute HTTP/HTTPS URLs without embedded credentials are accepted; file and application protocols remain blocked. Granite does not navigate its own window to the linked page.

## Limits and recovery

Granite has no fixed run deadline, model-step limit, or total tool-call limit. Stop cancels active work. The loop currently checks a two-million-byte input/instruction guard before each model step and bounds tool-result/output previews. This is not full model-token accounting of serialized tool schemas; pass 4 replaces the baseline with model-aware fit/compaction. Stored transcript retention is separate from the input view. It retries only transient HTTP service failures before a response stream starts. It never retries a tool action automatically. If mandatory input exceeds the current guard, narrow the task or start a new chat; saved files remain available within scope. Automatic context summarization/compaction is not implemented yet.

Startup reports interrupted work without automatically replaying runs/commands/previews; queued prompts require explicit restart. Known completed edits are retained, while genuine unknown outcomes block affected writes until reviewed.

Provider failures are redacted before display or persistence. Partial text and completed tool activity survive failure and restart. Native state is committed only with a completed turn. Existing agent/chat deletion requires work to finish, stops owned previews and removes associated settled state; unresolved recovery data cannot be erased. Full cancel-and-delete cascade for sections/projects and source cleanup remains pass 5. Agent folder deletion includes internal code; external linked folders survive.

ChatGPT sign-in validates OAuth state, PKCE, the ID-token signature, issuer, audience, expiry, nonce, and granted plan scopes. Credentials use OS-protected encryption. Refreshes are serialized to protect rotating tokens. Signing out revokes Granite’s renewable session when possible, clears its local tokens, and preserves its registration mapping for later sign-in. This does not sign out Codex. If remote revocation cannot be confirmed, the UI says so.

## Source organization and verification

- `src/backend/harness/`: Granite’s loop, permissions/approvals, per-agent settings, provider adapters, file/skill/MCP/terminal tools.
- `src/backend/auth/`: independent ChatGPT authorization and protected account storage.
- `src/backend/agents/`: agent lifecycle, worker bridge, SQLite display/native state, and legacy storage migration.
- `src/renderer/src/features/harness/`: per-agent controls and the approval dialog.

The filesystem backend remains a library utility; no external agent framework runs the tool loop. The historical SQLite checkpoint library remains for migration and cleanup. Electron main and the agent worker are built independently so shared bundler helpers cannot cause main to execute the worker entry point.

Run `npm test` for model-loop, OAuth, permissions, terminal-boundary, MCP subprocess, recovery, migration, and deletion tests. OAuth tests use locally signed tokens and a mock issuer; they do not log into a real ChatGPT account. A real user still completes the browser grant to enable their subscription connection.

After `npm run build`, the macOS desktop acceptance checks use isolated temporary profiles:

```sh
node scripts/verify-harness-desktop.mjs
node scripts/verify-chatgpt-models-desktop.mjs
node scripts/verify-desktop.mjs
node scripts/verify-agents-desktop.mjs --offline
```

The harness check exercises the actual settings editor, skill saving, Responses connection, approval denial and allowance, Stop while waiting for approval, and restart persistence. It uses a mock model and consumes no account usage.

The ChatGPT model-picker check instruments a disposable build and profile with mock account credentials and a local catalog/inference server. It verifies saving one account connection without a fixed model, model-selection controls and persistence, refreshing changed catalogs, retrying failed discovery, and rejecting unavailable models before inference. It consumes no real account usage.

That model-picker runner originated before fixed session binding; its historical switching cases do not override the current used-chat binding rule. Consult its current assertions before using it for acceptance. Broader unverified cases remain in [Tests to Run Later](<vault/Tests to Run Later.md>).
