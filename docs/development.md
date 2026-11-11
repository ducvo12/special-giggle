# Granite rebuild development

This branch is a runnable desktop shell for rebuilding Granite incrementally with the user directing the architecture. It has one Explorer region and one Content region, with independently splittable tab groups inside each region and typed placeholder tabs. The full prior implementation is preserved at commit `d6a68013c7121a1acfe320fc083d9f76dc63cdb5`; existing harness documentation and planning vault files describe that earlier app.

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
| `npm test` | Region/group layout, connection, authentication, link validation, and desktop-session tests under Electron's Node runtime. |
| `npm run build` | Type-check and compile main, preload, and renderer. |
| `npm run verify:shell` | Launch the compiled shell in a disposable profile and check region swapping, scoped group/tab docking, both levels of resizing, empty-region recovery, and the connection bridge against a local simulated provider. |
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
| `src/renderer/src/app/App.tsx` | Typed region state, group creation, header actions, and native window minimum updates. |
| `src/renderer/src/components/panes/Pane.tsx` | Controlled tab strip, placeholder content, empty title-bar drag area, and close controls. |
| `src/renderer/src/components/panes/Workspace.tsx` | Shared pointer interactions for region swapping, scoped group docking, resizing, cancellation, and layout rendering. |
| `src/renderer/src/components/panes/regions.ts` | Unique horizontal region pair, width-preserving swapping, region geometry, family validation, and outer minimums. |
| `src/renderer/src/components/panes/layout.ts` | Split tree, pane/tab ownership, docking targets, geometry, and minimum-size checks. |
| `src/renderer/src/components/panes/tabs.ts` | Typed placeholder tab creation, selection, numbering, and closing rules. |
| `src/renderer/src/components/panes/pane-types.ts` | Explorer/Content families and their allowed tab kinds. |
| `src/renderer/src/components/panes/tab-drop.ts` | Compatible tab hit testing and insertion markers. |
| `src/renderer/src/styles/` | Original design tokens and styles retained for reuse. |

## Workspace behavior

### Regions and swapping

Exactly two typed regions exist: Explorer starts on the left and Content on the right. They are always side by side. Each region contains its own binary split tree of tab groups. Explorer accepts Agent tabs; Content accepts Chat, Image, and File tabs. Both families support any number of horizontal/vertical nested groups that fit. Tabs and groups cannot cross their region boundary. Each region is unique; the groups inside it are not limited to one.

Drag the unlabeled top-left handle inside each region to swap the two regions at the opposite horizontal workspace edge. The region floats at its original size, an outline marks its slot, and a preview shows the final placement. Region widths, tab identities, selection, internal splits, and proportions travel with their regions. Top/bottom-center and outside drops do nothing. A focused region handle also supports Left/Right arrows, Enter, or Space for swapping.

### Tab and group movement

Drag a group's empty title-bar area to dock it within its own region. Drag tab labels to merge/reorder across a compatible tab-bar drop band (extending 30 CSS pixels below the title bar, including empty header space for appending). The pane body below that band offers proportional split targets: proportional distances to its four sides choose left, right, top, or bottom, with no neutral center and no Option key required. Tall and wide groups retain generous targets in both directions; ties resolve consistently, preferring left, then right, top, and bottom. A grouped tab leaves its source slot outlined and has a tab-sized ghost. A sole-tab drag carries the entire group and docks it beside the body target instead of merging. Splitting an Agent tab works exactly like splitting a Content tab, including beside its own source. Invalid/undersized splits are rejected rather than merged. Group and region previews use final-layout geometry. Region edges retain full-region docking priority within a zone of up to 72 CSS pixels, scaled down on small surfaces. Whole-group title-bar drags retain the earlier edge zones (up to 72 pixels at region edges and 96 at group edges), with smaller zones on small surfaces and neutral centers.

### Resizing and cancellation

Escape, pointer cancellation, lost capture, window blur, and window resizing discard temporary interactions. New internal splits start at equal proportions. Pointer dividers resize both orientations. Focus a divider and use arrow keys for ten-pixel adjustments or Home/End for its minimum-size limits. The outer divider resizes the horizontal region pair. Nested group minimums (200 by 140 CSS pixels each), workspace padding, app header, and native frame space all contribute to the native window minimum. Preferred proportions survive window resizing, clamping at minimums and restoring when room returns.

### Group creation and closing

The header's **New group region / Add group** controls are playground tools, adding a placeholder group inside the selected region. They never create another top-level region. Creation splits the largest group with room, preferring its longer dimension, and disables when no split fits. Closing a group's final tab removes that group and expands its sibling. Closing a region's final group leaves an empty region that can be refilled through Add group. Closing both regions' groups leaves both region handles and the outer divider available. Group numbers are shared across both regions and never reused; previews and cancellations consume no numbers.

### Tab controls

Each group starts with one selected placeholder tab. Explorer's + adds Agent tabs. Content has no + control; real content opening belongs to the future explorer. Clicking selects a tab; Arrow keys, Home, and End navigate a focused strip and keep selection visible. Closing the active tab selects the right neighbor, or the left when last; closing an inactive tab preserves selection. Transfers preserve the existing tab object and select/focus it at the destination. Tab state belongs to each region's group tree, surviving docking and region swaps.

### Deferred application behavior

Only tokens, base, shell, and pane styles are loaded. Other stylesheets remain design references. Duplicate views, layout persistence, detached native windows, real explorer/content opening, and type-specific preferred sizing remain deferred. The shell has no agent worker, database, chat execution, tools, repository operations, or real pane content. There are no model requests on startup. Saved connections, sign-in, and model discovery remain callable through the isolated bridge without UI. Existing user application data is not deleted or migrated.

## Conventions

Use two spaces, single quotes in TypeScript, and one statement per line. Separate validation, state changes, requests, and cleanup with blank lines. In TSX, put opening tags, content, and closing tags on separate lines, and leave a blank line between siblings.

Keep responsibilities local and explicit. Use the smallest clear solution; remove redundant scaffolding introduced by a change. Preserve existing user work. Follow `AGENTS.md` for the simplicity review and verification requirements.

Use CSS variables from `styles/tokens.css` for colors, radii, shadows, and typography. Body text uses `var(--font-sans)`; code and status text use `var(--font-mono)`. Keep the renderer isolated with no Node integration, saved credentials, or arbitrary navigation. Only validated HTTP/HTTPS links open in the system browser.
