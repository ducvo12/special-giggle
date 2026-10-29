# Granite planning vault

> Consolidated October 29, 2026. This is the entry point for the current design, delivery status and visual maps.

## Where the project stands

| Work | Status | Evidence / next work |
| --- | --- | --- |
| Pass 1 — Data foundation and organization | Implemented; original criteria reviewed | [[Pass 1 Implementation & Testing]] |
| Pass 2 — Run lifecycle and scheduling | Implemented; selected desktop checks passed | [[Pass 2 Implementation & Testing]] · [[Pass 2 Focused Verification Results]] |
| Pass 3 — Repository tools and change visibility | Implemented; basic verification complete | [[Pass 3 Implementation & Testing]] |
| Pass 3A.1 / 3A.2 — Autonomous project setup | Implemented; recorded framework builds, real-model and desktop checks | [[Pass 3A.1 Implementation & Testing]] · [[Pass 3A.2 Implementation & Testing]] |
| Pass 4 — Context, memory and retrieval | Next; planned | [[Harness Implementation Plan#Pass 4 — Context, Memory and Retrieval]] |
| Pass 5 — Lifecycle and extensions | Planned | Temporary expiry/Keep, container deletion, missing-folder recovery, skill imports, scoped MCP and optional tool lookup |
| Pass 6 — Integration and release verification | Planned | Whole-app verification, migration, packaging and available hosted/local providers |

Implementation is not exhaustive acceptance. [[Tests to Run Later]] tracks unfinished checks separately from [[Things to Optimize]]. Closed-section execution awaits pass 4; temporary-chat execution and expiry await pass 5. Existing basic memory and agent/chat deletion do not complete those later passes.

## Current specifications

- [[Harness Design]] — organization, membership and v0.1 scope.
- [[Memory & Context Policy]] — pass-4 context, retrieval, summaries, editable memory and deletion support.
- [[Run Lifecycle Design]] — streaming, steering, queues, approval, Stop, failures and restart; includes planned temporary timers.
- [[Repository & Context Tools]] — current repository capabilities and planned native context APIs.
- [[Tools & Permissions]] — action authorization, instruction authority, skills, MCP and optional discovery.
- [[Container & Settings Rules]] — deletion, repository links and changes to settings; delivery boundaries are labeled.
- [[Harness Implementation Plan]] — remaining v0.1 changes and acceptance checks.
- [[Pass 4 Implementation Plan]] — concrete context/search/memory implementation, reuse choices and verification order.
- [[Decision Register]] — stable decision IDs and where their current rules live; superseded proposals are no longer active requirements.

## Visual maps

[[Available Agent Tools.canvas]] lists all current built-in tool names, conditional availability and the separately planned context/integration tools. Start there when reviewing Pass 4 capabilities.

Start with [[Harness Overview.canvas]] and [[Agent Structure.canvas]]. Then use [[Run Lifecycle.canvas]], [[Memory & Context.canvas]], [[Context Retrieval.canvas]], [[Repository Access.canvas]] and [[Temporary Chat Flow.canvas]]. The detailed lifecycle canvases cover steering, approvals, queues, edits, failures, Stop, deletion, expiry and reopening. These are design maps; their status labels distinguish planned context/lifecycle features from delivered behavior.

## Later releases

[[Granite Vision & Roadmap]] owns version assignments. v0.2 adds worktrees, same-section repository grants and broader capabilities; v0.3 adds scale/efficiency work and mixed-model subagents. Neither later release has numbered implementation passes yet. [[Repository Access & Worktree Plan]] is the v0.2 proposal with its remaining choices. [[Things to Optimize]] holds measured-improvement work and unassigned ideas; it does not defer basic pass-4 correctness.

## Evidence and maintenance

The `Verification/` folder holds dated implementation/test checkpoints. Results describe the tested revision and scope, not a guarantee about every later build, registry package or provider. Pre-harness milestone results live in `docs/archive/`; research investigations live in `docs/research/` and are not current specifications.

Use the focused specification as the rule, the implementation plan as delivery status, and verification notes as evidence. Update those when a decision changes instead of adding another competing draft. Keep canvas layouts intact when updating their text.
