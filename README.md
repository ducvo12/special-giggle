# Granite

This rebuild branch develops Granite one behavior at a time, with the user directing the architecture.

The current Electron + React playground has two typed regions: Explorer for Agent tabs and Content for Chat, Image, and File tabs. Both support nested tab groups split horizontally or vertically. Regions stay side by side and can swap places while keeping their widths and internal layouts. Tabs merge/reorder on the tab bar; the full group body offers proportional split targets without a modifier key. Tabs and groups stay within their owning region.

The shell retains Archon branding, design tokens, native window controls, and an isolated renderer. Connection storage, ChatGPT sign-in, and model discovery are available through the desktop bridge without a settings UI. Tabs are placeholders; real chat/agent execution, streaming, tools, and repository behavior have not been rebuilt. Layout persistence and detached native windows remain deferred.

The complete pre-rebuild implementation is preserved at commit `d6a68013c7121a1acfe320fc083d9f76dc63cdb5`. Existing user application data has not been deleted or migrated.

```sh
npm install
npm run dev
```

See [development and verification](docs/development.md) for commands, current interactions, and the source map. See the [rebuild decisions and remaining work](docs/rebuild-branch-record.md) for architecture decisions, unresolved product behavior, and verification limits. Older architecture, harness, and roadmap documents describe the pre-rebuild app and remain reference material.
