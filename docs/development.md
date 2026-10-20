# Granite desktop development

Requirements: Node.js 22.12+ (or a current supported release) and npm.

```sh
npm install
npm run dev
```

The development command opens Electron and serves the React interface with hot reload. Main and preload changes are rebuilt by electron-vite. Development data uses a separate `Granite Development` application-data directory.

## Build and package

```sh
npm run build
npm run preview
npm run package
npm run dist
```

- `build`: type-check and compile into `out/`.
- `preview`: open the compiled application without the development server.
- `package`: create an unpacked application in `release/` for the current operating system.
- `dist`: create a platform installer in `release/`. Public distribution requires appropriate platform signing configuration.

## Source layout

- `src/main/`: Electron lifecycle (`index.ts`), window setup (`window.ts`), desktop request handlers (`ipc.ts`), and the utility-process client (`agent-client.ts`).
- `src/preload/`: narrow bridge exposed to the renderer.
- `src/renderer/`: React interface, HTML, and styles. The renderer entry point only mounts the application.
- `src/backend/`: backend code grouped by responsibility, as shown below.
- `src/shared/`: typed messages shared across the desktop bridge.

```text
src/backend/
  agents/                  # runtime lifecycle, agent registry, conversations, worker
  connections/             # saved connections and encrypted credentials
  models/                  # HTTP API, event-stream decoding, provider activity
  workspace/               # protected filesystem, initialization, file viewing

src/renderer/src/
  app/                     # page composition, sidebar, navigation, session state
  features/
    agents/                # agent creation and identity editing
    chat/                  # chat controls, message history, tool activity
    connections/           # connection settings, editor, saved connection list
    workspace/             # workspace file browser and preview
  styles/                  # base controls, layout, feature styles, responsive rules
```

### Readability conventions

Use two spaces for indentation, single quotes in TypeScript, and one statement per line. Separate distinct steps with blank lines: validation, state updates, requests, and cleanup should be easy to scan. Keep related state declarations together and separate effects and class methods with blank lines.

In TSX, put each paired element's opening tag, content, and closing tag on separate lines, including elements containing only text or one expression. Leave a blank line between sibling elements. Empty elements remain self-closing. Preserve explicit spaces when separating text and inline elements.

```tsx
<section>
  <h2>
    Model connections
  </h2>

  <p>
    Bring a local server or an OpenAI-compatible API.
  </p>
</section>
```

Organize files by feature or responsibility. Extract whole components or independent concerns when a file combines several ideas; keep short, cohesive functions intact. `App.tsx` composes the pages, `useAgentSession.ts` owns session state and actions, and feature components render their own views. The agent runtime keeps the run lifecycle together, while model transport observation and workspace protection live in their respective folders. Responsive styles load last so their overrides remain effective.

The chat supports OpenAI-compatible model APIs through a validated preload bridge. Connections are saved in `connections.json` in the application-data directory. API keys are encrypted with Electron safeStorage and never returned to the renderer after saving. Conversations and agent files persist locally. Replies stream as they arrive; Stop aborts the request and retains partial text and completed tool changes. The renderer has Node integration disabled, context isolation enabled, and sandboxing enabled. New windows and renderer-initiated navigation are blocked.

## Connecting a model

Run `npm run dev`. Open **Settings → Connections → Add connection**. Enter a name and API base URL (including `/v1` when required), optionally supply a key, and select **Load models**. Choose a model and save. Select the saved model beside **Send** in the chat composer. You can also type a model ID directly if the provider does not support model discovery. Send a message with Enter; Shift+Enter adds a newline. **New chat** is in the sidebar.

For LM Studio on another computer, enable its local network serving option, run its server, and use that computer's reachable address, for example `http://192.168.1.50:1234/v1`. `localhost` refers to the computer running Granite. Both computers must be able to reach each other and the desktop firewall must allow the server port. HTTP connections are unencrypted; use a trusted network or an HTTPS endpoint.

The adapter uses `GET /models` and `POST /chat/completions`. Responses-only and Anthropic-native endpoints require separate adapters. Codex/ChatGPT sign-in is not implemented by this API-key connection.

Adapter integration check (Node.js with TypeScript stripping support):

```sh
npm test
```

The check uses a local mock server and no external credentials.

Saved connection keys require an available OS credential store; Linux plaintext fallback is rejected. When editing an endpoint with a saved key, re-enter the key or explicitly remove it before saving. Development and packaged builds have separate data directories. Unsigned macOS builds may prompt again for Keychain access after updates.

## Agents and workspaces

Agents run in an Electron utility process. React sends an agent ID, message, and conversation ID through the preload bridge; Electron main resolves the saved model connection and sends it privately to the worker. `ChatOpenAI` supplies the OpenAI-compatible model adapter, `createDeepAgent` supplies the tool loop and filesystem tools, and LangGraph checkpoints use SQLite. API keys never enter the chat renderer.

The **Workspace** page displays the selected agent's actual files. In the application-data directory:

```text
connections.json           # encrypted connection keys
atlas.sqlite               # shared database; original filename retained for compatibility
agents/<agent-id>/
  agent.json                # stable ID and display name
  identity.md               # stable identity, read-only to the agent
  memory.md                 # user preferences shared across this agent’s chats
  notes/
  projects/
```

Development uses `~/Library/Application Support/Granite Development` on macOS. Packaged builds use their own application-data directory. Identity and memory are read fresh for every turn. Changing the selected model preserves the selected agent's identity, memory, and conversations. Use the sidebar agent dropdown to switch agents, choose **New agent** to create one, and open **Identity** to edit its identity file. Shared runtime instructions stay in code; each turn loads that agent's name from `agent.json` and personality and memory from its own files. Identity edits apply on the next message, including existing conversations. There is no editable instructions file.

