# Granite Vision & Roadmap

> Version priorities set by the user October 27, 2026 (D-073/D-074). These are open feature lists, not implementation passes, dates or verified capabilities. The user intends to add more before sequencing v0.2 or v0.3. Keep the existing six-pass v0.1 plan and ongoing implementation intact; this update changes planning documents only.

Related: [[Harness Design]] · [[Harness Implementation Plan]] · [[Decision Register]] · [[Things to Optimize]] · [[Repository Access & Worktree Plan]] · [[Memory & Context Policy]]

## Product vision

Granite is a persistent personal-agent workspace that can use different model connections while preserving the agent's identity, user memory, knowledge and organized work. The harness owns context assembly, the model/tool loop, permissions, execution, history and recovery. Models supply reasoning and proposed actions; Granite supplies the persistent environment and controls their effects.

The original recorded design emphasizes:

- **Agent identity independent of model choice.** Each agent has its own folder, personality, user memory and notes. A provider/model connection is distinct from the agent itself.
- **Continuity with deliberate scope.** Sections, projects and chats organize coding, research, planning and other work. Shared/Closed boundaries and temporary retention control which information can be recalled and saved. User facts, transcripts, section context and knowledge notes have different roles.
- **Tools that accomplish work.** Repository editing, commands, tests, skills and scoped integrations sit behind Granite's own authorization, visible outcomes and Stop/recovery behavior.
- **User control.** Current saved memory/notes remain inspectable and editable; approvals and source/scope checks are enforced by the harness rather than relying only on model instructions.

Background: [[Harness Design]] (hierarchy, identity/model distinction, context and permissions), [[Memory & Context Policy]], [[Harness Overview.canvas]], and the October 18 milestone notes in `docs/archive/atlas-verification.md` and `docs/archive/multi-agent-verification.md`.

## Long-term orchestration goal — reaffirmed by the user

One primary agent should be able to delegate work to and coordinate subagents using different models, including different providers and local model connections. The parent should remain responsible for the user's task and combine the workers' results. Selecting a worker model/provider is distinct from moving an existing conversation to a different model.

This is an explicit v0.3 goal. D-003 keeps v0.1 free of delegated subagents; the delegation design remains future work. Do not describe the old milestone named “Multiple-agent” as parent-controlled subagents: it verified separate user-selectable agents with separate identities/data.

This goal still needs design for worker model/connection selection, task/context handoff, workspace ownership, permissions, result inspection, failure, cancellation and resource use. It does not grant workers automatic access to all agent identities, sections, credentials or repositories. D-063's fixed model within an existing chat/session remains intact unless separately revised.

## v0.1 — Complete the basic harness

Finish [[Harness Implementation Plan]]: the existing six passes plus the already-added pass 3A. Preserve its context/memory, lifecycle, scope, tool and recovery requirements and release verification. Basic compaction/context-fit handling, scoped tool lookup and ordinary command execution remain v0.1 obligations; the later optimization assignments do not remove their baseline correctness requirements.

Delivery status lives in [[Harness Implementation Plan]]; version headings are not completion claims.

## v0.2 — Broad practical capability

User goal:

> “can we get granite to do almost everything that codex or claude code can, but just a little bit worse.”

Treat that as a direction for practical task coverage, not a promise of exact feature parity with every current or future competitor feature. Extend this open list as the user identifies gaps; do not split the version into passes yet.

