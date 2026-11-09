# Granite rebuild development

This branch is a runnable desktop shell for rebuilding Granite incrementally with the user directing the architecture. It starts with one Navigation pane and one Content pane, with controls to add and close panes and typed placeholder tabs. The full prior implementation is preserved at commit `d6a68013c7121a1acfe320fc083d9f76dc63cdb5`; existing harness documentation and planning vault files describe that earlier app.

## Run and verify

Use Node.js 22.12+ and npm.

```sh
npm install
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run lint` | Source, test, and script lint checks. |
| `npm run typecheck` | Production TypeScript checks. |
| `npm run typecheck:tests` | Strict test TypeScript checks. |
| `npm test` | Pane layout, connection, authentication, link validation, and desktop-session tests under Electron's Node runtime. |
| `npm run build` | Type-check and compile main, preload, and renderer. |
| `npm run verify:shell` | Launch the compiled shell in a disposable profile and check pane dragging/docking, divider resizing, pane creation/closing, tab movement, and the connection bridge against a local simulated provider. |
| `npm run preview` | Open the compiled app. |
| `npm run package` | Build and create a local unpacked app. |
| `npm run dist` | Build an installer; distribution requires platform signing configuration. |

The test runner accepts equals-form `--test-name-pattern`, `--test-skip-pattern`, `--test-reporter`, `--test-concurrency`, and `--test-timeout` after npm's `--` separator. It rejects unknown arguments.

Run lint, both type checks, relevant tests, and a fresh build after code changes. Use the full test suite for changes spanning multiple parts of the app. Investigate failures without weakening checks, and report actual verification and remaining gaps. Desktop checks use disposable profiles and simulated local providers; they do not prove live-provider or packaged behavior. The current desktop runner uses the macOS Electron executable.

## Current source layout

| Path | Responsibility |
| --- | --- |
| `src/main/index.ts` | App lifecycle and separate development profile. |
| `src/main/window.ts` | Native window, isolated renderer, and navigation restrictions. |
| `src/main/ipc.ts` | Validated connection/authentication requests and OS credential protection. |
| `src/preload/index.ts` | Typed connection bridge; no Node access in the renderer. |
| `src/backend/auth/` | ChatGPT sign-in and encrypted account storage. |
| `src/backend/connections/` | Saved connection settings and credentials. |
| `src/backend/models/` | Model discovery and account model catalog. |
| `src/shared/` | Connection and bridge contracts. |
| `src/renderer/src/app/App.tsx` | Shared layout state, pane creation, header actions, and native window minimum updates. |
| `src/renderer/src/components/panes/Pane.tsx` | Controlled tab strip, placeholder content, empty title-bar drag area, and close controls. |
| `src/renderer/src/components/panes/Workspace.tsx` | Pointer capture, drag/resize cancellation, docking previews, divider controls, and layout rendering. |
| `src/renderer/src/components/panes/layout.ts` | Split tree, pane/tab ownership, docking targets, geometry, and minimum-size checks. |
| `src/renderer/src/components/panes/tabs.ts` | Typed placeholder tab creation, selection, numbering, and closing rules. |
| `src/renderer/src/components/panes/pane-types.ts` | Navigation/Content families and their allowed tab kinds. |
| `src/renderer/src/components/panes/tab-drop.ts` | Compatible tab hit testing, insertion markers, and move previews. |
| `src/renderer/src/styles/` | Original design tokens and styles retained for reuse. |

Only tokens, base, shell, and pane styles are loaded. Other stylesheets are retained design references, with no corresponding feature implementation. The two panes have opaque shaded surfaces. Drag the empty title-bar area to dock against another pane or the workspace edge; the pane follows the pointer at its original size while an outline marks its former location. A separate preview shows the final docked placement. Workspace docking engages up to 72 CSS pixels from an edge, and pane docking up to 96; zones scale down on small surfaces to retain a neutral center. Center/outside drops do nothing. Escape, pointer cancellation, window blur, and window resizing cancel an active drag. New splits divide space equally. Drag a divider to resize either orientation; Escape cancels the resize. Focus a divider and use arrow keys for 10-pixel adjustments, or Home/End for its size limits. Splits retain their chosen proportions on window resizing, clamping at the 200-by-140 CSS pixel pane minimums and restoring preferred proportions when space returns. Nested splits include all descendant minimums. Docking rejects arrangements that cannot fit. Add pane splits the largest pane with room, preferring its longer dimension, and is disabled when no split fits. Pane numbers are not reused after closing. Closing collapses the pane's split and expands its sibling; closing the final pane exposes the backdrop, with Add pane still available in the header. Native window minimum dimensions follow the layout, including header, padding, and native frame space. Navigation accepts Agent tabs; Content accepts Chat, Image, and File tabs. These are labeled placeholders without real agent/chat/file behavior. The header selector chooses the family for new panes. Only one Navigation pane may exist, and it can be restored after closing. Each pane starts with one selected placeholder tab: Agent for Navigation, Chat for Content. Navigation's + adds an Agent tab. Content has no + control; real content opening belongs to the future explorer. For this playground, new Content panes still start with a Chat placeholder, and tabs can be gathered by moving them between Content panes. Compatibility is enforced by creation and transfer operations, not only by the controls; numbers are not reused after closing. Clicking a tab selects its placeholder content. Arrow keys, Home, and End navigate the focused tab strip. Closing the active tab selects its right neighbor, or the left neighbor when last; closing an inactive tab preserves selection. Closing the final tab closes its pane. The pane × closes the entire group. Tab state lives in the layout and survives docking. Drag tab labels to move them into compatible panes; dropping in a body appends, while dropping in a title bar shows an insertion marker and also supports reordering within a pane. Incompatible targets have no preview and reject the drop. Moving a final tab into another pane closes its source pane. A sole-tab drag carries the whole pane and can use edge docking; dragging the empty title bar always moves the whole pane. Multi-tab drags show a floating tab and leave its source slot outlined. Escape and invalid/outside drops preserve the original layout, selection, and tab identities. Creating a new split from an individual tab in a multi-tab pane, duplicate views, and persistence are not implemented yet. The shell has no agent worker, database, chat, tools, repository operations, or real pane content. There are no model requests on startup. Saved connections and sign-in operations remain callable through the bridge but have no UI. Existing user application data is not deleted or migrated.

The first pane manager will operate inside one native window. Detached windows and their OS-specific behavior are deferred. The current layout uses a binary split tree, with pane leaves and horizontal or vertical splits.

## Conventions

Use two spaces, single quotes in TypeScript, and one statement per line. Separate validation, state changes, requests, and cleanup with blank lines. In TSX, put opening tags, content, and closing tags on separate lines, and leave a blank line between siblings.

Keep responsibilities local and explicit. Use the smallest clear solution; remove redundant scaffolding introduced by a change. Preserve existing user work. Follow `AGENTS.md` for the simplicity review and verification requirements.

Use CSS variables from `styles/tokens.css` for colors, radii, shadows, and typography. Body text uses `var(--font-sans)`; code and status text use `var(--font-mono)`. Keep the renderer isolated with no Node integration, saved credentials, or arbitrary navigation. Only validated HTTP/HTTPS links open in the system browser.