New installations start with no agents. Use **Create agent** in the empty view, or **New agent** in the custom sidebar dropdown. New agents get generated folder IDs independent of their display names. Each agent has separate conversations and checkpoints, and its tools can access only its own workspace. Existing legacy Atlas files are adopted unchanged when an `agents/atlas/` folder already exists; existing conversations are migrated to belong to Atlas. The database keeps its historical `atlas.sqlite` filename to preserve existing data and journals.

A new agent's `identity.md` starts blank. The identity editor offers the preset as an unsaved draft, so **Save and continue** is enabled without editing anything. Saving writes the preset or the user's changes and opens chat. Reopening an existing, saved identity keeps **Save identity** disabled until something changes. The preset is shared between the editor and legacy workspace initialization; existing identities are never replaced with it.

The agent dropdown supports selection, creation, and deletion, including keyboard navigation, Escape, and dismissal by clicking outside it. **Delete** opens a confirmation explaining which data will be removed. Confirming removes the entire agent folder and its conversations, messages, checkpoints, and pending checkpoint writes. `conversation_threads` records graph ownership across interrupted-run recovery so earlier checkpoints are removed too. Other agents are preserved. Deletion is blocked during a run or identity operation. Deleting the last agent returns to the empty view and does not recreate Atlas on restart.

The available tools list directories, read/write/edit files, find filenames, search text, and maintain a task list. Notes and preferences are real files, not simulated memory functions. Simple prompts can be answered without a tool call. The framework's general-purpose subagent, terminal, and file deletion tools are disabled for this milestone. Coding-project creation has deliberately not been tested.

File tools use a virtual filesystem rooted at the selected agent's directory. Parent traversal, symbolic-link access, and agent edits to identity or configuration are rejected. Search uses ripgrep when installed, with the framework's built-in fallback otherwise. Globs reject brace expansion and excessively long patterns, mitigating the current transitive `braces` denial-of-service advisory. These controls constrain the agent's tools; they are not an OS sandbox against another local process modifying files concurrently.

Conversations, partial answers, and tool results are saved locally. Stop aborts the model request; it does not undo completed file changes. On a crash, running turns and unfinished tools become interrupted. On the next message, Granite starts a new checkpoint thread using the visible transcript and an interruption notice, and retains the original checkpoints. It never automatically replays unfinished tool calls. Files remain authoritative and should be inspected before continuing interrupted work. Tool activity remains visible even if a local model sends an empty final answer after successful tool use; a separate notice explains the missing final message.

Each model request has a 4,096-token output cap and two-minute request timeout; a run has a five-minute deadline and graph step limit. These bounds prevent an unbounded reasoning loop. Reasoning character counts are reported, but reasoning text is not saved to the visible transcript. The model must support streamed Chat Completions and native tool calls. Tool reliability and answer quality still depend on the selected model.

### Verification

`npm install` rebuilds SQLite for Electron. `npm test` runs backend tests using Electron's Node runtime to match its native-module ABI. The suite verifies the real framework tool loop with a mock API, checkpoint persistence, note edits, cross-chat memory, protected paths, Stop, interrupted-run recovery, agent isolation, identity updates, and migration from the original Atlas storage.

On macOS, after building, an optional desktop smoke check opens an isolated window with a mock model server:

```sh
node scripts/verify-desktop.mjs
node scripts/verify-desktop.mjs --packaged
```

To test a real local model without touching your actual Atlas files:

```sh
GRANITE_MODEL_BASE_URL=http://YOUR-SERVER:1234/v1 \
GRANITE_MODEL_ID=YOUR-MODEL \
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron \
  --experimental-strip-types scripts/verify-atlas-live.ts
```

Set `GRANITE_MODEL_API_KEY` if necessary. This opt-in check creates a quote and a note, reads/edits the note, saves a synthetic preference, recalls it in a new conversation, stops a reply, and verifies persistence and continuation after reopening the runtime. It creates no coding project. Temporary files are removed afterwards. UI smoke tests cover the desktop process/renderer bridge separately.

The multi-agent desktop acceptance check creates Nova through the UI, saves an emoji-oriented identity through the editor, asks Atlas and Nova “what is your name and who are you”, switches between their conversations, and verifies persistence after restarting:

```sh
node scripts/verify-agents-desktop.mjs
node scripts/verify-agents-desktop.mjs --packaged
GRANITE_MODEL_BASE_URL=http://YOUR-SERVER:1234/v1 GRANITE_MODEL_ID=YOUR-MODEL \
  node scripts/verify-agents-desktop.mjs --live
```

Live mode uses your actual model; the default uses a mock. Each check runs an isolated temporary desktop profile and removes it afterwards. It does not add synthetic agents or conversations to your normal profile.

To verify agent creation and deletion with the model server offline:

```sh
node scripts/verify-agents-desktop.mjs --offline
```

This check starts with an empty temporary profile, creates an agent through the UI, adds a blank conversation through the desktop bridge, and deletes the agent through the custom dropdown. It verifies that the folder is gone and every database table contains zero rows, then reopens the app to ensure the empty state persists. It also checks cancellation, keyboard navigation, clicking outside the menu, switching agents, and deleting an inactive agent. No model requests are made. Backend tests additionally seed messages, checkpoints, and pending writes directly, including multiple recovery threads, to verify complete cleanup without a model connection.
