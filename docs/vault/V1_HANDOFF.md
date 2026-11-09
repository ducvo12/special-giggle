# Granite v1 Handoff Brief

## 1. Project Status
- **Current Milestone:** Granite v1 (v0.1 baseline) is **Complete & Verified** (Commit `d72f3b3`).
- **Test Baseline:** 241/241 automated tests passing (`npm test`), 0 lint warnings (`oxlint`), clean build (`npm run build`), local package verified (`release/mac-arm64/Granite.app`).

## 2. Vault Diagram Remake & Docs Archive — COMPLETE
- **Target File Created:** `docs/vault/Granite Architecture.canvas`.
- **Level of Detail:** High-level abstract architectural diagrams (bird's-eye architectural view with clean visual cards/groups and cross-zone edges).
- **Cleanup & Archival:**
  - All 21 legacy/draft `.canvas` files safely moved from `docs/vault/` into `docs/vault/archive/legacy-canvases/`.
  - All v0.1 delivery trackers (`Harness Implementation Plan.md`, `Repository Project Setup Plan.md`, `Pass 4 Implementation Plan.md`, and `Verification/`) moved into `docs/vault/archive/v0.1/`.
  - Version milestone nomenclature harmonized to explicit `v0.1 Pass X` / `v0.2 Pass X` naming.
  - Active specifications updated to describe current capabilities as delivered facts rather than pending passes.
- **The 3 Master Visual Zones on the Canvas:**
  1. **Container & Data Hierarchy:**
     - Agent (Identity, Memory, Notes, Tools)
     - Section (`Shared` vs `Closed`)
     - Project (`Repository-linked` vs `Chat-only`)
     - Chat (`Permanent` vs `1-hour Temporary` with Keep)
     - Containment Hierarchy & Cascading Deletion rules
  2. **Execution & Run Lifecycle:**
     - User Prompt $\rightarrow$ Dual-Gate Queueing (Connection concurrency + Project capacity 1)
     - Streaming & Live Steering
     - Supervised Tool Loop & Human Approval / Questions
     - Safe Stop & Crash Settle (edits kept, no rollbacks, explicit restart on pending)
     - Execution & Scheduling Invariants & Interruption Recovery Matrix
  3. **Tools & Isolation Boundaries:**
     - External Repository Access (standing local read/write, external folders preserved on deletion)
     - Scoped Context & Notes (Closed isolation, cross-chat retrieval)
     - Terminal & Managed Previews (supervised sessions, network gating)
     - Skills & Scoped MCP
     - Three-tier isolation architecture and security matrix

## 3. Post-Diagramming Next Milestone: v0.2 Roadmap
Full details, technical problem definitions, and educational study concepts are documented in [[v0.2 Implementation Plan]]:
1. **Pass 1 — Retired (November 9, 2026):** Cancel filesystem chat storage and composer navigation commands; retain SQLite and existing navigation. Generate logs only on explicit export requests if export is added later. Broader file previews and new-chat shortcuts are deferred. **Pass 2 is postponed while code readability and codebase understanding take priority.**
2. **Pass 2 — External IDE Launch (Postponed):** Clicking a repository opens the user's preferred IDE (VS Code, Cursor, Zed, JetBrains) via deep links (`vscode://`, `cursor://`). *(Educational focus: OS URL schemes & process hand-off).*
3. **Pass 3 — Isolated Git Worktrees:** Multi-worktree concurrency without dirty working-tree collisions. *(Educational focus: SWE-agent / SWE-bench working tree isolation).*
4. **Pass 4 — Same-Section Repository Grants:** Scoped multi-repository collaboration. *(Educational focus: Capability-based access control).*
5. **Pass 5 — Web Documentation Search:** Live framework docs retrieval for local models. *(Educational focus: Tool-boundary RAG & sanitization).*
6. **Pass 6 — Managed Browser Diagnostics:** Headless console/network error capture on local dev servers. *(Educational focus: Reflexion verbal self-correction).*
