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

The starter intentionally has no model connection or chat functionality yet. The renderer has Node integration disabled, context isolation enabled, and sandboxing enabled. New windows and renderer-initiated navigation are blocked.
