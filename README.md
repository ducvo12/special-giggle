# Granite

This branch (`codex/granite-rebuild`) starts a user-led rebuild of Granite, one behavior at a time.

The starting point is an empty Electron + React desktop shell with the existing Archon branding, theme, and native window controls. Model connection storage, ChatGPT sign-in, and model discovery remain available through the desktop bridge, without a settings interface. Agent execution, chat streaming, tools, and repository management have been removed from this branch.

The complete pre-rebuild implementation is preserved at commit `d6a68013c7121a1acfe320fc083d9f76dc63cdb5`. `main` also retains the original app; the committed rebuild baseline includes the latest documentation changes.

```sh
npm install
npm run dev
```

See the [rebuild branch record](docs/rebuild-branch-record.md) for the purpose, decisions, implemented behavior, and remaining plans from this discussion. See [development and verification](docs/development.md). Existing architecture and roadmap documents under `docs/` describe the earlier implementation and remain reference material, rather than claims about this shell.
