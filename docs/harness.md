# Granite’s agent harness

Granite owns the agent loop. Model providers receive instructions, conversation items, and tool definitions, then return text or proposed tool calls. Granite validates those calls, applies permissions, requests approval, executes tools, and returns their results to the model. Codex is not started or used for authentication.

## Connect a model

Open **Settings → Connections → Add connection**.

- **ChatGPT account:** Choose **ChatGPT account**, then **Continue with ChatGPT**. Authorize Granite and eligible ChatGPT plan use in the browser. Select the saved account, optionally choose a default model and reasoning effort, and save one connection. In chat, select that connection and choose among its available models beside Send. Granite loads the account’s current catalog automatically, displays model names, remembers the selection per connection, and offers a refresh button. The backend checks the selected model against that account’s catalog before inference. This uses Granite’s own registration and encrypted credentials. It does not access Codex’s credentials or ChatGPT conversation history. The exposed catalog may differ from the ChatGPT app’s model picker; availability follows the account/workspace grant and OpenAI’s current local/open-source eligibility rules.
- **OpenAI API:** Choose **API connection**, set **API protocol** to **Responses**, enter `https://api.openai.com/v1` and your API key, load or enter a model, and save.
- **Local/compatible server:** Keep **Chat Completions**, enter the server’s API base URL, and load its models. Existing API connections keep their original protocol by default.

The earlier Codex app-server adapter has been removed. Legacy connection records remain readable and deletable. Edit one to reconnect through ChatGPT or configure an API connection. Existing agents, identities, memory, conversations, and legacy checkpoints are preserved.

The supported ChatGPT plan flow calls the public Responses endpoint directly with `store: false` and `stream: true`. Granite keeps the full required input history locally; it does not use HTTP `previous_response_id`. Function tools are grouped in the `granite` namespace. See [Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), and [preview limits](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## Identity, memory, and instructions

Each turn loads the selected agent’s profile, `identity.md`, `memory.md`, and additional instructions from its own settings. Granite assembles these into the model’s instructions. Changing a provider does not change the agent’s identity or memory.

Memory is an ordinary protected-workspace file. The agent can read and update explicit preferences through file tools; it is instructed to read first and avoid secrets or speculative facts. Granite does not create automatic embeddings or infer memories in the background.

Native Responses items, including opaque encrypted reasoning, are retained in SQLite’s `harness_state` table. They are replayed in order on subsequent requests to the same model/provider/account. They are not exposed through the renderer conversation bridge. Display messages remain separate from provider state. Changing providers or recovering an interrupted run rebuilds context from visible messages and recorded tool outcomes. Unfinished tool calls are never automatically replayed.

## Tools and approvals

Open **Tools & skills** in the sidebar for the selected agent.

Workspace tools list/read/write/edit files, find filenames, search contents, and record task lists. The virtual root is the agent’s folder. Parent traversal and symbolic-link access are rejected. Identity, agent configuration, harness settings, and skill instructions cannot be modified through file tools. Enable **Ask before each workspace file change** to require approval for writes and edits.

Approvals are scoped to one pending action and one active request. **Allow once** resumes that action; **Deny** returns a tool error to the model. **Stop agent** cancels the run and invalidates pending approvals. A permission is enforced in backend code, independently of the model’s instructions. Tool inputs, results, and status appear in the conversation. Completed changes remain after Stop.

### Skills

Create or edit skills in **Tools & skills**. Granite stores each skill at `skills/<name>/SKILL.md` inside the agent’s folder. A run exposes a bounded catalog and a `load_skill` tool so the model can retrieve relevant instructions. A skill does not grant permissions or execute scripts by itself. Skills are read-only to model tools and terminal commands; the user manages them through the application. Disable the skill catalog and loader per agent when desired. Ordinary workspace reads still follow the workspace file policy.

### MCP

Add a named MCP server using a local executable and separate arguments, or a Streamable HTTP address. Remote addresses require HTTPS; loopback HTTP is supported for local services. Enable only the servers this agent needs.

Granite asks before starting a local server or connecting to an HTTP server, and again before every MCP tool invocation. It discovers tools through its own MCP client, gives each an unambiguous name, validates arguments against the supplied schema, and forwards approved results to the model. MCP connects independently of the model provider, so it also works when hosted MCP is unavailable through a subscription endpoint.

Local MCP programs are trusted extensions: after approval, they run with the user’s computer permissions, outside the terminal sandbox. HTTP MCP authentication/OAuth and secret configuration are not implemented in this version. Do not put credentials in server arguments or URLs. Servers requiring account sign-in fail with an explanatory error. MCP clients are closed when the run completes, stops, or fails.

### Terminal

Terminal execution is disabled by default and always requires approval when enabled. The current sandbox uses macOS `sandbox-exec`; the application disables this option on other platforms until a corresponding sandbox is implemented.

Commands run from a checked directory inside the agent workspace, with a minimal environment and no inherited model credentials. The sandbox permits the workspace and required system runtime reads, blocks reads of other user files, blocks network access, and denies changes to identity/configuration/skills. It has a 30-second command limit and a 32,000-character output budget. Stop terminates the process group, including child processes. It is a command runner, not a persistent interactive terminal session.

## Limits and recovery

Granite has no fixed run deadline, model-step limit, or total tool-call limit. Stop cancels active work. It enforces a two-million-byte context budget before each model step, bounded tool results, and 200 visible messages per conversation. It retries only transient HTTP service failures before a response stream starts. It never retries a tool action automatically. If a conversation exceeds its budget, start a new chat; identity, memory, skills, and workspace files remain available. Automatic context summarization/compaction is not implemented yet.

Provider failures are redacted before display or persistence. Partial text and completed tool activity survive failure and restart. Native state is committed only with a completed turn. Agent deletion removes the entire folder, messages, native state, and all tracked legacy checkpoints.

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

The ChatGPT model-picker check instruments a disposable build and profile with mock account credentials and a local catalog/inference server. It verifies saving one account connection without a fixed model, switching models in the same chat, remembering the selection after restart, refreshing changed catalogs, retrying failed discovery, and rejecting unavailable models before inference. It consumes no real account usage.