- **Worktrees and repository access:** isolated worktree groups, directly promptable chats, concurrent feature work, user-requested merge and successful-merge closure, plus user-granted same-section project editing. Preserve one attachment/no release and the original missing-folder rules. Details: [[Repository Access & Worktree Plan]].
- **Concurrency:** safe independent-session/worktree scheduling, coordination of shared checkouts/destinations, genuinely read-only concurrency where enforced, overlapping-folder detection and broader coordination across independently running agents. Parent-directed subagent orchestration is assigned to v0.3.
- **Platform and terminal support:** extend the initial macOS command implementation to additional command platforms, supported Git metadata layouts and advanced terminal tooling. Preserve supervision, authorization and recovery.
- **Shared caches:** evaluate scoped cross-project dependency/cache reuse without leaking credentials or crossing Closed/agent boundaries. Existing within-workflow continuity remains baseline behavior.
- **Networking:** broader domain/proxy controls and useful network capabilities beyond the existing authorized setup/local-preview workflow. Preserve the distinctions between downloads, local serving and remote writes/deployment.
- **Web search and provider tools:** add search and page-content retrieval for documentation, research and other tasks, with visible activity and clickable sources. Evaluate hosted search/provider-native tools, model/account capability checks and portable fallback paths for incompatible/local models. Verify API-key and account-sign-in behavior separately; assignment is not a claim that every provider supports every tool.
- **Browser interaction and visual verification:** let the agent navigate pages, click, type, inspect page structure/screenshots and use available console/network diagnostics to test and fix websites. Start with local website testing in a dedicated browser environment; broader browsing and signed-in account access need explicit session/access design. Existing preview servers and user-clicked links do not provide agent browser interaction. General native-application/desktop control remains unassigned.

Platform breadth and new terminal/network capabilities belong here; making the existing command-copy/change-tracking implementation more efficient belongs in v0.3.

## v0.3 — Optimization and mixed-model orchestration

The user's main goal for v0.3 is optimization. Subagents are also explicitly assigned here as a new capability, not relabeled as merely a performance improvement. This version remains an open list without passes.

- **Large-repository performance:** measure/tune searches, batching, bounded reads, generated/dependency exclusions, incremental file/symbol/import maps and semantic retrieval where justified.
- **Context efficiency:** tune automatic inclusion versus retrieval, incremental/cached summaries, compaction thresholds, response/tool headroom, provider caching/stateful continuation and smaller local-model windows. Preserve source tracking, freshness, scope and the basic context protections delivered earlier.
- **Summary/retrieval method review:** revisit per-chat summaries, multi-level topic/project/section digests and query-specific context assembly before choosing an implementation. Compare answer quality, freshness, latency, token cost and deletion/update complexity. This is an evaluation item, not a commitment to hierarchical summaries or a particular research method; retain the original sources and per-chat foundation. Detailed backlog: [[Things to Optimize#Model context]].
- **Subagents and mixed-model orchestration:** one primary agent directs workers using different models/providers and combines results. Design explicit delegation and workspace coordination; being a child agent does not prevent same-file collisions or grant additional permissions.
- **Tool discovery efficiency:** smarter model-aware tool ranking, definition caching/eviction and provider-native discovery for large integration catalogs. Basic permission-filtered lookup remains earlier scope.
- **Command execution and change tracking efficiency:** reduce full-manifest scans and temporary-copy costs, improve incremental reconciliation and safe dependency/cache reuse, bound diff storage and improve incremental change reporting while retaining truthful outcomes and conflict checks.

## Still unassigned

Do not silently add these separate earlier ideas to either release:

- Application/desktop control beyond the browser: begin with a concrete native-app or cross-application workflow, then design scoped access, visible actions, cancellation and verification. No version is assigned; this is a future capability, not automatically v0.3 optimization work.
- Automatic file restoration or an explicit Undo interface, including guarded restoration after Stop/crash.
- Provider-reported account allowance meters, preferably without a separate sign-in just for limits.
- Optional adoption of Codex app-server as a broader runtime architecture choice. Provider tools in v0.2 do not by themselves commit Granite to replacing its own harness.
- Migration of an existing chat/session across models/providers, and autonomous skill authoring/configuration expansion.

## How to use this roadmap

v0.1 establishes the reliable single-session foundation and scoped persistent agent experience. v0.2 expands the work Granite can practically complete. v0.3 improves scale/efficiency and adds the explicitly scheduled orchestration goal. These milestones serve the same personal-agent product vision; coding-harness capability is one part of that product.

Retain detailed backlog evidence and constraints in [[Things to Optimize]], using this note for version ownership. Add future features to the appropriate open list before deciding implementation sequence. No new feature implementation, pass numbering, model-session migration or cross-agent data access is authorized by a roadmap heading alone.
