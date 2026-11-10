.# Granite rebuild: current decisions and remaining work

Updated November 9, 2026.

Branch: `rebuild`

Pre-rebuild reference: `d6a68013c7121a1acfe320fc083d9f76dc63cdb5`

This record keeps the rebuild's purpose, current decisions, unresolved product directions, and verification limits. Superseded pane rules and completed step-by-step plans have been removed. Use [development.md](development.md) for commands, the source map, and detailed interaction rules. The older vault and harness documents describe the pre-rebuild app.

## Why this branch exists

Rebuild Granite in small, understandable steps, with the user directing the architecture. Preserve the visual design and isolate behaviors before reconnecting the full application. The old app and earlier discussions remain references, not a requirement to reproduce every old implementation choice.

The rebuild retains Electron/React startup, Archon branding and design tokens, native window controls, renderer isolation, connection storage, credential protection, ChatGPT sign-in, and model discovery. Connection/authentication operations are available through the bridge without a settings UI. Startup makes no model requests.

Real chat views and streaming, agent execution, tools, repository operations, and their worker integration have not been rebuilt. Existing user application data has not been deleted or migrated. The exact pre-rebuild implementation remains available at the reference commit above.

Working agreements:

- Implement one behavior at a time, explaining assumptions and tradeoffs. Decisions may be revisited when new evidence or requirements warrant it.
- Keep generic workspace infrastructure together in `components/panes/`; application-specific chat and agent behavior belongs outside it. Supporting `.ts` logic can live alongside `.tsx` components.
- Keep functions understandable, including comments explaining layout calculations, state ownership, cancellation, and other non-obvious decisions.
- Preserve existing user work and follow [AGENTS.md](../AGENTS.md) for focused changes and verification.
- After each completion, state the intended next step or say that the agreed plan is finished. Remaining candidates below do not automatically authorize the next feature.

## Current workspace design

The workspace has two levels: typed regions outside and tab groups inside. A region is the permanent container for a family of tabs; a group is a splittable leaf containing tabs.

| Region   | Accepted tabs     | Internal layout                                                                    |
| -------- | ----------------- | ---------------------------------------------------------------------------------- |
| Explorer | Agent             | Any number of groups that fit, split horizontally or vertically.                   |
| Content  | Chat, Image, File | The same split/group behavior as Explorer; content kinds may coexist in one group. |

Exactly one region of each type exists. Explorer starts on the left and Content on the right. The outer layout is always horizontal. Tabs and groups stay inside their owning region, so chats cannot appear on both sides of Explorer. Compatibility is enforced in the layout operations as well as the UI.

Both regions reuse the same group/split implementation. Region types define accepted tab kinds and can have their own application behavior. New region types remain future work; this milestone implements Explorer and Content only.

### Region movement and sizing

Each region has a labeled drag handle above its groups. Dragging it to the opposite horizontal workspace edge swaps the two regions. Each region keeps its width, tab identities, selections, internal group tree, and split proportions. A separate handle distinguishes region swapping from internal group movement. Keyboard swapping is available from the same handle.

The divider between regions changes their widths. Internal dividers resize their own split. Group minimums are 200 by 140 CSS pixels; parent and native window minimums include nested groups, dividers, region handles, the app header, padding, and frame space. Further shrinking is constrained rather than automatically collapsing groups or introducing workspace scrolling.

Current sizing retains preferred ratios, clamps at minimums, and restores the preferred proportions when space returns. Swapping preserves each region's width even under minimum constraints. A separate Explorer preferred-width policy, with Content taking the remaining space, is a future refinement.

### Tab movement and docking

Normal tab dragging moves the existing view; it does not duplicate content or open a detached OS window.

- **Tab-bar row:** merge into another compatible group or reorder within the current group. Empty space in the row appends. An insertion marker shows the position.
- **Group body:** the entire body offers four proportional split targets. The nearest relative side chooses left, right, top, or bottom. There is no neutral center and no Option key requirement. This keeps both orientations reachable in tall or wide groups.
- **Region edges:** retain priority for docking across the whole region edge, within the owning region.
- **Grouped tab:** creates a new group when split, preserving the existing tab object and identity. It can split beside its own source group.
- **Sole tab:** carries and docks its existing group; a body drop does not merge it into the target. A tab-bar drop still merges it.
- **Whole group:** dragging empty title-bar space moves that group using edge docking. This remains distinct from the broader targets used for tab drags.

Previews show final placement before release. The destination selects and focuses a moved tab. The source follows ordinary tab-close selection rules, and an empty source group disappears. Escape, lost capture, pointer cancellation, window blur/resizing, outside drops, and rejected arrangements preserve the committed layout. Splits that cannot meet minimum sizes are rejected without falling back to merging.

### Tabs, creation, and closing

Each playground group starts with one selected placeholder tab: Agent in Explorer, Chat in Content. Clicking selects a tab; keyboard navigation and overflow visibility are supported. Closing an active tab selects its right neighbor, or its left neighbor when last; closing an inactive tab preserves selection.

