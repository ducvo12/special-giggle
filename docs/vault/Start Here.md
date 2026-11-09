# Granite planning vault

> Current design, architecture specifications, and roadmap index. Granite v1 (v0.1 baseline) is complete and verified across all passes.

## Where the project stands

| Milestone / Pass | Status | Evidence / Notes |
| :--- | :--- | :--- |
| **v0.1 Pass 1** — Data foundation and organization | Implemented & verified | [[archive/v0.1/Verification/Pass 1 Implementation & Testing.md\|Pass 1 Verification]] |
| **v0.1 Pass 2** — Run lifecycle and scheduling | Implemented & verified | [[archive/v0.1/Verification/Pass 2 Implementation & Testing.md\|Pass 2 Verification]] · [[archive/v0.1/Verification/Pass 2 Focused Verification Results.md\|Focused Results]] |
| **v0.1 Pass 3** — Repository tools and change visibility | Implemented & verified | [[archive/v0.1/Verification/Pass 3 Implementation & Testing.md\|Pass 3 Verification]] |
| **v0.1 Pass 3A.1 / 3A.2** — Autonomous project setup | Implemented & verified | [[archive/v0.1/Verification/Pass 3A.1 Implementation & Testing.md\|Pass 3A.1 Verification]] · [[archive/v0.1/Verification/Pass 3A.2 Implementation & Testing.md\|Pass 3A.2 Verification]] |
| **v0.1 Pass 4** — Context, memory and retrieval | Implemented & verified | [[archive/v0.1/Verification/Pass 4 Implementation & Testing.md\|Pass 4 Verification]] · [[archive/v0.1/Pass 4 Implementation Plan.md\|Pass 4 Plan]] |
| **v0.1 Pass 5** — Lifecycle and extensions | Implemented & verified | Temporary expiry/Keep, container cascades, missing-folder recovery, skill imports, scoped MCP |
| **v0.1 Pass 6** — Integration and release verification | Implemented & verified | Whole-app integration, multi-chat concurrency, status consistency, provider resilience, packaging & migration |

Implementation and integrated acceptance for the v0.1 baseline are complete across all six passes plus 3A. 241/241 automated tests pass. Packaging and migration verified.

## Current specifications

- [[Harness Design]] — organization, membership, and container architecture.
- [[Memory & Context Policy]] — scoped context, retrieval, summaries, editable memory, and deletion support.
- [[Run Lifecycle Design]] — streaming, steering, queues, human approvals/questions, safe Stop, and crash recovery.
- [[Repository & Context Tools]] — repository access, terminal sessions, previews, and native context APIs.
- [[Tools & Permissions]] — action authorization, instruction authority, skills (`SKILL.md`), and scoped MCP.
- [[Container & Settings Rules]] — deletion cascades, external repository preservation, missing-folder relinking, and settings.
- [[Decision Register]] — stable decision IDs (`D-001` through `D-074`) and where their current rules live.

## Visual maps

- [[Granite Architecture.canvas]] is the unified master architecture canvas, providing bird's-eye architectural diagrams across three visual zones: Container & Data Hierarchy, Execution & Run Lifecycle, and Tools & Isolation Boundaries.
- The 21 earlier detailed/draft canvases are archived in `docs/vault/archive/legacy-canvases/` for historical reference.

## Next Milestones (v0.2 & v0.3)

- [[v0.2 Implementation Plan]] — delivery plan and educational roadmap for v0.2; Pass 1 is retired, and Pass 2 (external IDE launch) is next.
- [[V1_HANDOFF]] — Granite v1 handoff brief and immediate v0.2 roadmap.
- [[Granite Vision & Roadmap]] — version roadmap assignments (v0.1, v0.2, v0.3).
- [[Repository Access & Worktree Plan]] — v0.2 proposal for isolated Git worktrees and same-section cross-project repository grants.
- [[Things to Optimize]] — measured-improvement backlog for large repositories, token compaction, graph navigation, and subagents.
- [[Tests to Run Later]] — verification backlog matrix for manual, edge-case, and live-provider checks.

## Historical v0.1 Delivery Archive

- [[archive/v0.1/Harness Implementation Plan.md|Harness Implementation Plan (v0.1 Delivery)]] — full delivery record and criteria for all v0.1 passes.
- [[archive/v0.1/Repository Project Setup Plan.md|Repository Project Setup Plan (Pass 3A)]] — specification for autonomous framework scaffolding.
- `docs/vault/archive/v0.1/Verification/` — dated verification logs for each implementation pass.
- Pre-harness milestone archives live in `docs/archive/`; empirical research reports live in `docs/research/`.
