# Granite desktop development

> Current development guide, reviewed October 29, 2026. [Harness behavior](harness.md) describes delivered features; [the planning vault](<vault/Start Here.md>) separates remaining work and verification.

## Run and package

Use Node.js 22.12+ with the package's required tooling and npm. Install dependencies, then start development:

```sh
npm install
npm run dev
```

The development command prepares native PTY helpers, opens Electron and serves React with hot reload. Main/preload changes are rebuilt by electron-vite. Development data is separate from the packaged app (`Granite Development` on macOS).

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript validation. |
| `npm test` | Prepare native helpers and run backend checks under Electron's Node ABI. |
| `npm run build` | Prepare PTY, type-check and compile main/worker/preload/renderer into `out/`. |
| `npm run preview` | Open the compiled app. |
| `npm run package` | Build and create a local unpacked app in `release/`. |
| `npm run dist` | Build an installer; public distribution needs platform signing configuration. |

SQLite and PTY native components must match Electron. Installation prepares them; packaged PTY helpers are unpacked through the build configuration. Packaging is not publishing.

## Source layout

| Path | Responsibility |
| --- | --- |
| `src/main/` | Electron lifecycle/windows, validated IPC and private utility-worker client. |
| `src/preload/` | Narrow typed renderer bridge. |
| `src/backend/agents/` | Agent/chat organization, SQLite state, runs, worker and lifecycle. |
| `src/backend/harness/` | Granite-owned loop, scheduling, providers, tools/settings, approvals/questions. |
| `src/backend/repositories/` | Access, guarded edits, diffs, commands/PTY, setup authorization, previews and recovery. |
| `src/backend/auth/`, `connections/`, `models/` | Independent sign-in, encrypted connection/account storage and model access. |
| `src/backend/workspace/` | Protected agent files, initialization and file viewing. |
| `src/shared/` | Types across the desktop bridge. |
| `src/renderer/src/app/`, `features/`, `styles/` | Composition/session state, feature views and styling. |

Keep Electron main and the worker built independently. The renderer has no Node integration, uses context isolation/sandboxing, and receives no saved model credentials. Validated HTTP/HTTPS links open in the system browser; arbitrary new windows/navigation and file/application links remain blocked.

## Readability conventions

Use two spaces, single quotes in TypeScript and one statement per line. Separate validation, state updates, requests and cleanup with blank lines. Group related state; separate effects and class methods.

In TSX, put a paired element's opening tag, content and closing tag on separate lines, including text-only elements. Leave a blank line between siblings. Empty elements stay self-closing; retain explicit spaces around inline elements.

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

Organize by feature/responsibility. Extract independent concerns when a file combines ideas; keep short cohesive functions intact. `App.tsx` composes pages; session hooks own state/actions; feature components render views. Preserve the lifecycle's integration while keeping transport, permissions and process/filesystem operations in their modules. Responsive styles load last.

## Local data and interface

```text
application-data/
  connections.json
  chatgpt-accounts.json
  atlas.sqlite                     historical name retained for compatibility
  agents/<stable-agent-id>/
    agent.json
    identity.md
    memory.md
    harness.json
    skills/<name>/SKILL.md          current skill layout
    notes/
    tools/                         agent-local tools location
    sections/<stable-section-id>/
      projects/<stable-project-id>/
        repository/                optional internally created codebase
```

Chats/messages, membership and private native model state live in SQLite; external repository attachments point to folders elsewhere. Existing legacy Atlas data/checkpoints are retained or migrated. New profiles start without an agent. Stable IDs are independent of display names.

The sidebar is a file explorer for agents, identity/memory, notes, sections, projects and chats. Markdown has preview/Edit/Save/Cancel; revision checks protect external edits, unsaved drafts protect navigation, and core filenames stay fixed. The human editor currently blocks saves during agent work. Identity starts blank; the editor offers an unsaved preset rather than replacing existing content. Runtime instructions remain in code, with additional user instructions/tool settings in `harness.json`.

Agent/chat deletion already exists but requires work to finish and cannot erase unresolved recovery data. Full active/queued cascade deletion for projects/sections and associated source cleanup belongs to passes 4/5. Internal code follows physical folder deletion; externally linked targets survive. Do not describe the planned lifecycle as implemented.

## Connections and execution

Open Settings → Connections to add independent ChatGPT sign-in, a Responses API connection, or a Chat Completions local/compatible endpoint. See [the harness guide](harness.md) for details. A chat binds its model/provider after use; start a new chat for another model rather than assuming mid-session migration.

For LM Studio on another device, use that device's reachable server address (for example `http://192.168.1.50:1234/v1`); localhost refers to Granite's machine. The network/firewall must permit access. API keys use Electron safeStorage and are not sent back to the renderer; Linux plaintext fallback is rejected. Endpoint changes with saved keys require explicit key handling. Account sign-in belongs to Granite, not Codex.

There are **no whole-run time/step/tool-count caps** and no fixed terminal deadline. The current loop has a two-million-byte input/instruction guard with bounded tool/output previews; model-aware schema/token accounting and compaction are pass 4. Chat Completions currently requests up to 4,096 output tokens; Responses follows its adapter/provider allowance. Actual provider errors/limits remain failures. Stop and crashes keep applied edits, settle owned work and do not replay unfinished actions.

Repository commands, interactive sessions and previews currently require macOS confinement. Ordinary sessions/cache end with the run; only a verified ready managed preview may remain afterward without occupying model/project capacity. Previews use isolated snapshots, require refresh for newer code and stop on owning Stop/deletion/app closure. Commands support safe contained relative installer links, bounded download authorization and guarded publication. Full details: [harness guide](harness.md).

## Verification

Use disposable profiles, repositories and local simulated providers for deterministic/destructive checks. Never seed synthetic chats or framework scaffolds into the user's normal data/codebase. A mock verifies Granite's plumbing, not real-model competence. Check broad follow-ups in [Tests to Run Later](<vault/Tests to Run Later.md>) and recorded results in [the vault index](<vault/Start Here.md>).

After building, useful desktop runners include:

```sh
node scripts/verify-organization-desktop.mjs
node scripts/verify-pass2-selected-desktop.mjs
node scripts/verify-repositories-desktop.mjs
node scripts/verify-repositories-desktop.mjs --packaged
node scripts/verify-agents-desktop.mjs --offline
```

Additional focused runners cover harness settings/approvals, questions, model catalogs and sidebar usage. Inspect each script's current coverage before using an old result to accept new behavior. In particular, an old model-picker check is not evidence of permitted mid-session switching.

Real framework acceptance uses actual downloads in disposable repositories:

```sh
node scripts/verify-project-setup.mjs vite
node scripts/verify-project-setup.mjs next
```

An optional exact scaffold version may follow the framework. Registry failures must be reported, not hidden by an unrecorded fallback. Real-agent setup uses `scripts/verify-project-agent-live.mjs`, with the configured account or explicit local-model environment. It consumes provider usage/network when run; it is not a routine documentation check. Record provider/model/protocol and actual outcomes, including unavailable endpoints. See the dated 3A results for tested commands, versions, builds, previews and packaged walkthroughs.

Earlier baseline/live-agent results are retained in `docs/archive/`. They predate the current harness and cannot establish current architecture, limits or complete later-pass acceptance. Research notes under `docs/research/` remain investigations, not feature promises.