Closing a group's final tab removes that group and expands its sibling. The group × closes all its tabs. Closing a region's final group leaves the region empty and available for reopening content. Both regions and their handles remain when all groups close.

The header's **New group region / Add group** controls are temporary playground tools. They add a placeholder group inside the selected region, never another outer region, and disable when no split fits. Committed creation and tab splitting share one group sequence; closed group numbers are not reused, and previews/cancellations consume no numbers. Each group's tab numbering is also monotonic during the session.

Explorer groups retain + for Agent placeholders. Content has no + control: real chats, images, and files should open through the future explorer/content-opening path. Adding a Chat placeholder through Add group is testing behavior, not the final content-opening design.

### Visual and platform boundaries

The fixed app header and opaque shaded group surfaces reuse existing semantic tokens. The current appearance is an experimental workspace surface, not a commitment to native transparency or a glass effect. Other retained stylesheets are reference material.

Keep one shared app header while platform differences remain small. Native window configuration belongs in `src/main/window.ts`; renderer spacing, including room for macOS controls, belongs in CSS. Detached OS windows and their platform-specific lifecycle are deferred. The layout currently operates inside one native window.

## Decisions for rebuilding real chats and agents

These are future product directions, not delivered chat or agent functionality.

### Content identity versus view identity

Shared content and individual views must have separate ownership. If the same chat appears in multiple views, message updates and streaming output should reach every view, while local view state can remain independent.

Agreed directions:

- Clicking an already-open chat in Explorer should focus an existing view rather than create another automatically. If several views exist, focus the most recently used one.
- Duplicate views should have independent scrolling.
- Unsent drafts should be separate per chat view.

Still unresolved:

- **Duplication gesture:** double-clicking content to create another view was favored earlier, and a separate Duplicate view action was considered. The final gesture remains to be settled. Ordinary dragging is now reserved for moving, merging, and splitting views.
- **Draft recovery:** the proposed rule is last-closed view wins when reopening. For example, closing a view containing “goodbye” before one containing “hello” would restore “hello.” This still needs a persistence and lifecycle design.

### Closing must not mean stopping

Agents should stop through an explicit Stop action, not because a tab or group closes. Run ownership must therefore be separate from view ownership when execution is rebuilt.

Application shutdown, crashes, and process recovery are separate lifecycle questions. Background execution after app exit has not been decided. There is currently no agent execution to continue or stop.

### Agent context and settings

Explorer tabs should identify the agent. Opening an agent's chat should use Content, with a clear indication of its agent/project/location. Context labels, breadcrumbs, agent switching, and real Explorer behavior remain open.

Settings as an overlay above the workspace is a favored direction, without committing to a separate native window. A persistent mini sidebar, hideable composer/read-only chat view, and a utility region for terminals/output/problems remain tentative or deferred. A user-facing terminal has not been established as necessary.

## Remaining work and sensible next steps

The agreed region and tab-movement plan is complete. No next implementation milestone has been selected. Candidates are:

1. **Settle duplicate-view behavior.** Choose deliberate gestures and define shared content, local scrolling/drafts, focusing, and recovery.
2. **Refine type-specific sizing.** Decide how Explorer's preferred width and Content's flexible space should interact with minimums and window resizing.
3. **Build Explorer and real content opening.** Open content through Explorer with clear ownership labels; keep Content's + absent.
4. **Persist the global layout once interactions are stable.** Save region order/widths, internal group trees, and relevant view state. There is one app-wide layout, not a separate layout per agent, section, or project.
5. **Restore application behavior incrementally.** Connections UI, chat streaming, execution, tools, and repository features need their own scoped decisions and verification.

Utility regions, settings overlays, the mini sidebar, hideable composers, and detached native windows are separate decisions. None is implicitly included in another workspace change.

## Verification record and lessons

The latest implementation milestone, full-body tab split targets and tab-bar-only merging, was verified on November 9, 2026 with:

- Lint, production/test type checks, all **81 tests**, and a fresh build.
- Desktop checks in a disposable profile against a local simulated provider.
- Coverage for region uniqueness and width-preserving swaps; both split directions in Explorer and Content; deep-body tab docking; tab-bar merging/reordering; nested and outer resizing; cross-region rejection; minimum sizes; cancellation; keyboard controls; empty-region recovery; and numbering.
- Desktop bridge isolation, connection persistence, and simulated model discovery.

These are results for that code milestone, not proof of later changes. Existing module-format warnings remain. Windows/Linux, packaged builds, and live-provider sign-in were not reverified. Direct native resize-limit enforcement was not fully automated; proportion checks use renderer viewport emulation.

Useful verification constraints:

- Tests using temporary local servers need access to bind localhost. Do not weaken their assertions when that access is restricted.
- Pointer dispatch and scheduled focus updates can finish before rendering settles. Wait for observable state before asserting geometry or sending dependent input.
- Native overflow scrollbars can cover tab labels. Desktop checks choose a visible, hit-tested point inside the control.
- Keep native pointer checks before viewport emulation and explicitly restore the original viewport dimensions afterward.
