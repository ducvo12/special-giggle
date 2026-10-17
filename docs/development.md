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
- Future agent execution belongs in a separate backend process; it should not run in the renderer.

The chat supports OpenAI-compatible model APIs through a validated preload bridge. API keys and conversations stay in memory and are not saved. Replies currently arrive as complete messages rather than streaming tokens. The renderer has Node integration disabled, context isolation enabled, and sandboxing enabled. New windows and renderer-initiated navigation are blocked.

## Connecting a model

Run `npm run dev`. Enter an API base URL (including `/v1` when required), optionally supply a key, and select **Load models**. You can also type a model ID directly if the provider does not support model discovery. Send a message with Enter; Shift+Enter adds a newline.

For LM Studio on another computer, enable its local network serving option, run its server, and use that computer's reachable address, for example `http://192.168.1.50:1234/v1`. `localhost` refers to the computer running Granite. Both computers must be able to reach each other and the desktop firewall must allow the server port. HTTP connections are unencrypted; use a trusted network or an HTTPS endpoint.

The adapter uses `GET /models` and `POST /chat/completions`. Responses-only and Anthropic-native endpoints require separate adapters. Codex/ChatGPT sign-in is not implemented by this API-key connection.

Adapter integration check (Node.js with TypeScript stripping support):

```sh
node --experimental-strip-types --test tests/model-api.test.ts
```

The check uses a local mock server and no external credentials.
