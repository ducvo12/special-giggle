# Granite rebuild: branch purpose, decisions, and plans

Recorded November 9, 2026, from the discussion that started this rebuild.

Branch: `codex/granite-rebuild`  
Pre-rebuild reference: `d6a68013c7121a1acfe320fc083d9f76dc63cdb5`

This is a decision and conversation record, not a verbatim transcript. It preserves why we are rebuilding, what we agreed on, how the implementation progressed, and which ideas are still open. **Implemented**, **agreed direction**, and **tentative** mean different things here. Future work should update this record when those decisions change.

## Start here

**Purpose:** rebuild Granite in small steps, with the user directing the architecture and the assistant explaining tradeoffs and implementing decisions. Use the old app and earlier chats as references. Preserve the visual design and isolate behaviors before reconnecting the full application.

**Current milestone:** a pane-and-tab playground inside one Electron window. Navigation accepts Agent placeholders; Content accepts Chat, Image, and File placeholders. Docking, floating previews, divider resizing, pane creation/closing, tab selection, compatible transfers, and reordering are implemented. Content has no + control. Connection storage, sign-in, and model discovery remain available without UI.

**Still deferred:** real explorer/content opening, restored chat/agent execution, type-specific preferred sizing, duplicate views, layout persistence, and detached windows. A tab from a multi-tab group cannot yet create its own new split.

**Next candidates, not a fixed implementation order:** settle tab detachment versus duplication, build the explorer/content-opening path, and refine sizing before persisting the global layout. Continue one behavior at a time; nothing here prevents revisiting an earlier decision.

