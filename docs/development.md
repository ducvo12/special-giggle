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

- `src/main/`: Electron lifecycle and privileged desktop integration.
- `src/preload/`: narrow bridge exposed to the renderer.
- `src/renderer/`: React interface, HTML, and styles.
- `src/backend/`: Atlas runtime, persistent storage, protected workspace, and model connections.
- `src/shared/`: typed messages shared across the desktop bridge.

The chat supports OpenAI-compatible model APIs through a validated preload bridge. Connections are saved in `connections.json` in the application-data directory. API keys are encrypted with Electron safeStorage and never returned to the renderer after saving. Conversations and Atlas files persist locally. Replies stream as they arrive; Stop aborts the request and retains partial text and completed tool changes. The renderer has Node integration disabled, context isolation enabled, and sandboxing enabled. New windows and renderer-initiated navigation are blocked.

## Connecting a model

Run `npm run dev`. Open **Settings → Connections → Add connection**. Enter a name and API base URL (including `/v1` when required), optionally supply a key, and select **Load models**. Choose a model and save. Select the saved connection in the chat header. You can also type a model ID directly if the provider does not support model discovery. Send a message with Enter; Shift+Enter adds a newline.

For LM Studio on another computer, enable its local network serving option, run its server, and use that computer's reachable address, for example `http://192.168.1.50:1234/v1`. `localhost` refers to the computer running Granite. Both computers must be able to reach each other and the desktop firewall must allow the server port. HTTP connections are unencrypted; use a trusted network or an HTTPS endpoint.

The adapter uses `GET /models` and `POST /chat/completions`. Responses-only and Anthropic-native endpoints require separate adapters. Codex/ChatGPT sign-in is not implemented by this API-key connection.

Adapter integration check (Node.js with TypeScript stripping support):

```sh
npm test
```

The check uses a local mock server and no external credentials.

Saved connection keys require an available OS credential store; Linux plaintext fallback is rejected. When editing an endpoint with a saved key, re-enter the key or explicitly remove it before saving. Development and packaged builds have separate data directories. Unsigned macOS builds may prompt again for Keychain access after updates.

## Atlas agent milestone

Atlas runs in an Electron utility process. React sends a message and conversation ID through the preload bridge; Electron main resolves the saved model connection and sends it privately to the worker. `ChatOpenAI` supplies the OpenAI-compatible model adapter, `createDeepAgent` supplies the tool loop and filesystem tools, and LangGraph checkpoints use SQLite. API keys never enter the chat renderer.

The **Workspace** page displays Atlas's actual files. In the application-data directory:

```text
connections.json           # encrypted connection keys
atlas.sqlite               # conversations, tool activity, LangGraph checkpoints
agents/atlas/
  identity.md               # stable identity, read-only to the agent
  memory.md                 # explicit user preferences, shared across chats
  notes/
  projects/
```

Development uses `~/Library/Application Support/Granite Development` on macOS. Packaged builds use their own application-data directory. Identity and memory are read fresh for every turn. Changing the selected model preserves Atlas's identity, memory, and conversation. You can inspect both files in Workspace; identity can be customized by editing its file outside the app.

The available tools list directories, read/write/edit files, find filenames, search text, and maintain a task list. Notes and preferences are real files, not simulated memory functions. Simple prompts can be answered without a tool call. The framework's general-purpose subagent, terminal, and file deletion tools are disabled for this milestone. Coding-project creation has deliberately not been tested.

File tools use a virtual filesystem rooted at Atlas's directory. Parent traversal, symbolic-link access, and agent edits to identity are rejected. Search uses ripgrep when installed, with the framework's built-in fallback otherwise. Globs reject brace expansion and excessively long patterns, mitigating the current transitive `braces` denial-of-service advisory. These controls constrain the agent's tools; they are not an OS sandbox against another local process modifying files concurrently.

Conversations, partial answers, and tool results are saved locally. Stop aborts the model request; it does not undo completed file changes. On a crash, running turns and unfinished tools become interrupted. On the next message, Granite starts a new checkpoint thread using the visible transcript and an interruption notice, and retains the original checkpoints. It never automatically replays unfinished tool calls. Files remain authoritative and should be inspected before continuing interrupted work. Tool activity remains visible even if a local model sends an empty final answer after successful tool use; a separate notice explains the missing final message.

Each model request has a 4,096-token output cap and two-minute request timeout; a run has a five-minute deadline and graph step limit. These bounds prevent an unbounded reasoning loop. Reasoning character counts are reported, but reasoning text is not saved to the visible transcript. The model must support streamed Chat Completions and native tool calls. Tool reliability and answer quality still depend on the selected model.

### Verification

`npm install` rebuilds SQLite for Electron. `npm test` runs backend tests using Electron's Node runtime to match its native-module ABI. The suite verifies the real framework tool loop with a mock API, checkpoint persistence, note edits, cross-chat memory, protected paths, Stop, and interrupted-run recovery.

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