**Read selectively:** use [development.md](development.md) for current commands and implementation details. Read [remaining work](#remaining-work-and-sensible-next-steps) for planning, [chat/agent decisions](#decisions-for-rebuilding-real-chats-and-agents) when rebuilding those behaviors, and [verification history](#verification-record-and-lessons) when relevant. The full record below does not need to be loaded for every task.

## Why this branch exists

The goal is to rebuild most of Granite with the user directing the architecture, rather than assembling the application by asking an agent to add one feature after another. The assistant should help explain the code, evaluate tradeoffs, challenge impractical ideas, and implement decisions in small steps.

The rebuild should make it possible to isolate a behavior and understand how it works without carrying the entire old application alongside it. Existing code remains reference material. Earlier chats can also inform behaviors such as chat streaming and model connections, but their implementation should be reconsidered deliberately as the new application takes shape.

Nothing discussed here is permanent just because it was proposed or implemented. The user explicitly invited pushback and said that any idea could change.

### Branch and reference strategy

- The experiment started on a new branch from the current checkout. A branch lets the implementation diverge while the original app remains accessible on `main` and in Git history.
- A branch does not separately preserve uncommitted changes. Four files were dirty when the branch was created; the user reported committing them before the rebuild began.
- The exact committed reference used for the reset is `d6a68013c7121a1acfe320fc083d9f76dc63cdb5`. Use it when an exact pre-rebuild snapshot matters.
- A separate worktree was discussed as an optional way to browse and run the old app beside the rebuild. Creating one was not part of this work.
- The reset removed implementation files on this branch. It did not delete or migrate the user's application data.

### What the reset kept and removed

The agreed starting point was a **runnable empty desktop shell**, rather than an entirely empty project.

Kept:

- Electron and React startup, native window controls, and renderer isolation.
- Existing styling, design tokens, and Archon branding. The project and branch are still called Granite; this discussion did not settle a new branding decision.
- Connection storage, credential protection, ChatGPT sign-in, and model discovery, even though their settings interface was removed.
- Documentation and the original stylesheets as reference material.

Removed from the rebuild implementation:

- The old chat interface and streaming integration.
- Agents, execution, tools, repository management, and their worker integration.
- Tests, verification scripts, build steps, and dependencies belonging to those removed systems.

The shell makes no model requests on startup. Retaining connection code does not mean the agent/chat application has already been rebuilt.

## Why start with window management?

The old [v0.2 plan](vault/v0.2%20Implementation%20Plan.md) placed the modular tiling window manager in Pass 7. We investigated whether earlier passes were prerequisites.

| Earlier pass | Subject | Required for pane management? |
| --- | --- | --- |
| 1 | Filesystem chats and terminal navigation, subsequently retired | No |
| 2 | External editor launch | No |
| 3 | Isolated Git worktrees | No |
| 4 | Same-section repository grants | No |
| 5 | Documentation search | No |
| 6 | Managed browser diagnostics | No |

No technical dependency requiring that ordering was documented. Treating Pass 7's position as a prioritization choice was an inference, not a recorded explanation from the original plan.

A pane system can be developed with placeholder content before real chats, connections UI, or agents exist. That makes it a useful first architectural exercise.

The old plan mentioned multiple monitors and pop-out windows, but its concrete implementation and acceptance criteria concentrated on docking inside one window. Those are separate scopes.

**Agreed direction:** build inside one native app window first. Defer detached OS windows and any OS-specific behavior they require. Keeping layout mechanics inside one window reduces platform differences, but native window configuration still needs platform handling.

## Folder semantics and component ownership

These folder names are conventions, not special React mechanisms:

| Folder | Intended responsibility |
| --- | --- |
| `app/` | Compose the application and coordinate shared state/actions. |
| `components/` | General UI building blocks and the supporting logic they need. |
| `features/` | Granite-specific capabilities, such as chat or model connections, including their UI and behavior. |
| `icons/` | React components that define icon graphics. |
| `styles/` | Appearance: tokens, typography, surfaces, spacing, and CSS. |

An icon can technically be a React component while still belonging in a more descriptive `icons/` folder. `ShootingStarIcon.tsx` defines SVG geometry; it does not belong in `styles/`. A plain SVG asset could instead live under `assets/icons/`.

Panes originally went in `features/` because they included layout behavior, not just a surface. We then agreed that the pane system is generic workspace infrastructure, independent of chats and agents. Its files now live together in `components/panes/`. A component folder may contain `.ts` logic as well as `.tsx` views; there is no requirement to scatter those files across separate folders.

### OS handling in the header

Keep one shared `Header` while differences are small. Its current macOS adjustment leaves room for native window controls through a conditional CSS class.

- Appearance differences such as spacing belong in CSS.
- A few platform-specific controls can become a child component, such as `WindowControls`.
- Separate whole header implementations would make sense only if their structure and interactions diverge substantially.
- `src/main/window.ts` owns native window configuration; the renderer header owns app content.

If many components eventually need platform styling, a document-level platform attribute could replace scattered checks. That infrastructure was not needed for one conditional class.

The user also requested comments explaining each function before continuing. Comments were added to the pane functions and app/header functions, including the reasons for layout calculations, pointer capture, cancellation, and state ownership. New pane functions should remain understandable in the same way.

## Overall workspace direction

- The app header is fixed. Other application areas may eventually be panes.
- Panes can be placed and split horizontally or vertically, with nested arrangements.
- Panes contain tabs.
- Closing a pane removes its views. It must not become an implicit Stop command for an agent.
- Closing a pane's final tab closes that pane.
- Closing a pane expands its sibling into the vacated area. We rejected retaining empty holes in the split tree.
- Closing every pane exposes the app backdrop. The header remains available to add a pane again.
- There is one layout for the whole app, rather than separate layouts per agent, section, or project.
- Restoring that layout after restarting is an agreed eventual goal. Persistence was explicitly deferred until interactions were settled.

### Why the renderer supports more than two panes

Each split has two children, but either child can itself be a split. This is a binary split tree, not a two-pane limit.

```text
Workspace split
├── Navigation pane
└── Vertical split
    ├── Content pane
    └── Horizontal split
        ├── Content pane
        └── Content pane
```

`renderLayout` recursively renders these branches. Closing a leaf collapses its parent split to the remaining sibling. The running app was checked with four-pane nested arrangements.

### Sizing decisions

We agreed that making every pane a percentage of the whole window would not be the best eventual behavior:

- Navigation should tend to keep its preferred width.
- Content should take the remaining space.
- Multiple content panes should share space proportionally.
- Preferred sizes should be distinguished from minimum sizes. Temporary constraints should not erase the user's preferred arrangement.
- Moving navigation into a horizontal strip may require a preferred height instead of reusing its width.

**Current implementation:** splits retain ratios, clamp to descendant minimums, and recover their preferred ratios when space returns. New splits start equal. Separate Navigation preferred-width/preferred-height behavior has not been implemented yet.

Pane minimums are currently 200 by 140 CSS pixels. Parent minimums include every descendant and divider. Native window minimums account for the layout, header, workspace padding, and native frame. Creation and docking reject arrangements that cannot fit.

We chose blocking further window shrinking over automatically collapsing panes or adding workspace scrolling. We also corrected the assumption that monitors will always provide plenty of space: display scaling and split-screen use can reduce the available workspace even on a large monitor.

## How the implementation progressed

We deliberately built this in small, inspectable steps.

| Step | Result |
| --- | --- |
| Empty shell | Runnable Electron/React app, theme retained, connection backend retained without UI. |
| Generic pane surfaces | Two identical panes, with no pane-specific behavior. |
| Dragging and docking | Title-bar movement, edge targets, previews, and cancellation. |
| Drag feedback refinement | Larger docking zones, the actual pane following the pointer, and an outline at its original position. |
| Divider resizing | Horizontal/vertical resizing, minimums, ratios, keyboard controls, and cancellation. |
| Add/close panes | Header creation, pane × controls, split collapse, and an empty workspace. |
| Basic tabs | Numbered placeholders, selection, close rules, keyboard navigation, and state preserved during docking. |
| Pane families | Navigation/Content distinctions and compatibility rules. |
| Tab movement | Compatible transfers, insertion previews, reordering, and empty-source cleanup. Content's + control removed. |

### Surfaces and visual treatment

The user asked for opaque panes with an Apple-glass-like texture so boundaries would be easier to see while experimenting. The implementation uses opaque shaded surfaces, rounded token-based borders, and shadows. It is a temporary visual direction, not a commitment to actual transparency or a native glass effect.

Styles continue to use existing semantic tokens. Pane types did not introduce separate arbitrary color schemes.

### Dragging and docking: implemented

- Drag the empty title-bar area to move a whole pane.
- Dragging near another pane's edge divides that pane's space.
- Dragging near a workspace edge can place the pane along that entire workspace edge.
- A preview shows the proposed placement before release.
- A whole-pane center drop is invalid; it does not swap panes. Center swapping was considered and rejected for this milestone.
- The pane follows the pointer at its original size, while a dashed outline marks its original slot.
- Escape, pointer cancellation, focus loss, and window resizing cancel an active interaction.
- Invalid or outside drops preserve the original arrangement.

The user requested docking farther from the screen edge after trying the first version. Workspace zones now extend up to 72 CSS pixels inward; pane zones extend up to 96. Zones shrink on small surfaces to preserve a neutral center.

### Divider resizing: implemented

- Dividers resize side-by-side and stacked panes.
- Nested dividers affect their own split and protect descendant minimums.
- Escape restores the sizes from before the resize.
- Focused dividers support arrow keys in 10-pixel increments; Home/End reach size limits.
- Chosen proportions survive viewport resizing, subject to minimums.

### Pane creation and closing: implemented

- The header chooses a pane family and offers Add pane.
- Creation splits the largest pane with room, preferring its longer dimension and trying the other orientation if needed.
- Add pane is disabled when a valid new split cannot fit.
- Pane numbering does not reuse closed pane numbers during the session.
- Pane × closes the entire pane, including its tabs.
- Closing the last pane leaves the backdrop; creation remains available in the header.

## Pane families and tab compatibility

We decided to establish compatibility before cross-pane tab movement. Otherwise, unrestricted movement would need to be revised after types were added.

| Pane family | Allowed tab kinds | Current behavior |
| --- | --- | --- |
| Navigation | Agent views | One Navigation pane per workspace, with multiple Agent placeholder tabs. |
| Content | Chat, Image, File | Multiple Content panes; these tab kinds can coexist within one pane. |

Pane family and tab kind are separate concepts. A Content pane does not need to become a different kind of pane whenever its selected tab changes from a chat to an image.

The Navigation singleton follows the earlier decision not to duplicate the explorer. It may be closed and restored. This does not prohibit multiple agent-view tabs inside it.

A third utility family was discussed for terminals, problems, output, debug information, or ports, inspired by the grouping in VS Code. It remains deferred. The user was not sure whether a user-facing terminal pane is needed when commands are mostly run by agents.

The concrete compatibility table lives in [pane-types.ts](../src/renderer/src/components/panes/pane-types.ts). Creation and transfer operations enforce it; hiding unsupported controls is not the only protection.

### Content opening and the removed + control

An intermediate implementation offered Chat, Image, and File creation through Content's + selector. The user rejected that interaction: Content should receive whatever is opened through the explorer, rather than create content from inside the pane.

**Current decision:** Content has no + control. Navigation retains its + for Agent placeholders.

A real explorer and real content opening have not been rebuilt. New Content panes still start with one Chat placeholder for the playground. To exercise grouped tabs now, create another Content pane and move its tab into an existing one. This is temporary testing behavior, not the final explorer flow.

### Basic tab behavior: implemented

- Each pane starts with one selected placeholder tab.
- New tab numbers are not reused after closing, even across different content kinds.
- Clicking a tab selects its placeholder view.
- Arrow keys wrap through the focused tab strip; Home/End select its first/last tab.
- Selecting a tab keeps it visible in an overflowing strip.
- Closing an inactive tab preserves selection.
- Closing the active tab selects its right neighbor, or its left neighbor when it was last.
- Closing the final tab removes the pane.
- Tab state belongs to the layout, so docking and component remounts cannot reset it.

### Tab movement: implemented

- Drag a tab label to move its existing view, preserving its ID, kind, and state.
- Dropping into a compatible pane's body appends the tab.
- Dropping into its title bar shows an insertion marker and inserts at that position.
- The same insertion behavior supports reordering within one pane.
- The destination selects the moved tab.
- Source selection follows the ordinary close rules; an empty source pane disappears.
- Incompatible drops are rejected without a preview or state change.
- Escape and invalid/outside drops preserve layout, selection, and identities.
- A tab dragged from a group gets a floating tab preview and an outlined source slot.
- Dragging a sole tab carries the whole pane visually: a compatible tab-bar drop merges it into that pane, while an edge drop can reposition the whole pane.
- Dragging empty title-bar space always moves the whole pane rather than merging all its tabs.

Creating a new split from one tab in a multi-tab group is **not implemented**. Neither are duplicate views or detached native windows.

## Decisions for rebuilding real chats and agents

These are product directions from the conversation, not delivered chat functionality on this branch.

### Content identity versus view identity

The same chat or other content may eventually appear in more than one view. Changes to shared content, such as chat messages or streaming output, should update every view of it. Views can still have independent local state.

Agreed or proposed details:

- Clicking an already-open chat in the explorer should focus an existing view rather than create another automatically.
- If multiple views exist, focus the most recently used one.
- Duplicate views should have independent scrolling.
- The user preferred separate unsent drafts per chat view, rather than the assistant's suggestion of one shared draft.
- The proposed draft recovery rule is last-closed view wins. If one view contains “goodbye” and is closed first, then a view containing “hello” is closed later, reopening should restore “hello.” This needs an actual persistence and lifecycle design before implementation.

**User-stated duplication direction, not implemented:** double-clicking content should create another tab/view, and dragging toward a pane edge could offer duplication. A separate Duplicate view action was also considered, but the user was unsure about it. The exact gestures still need to be reconciled with moving tabs and sole-tab pane dragging before this is built.

### Closing must not mean stopping

The user explicitly wanted agents to stop only through an explicit Stop action in the chat, not because a pane or tab closes. Run ownership should therefore be separate from view ownership when execution is rebuilt.

Application shutdown, crashes, and process recovery are separate lifecycle questions. This conversation did not settle background execution after the app exits. The current branch has no agent execution to continue or stop.

A hideable composer/read-only chat view was suggested and remains tentative.

### Navigation, agent context, and settings

The user described agent tabs in the navigation area: instead of a generic Explorer tab, the tab could be named for the agent. Opening that agent's chat should still use a Content pane, with a clear indication of which agent/project/location owns the chat.

The exact context label, breadcrumb design, agent switching behavior, and explorer implementation remain open.

A persistent mini sidebar for navigation and settings buttons was considered. It was deferred while testing panes; the app header currently provides the recovery/creation controls.

Settings as an overlay window above the workspace, rather than a normal pane tab, was a favored direction. It is not implemented, and “overlay” here does not commit us to a separate native OS window.

## Verification record and lessons

Verification followed [AGENTS.md](../AGENTS.md): lint, production/test type checks, relevant tests, a full suite for changes spanning multiple parts of the app, and a fresh build after code changes. Desktop checks used disposable profiles and local simulated providers, not normal user data.

Milestones reported during this conversation:

| Milestone | Automated suite reported passing |
| --- | --- |
| Rebuild shell and first generic panes | 45 tests |
| Initial dragging/docking | 50 tests |
| Larger docking zones and floating panes | 51 tests |
| Divider resizing | 54 tests |
| Pane creation and closing | 57 tests |
| Basic tabs | 61 tests |
| Pane families | 64 tests |
| Tab movement | 69 tests |

The final tab-movement milestone passed lint, both type checks, all 69 tests, a fresh build, desktop interaction checks, and visual inspection. These are historical results for the code at that milestone, not a substitute for rerunning checks after later changes.

Issues investigated during the work:

- Restricted execution initially blocked localhost listeners used by tests. Checks were rerun with local-server access; assertions were not weakened.
- Native-window resize commands were not exposed through this Electron debugging interface. Proportion checks used renderer viewport emulation. Direct native resize-limit enforcement was not fully automated.
- Clearing viewport emulation sometimes left the app at 900×650. The desktop check now explicitly restores its saved viewport dimensions.
- Pointer events can return before the final movement frame is rendered. Position assertions wait for the rendered state, then still check the exact expected geometry.
- Pane creation could stay disabled while waiting for the first asynchronous size observation. The workspace now publishes its initial size immediately.
- Delayed cleanup after keyboard resizing could cancel the next drag. Layout-change cleanup now runs before paint.
- Existing module-format warnings remained visible. Live-provider sign-in and packaging were not reverified as part of this pane work.

## Remaining work and sensible next steps

The user asked to proceed in very small steps, with each behavior understandable before moving to the next. The following are candidates, not a newly approved fixed implementation order:

1. **Detach a tab from a group into a new split.** Reuse docking previews, preserve identity and pane compatibility, and enforce minimum sizes. Decide how this interacts with the separate idea of duplication.
2. **Settle duplicate-view gestures and view-state ownership.** Distinguish moving, duplicating, focusing an existing view, shared content updates, and independent scrolling/drafts.
3. **Refine type-specific sizing.** Navigation preferred width/height and content flexibility are agreed directions but are not expressed by the current ratio-only split model.
4. **Build the explorer/content-opening path.** Content should be opened there, with clear ownership labels; do not restore Content's + as a shortcut around that design.
5. **Persist the global layout once interactions are stable.** Restoration after restart remains an eventual requirement, not a delivered feature.
6. **Rebuild real application behavior incrementally.** Use the old app and earlier chats as references for connections UI, streaming, chats, agent execution, tools, and repository behavior. Their order and architecture remain for the user to direct.

Utility panes, settings overlays, a persistent mini sidebar, hideable composers, and detached OS windows remain separate decisions. They should not be silently folded into the next pane milestone.

## Current code map

| File | Responsibility |
| --- | --- |
| [App.tsx](../src/renderer/src/app/App.tsx) | Shared layout ownership, pane creation, type selection, and native minimum-size updates. |
| [Header.tsx](../src/renderer/src/components/Header.tsx) | Fixed app header and pane creation controls. |
| [Pane.tsx](../src/renderer/src/components/panes/Pane.tsx) | Pane surface, tab strip, close controls, placeholder view, and drag handles. |
| [Workspace.tsx](../src/renderer/src/components/panes/Workspace.tsx) | Pointer interactions, cancellation, recursive rendering, and preview orchestration. |
| [layout.ts](../src/renderer/src/components/panes/layout.ts) | Split tree, sizing, creation/closing, pane docking, and tab transfer. |
| [tabs.ts](../src/renderer/src/components/panes/tabs.ts) | Tab identity, numbering, selection, compatibility during creation, and close rules. |
| [pane-types.ts](../src/renderer/src/components/panes/pane-types.ts) | Pane families, tab kinds, labels, and compatibility. |
| [tab-drop.ts](../src/renderer/src/components/panes/tab-drop.ts) | Tab target detection and insertion previews. |
| [panes.css](../src/renderer/src/styles/panes.css) | Token-based pane, divider, tab, ghost, and preview appearance. |
| [verify-shell-desktop.mjs](../scripts/verify-shell-desktop.mjs) | Disposable desktop verification of the shell, pane interactions, and retained connections. |

See [development.md](development.md) for current run commands and verification instructions. The older planning vault and harness documentation describe the reference app and should not be read as a list of features already restored on this branch.
