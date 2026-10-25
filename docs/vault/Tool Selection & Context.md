# Tool Selection & Context

> Agreed October 25, 2026, as D-066 from P-016: use a Codex-style compact direct core plus discovery for optional integrations and optimize later. This is a target specification, not implemented selection. Exact Codex internals are not assumed universal; Granite needs a portable path for other providers.

Start visually: [[Tool Lookup.canvas]]

Scope-specific core tools and saved-context retrieval are agreed in [[Repository & Context Tools]] and [[Context Retrieval.canvas]] (D-058, accepted from P-017). Repository-write definitions are omitted outside the owning repository project; separately permitted memory/notes operations do not grant repository writes. The broader optional-tool lookup policy is accepted in D-066; current permissions refresh under D-064.

Related: [[Tooling Strategy]] · [[Memory & Context Policy]] · [[Things to Optimize]] · [[Skills & MCP Policy]] · [[Remaining Harness Decisions]] · [[Decisions & Questions]]

## Distinguish fit from capability

Granite passes tool definitions: names, descriptions and argument schemas. The model proposes calls, and Granite validates/executes them. Definitions occupy model input space; returned file/search/tool content occupies space too. A large maximum window does not by itself show how reliably a model selects tools, produces their arguments or follows a multi-step task.

Do not use a universal rule such as “500k models receive every tool; under-100k models cannot handle them.” A compact small toolset may work with a smaller window, while a large catalog with overlapping purposes can confuse a model even when it fits. Tool-schema complexity and relevance matter alongside the number of tools.

## Agreed starting policy

1. **Filter by scope and configuration first.** Only consider enabled tools and resources available to this chat. Tool discovery must not expose another Closed section's information or grant new capabilities. Every actual call still receives backend permission checks.
2. **Use the actual configured model window and remaining headroom.** Apply the existing model-aware input/reply-reserve policy, counting instructions, task/history, context, tool definitions and protocol overhead. Do not budget from a model's advertised maximum when the loaded/configured window is smaller. Preserve space for the reply and useful tool results.
3. **Keep a compact, stable core.** For repository work, favor the ordinary file-list/search/range-read/edit operations already planned. Expose tools appropriate to the task and available write targets. A smaller window does not automatically require a different core if that core fits and the model uses it reliably.
4. **Use a lookup tool for optional integrations.** Keep ordinary core tools directly visible and expose a simple `lookup_tools` function for the remaining eligible catalog. Do not require a discovery step for every native file read/edit. A short description of available capability categories can help the model know what it can look up without loading every definition. Complex automatic routing is an optimization, not a prerequisite for this simple discovery path.
5. **Consider demonstrated tool-use support separately.** Track provider/model compatibility and test whether the model selects the right tool and supplies valid arguments. Use compact descriptions and supported schemas; do not infer competence from context length or parameter count alone. If required tooling is unsupported or essential definitions cannot fit, explain the limitation instead of silently pretending the task has the same capabilities. D-063 fixes the session model/provider; D-064 applies permission changes at subsequent requests/tool executions.
6. **Keep outputs bounded too.** Use file ranges, filtered search results and pagination. Reducing definitions is insufficient if a large tool result consumes all remaining space.

These are request-context fit checks, not run time/step/tool-call budgets. They do not stop a healthy run merely because it has taken many steps. Tool visibility is also separate from execution ordering: the first iteration still executes proposals sequentially.

## Concrete recommendation: core plus lookup

Prefer the same architecture for compatible small- and large-context models. A larger window may permit more relevant definitions at once; it is not a reason to automatically expose the entire installed tool library. If the entire eligible library is just the compact core, direct exposure of that core is sufficient and lookup need not discover anything extra.

| Tool group | Recommended exposure |
| --- | --- |
| Small core appropriate to this chat, such as listing/search/range reads and permitted edits | Include full definitions directly. Existing scope/write-target checks still apply. |
| Skill loader and terminal capability | Include directly when enabled/appropriate and compatible; preserve the separate skill and command permission rules. |
| `lookup_tools` | Include as a simple read-only discovery function when optional tools exist. Search only the currently eligible enabled catalog; recheck before execution. |
| Optional MCP or specialized integration tools | Discover and expose the relevant full definitions when needed. Do not send every connected server's schemas at startup. |

Initial flow:

1. The model starts with the compact core and `lookup_tools(query)`.
2. When it needs an optional capability, it might request `lookup_tools("GitHub pull requests")`. Granite searches names/descriptions/categories within the eligible catalog, using simple bounded lexical matching initially. No second model is required to perform that lookup.
3. Granite returns a bounded set of matching tool identities/descriptions and makes the selected full argument schemas available in the next model request. Merely returning tool names is insufficient. Discovery does not execute the selected tools.
4. The next model response can propose a normal call to the discovered typed tool. Granite applies the usual schema, scope and action-authorization checks, executes it and records the result.

Use the normal registry and model loop, not a catch-all untyped execution shortcut that makes the model guess argument shapes. Lookup itself is read-only metadata access; a discovered write or remote action still needs its normal authorization. A failed/no-match lookup does not install tools, connect servers or expand scope.

Implement lookup as an ordinary Granite function tool, so the basic design does not depend on a hosted provider's native tool-search feature. A local host/model that supports the ordinary structured tool-call interface can use the same loop; reliability still needs model-specific verification. If a model cannot reliably use discovery, a small explicitly selected task bundle is a fallback to evaluate, not a guarantee that any model can operate every tool.

Keep already-needed definitions available for the ongoing task and preserve valid history, but do not accumulate every found schema forever. Count selected definitions against actual headroom before the next request. The full eligible registry can remain in Granite while only selected definitions are sent to the model. Lookup cannot grant permission. Rebuild the eligible catalog on the next request after settings change and recheck current permissions before execution under D-064; an already-started action is not automatically cancelled.

## First implementation versus later optimization

Implement the compact native core first. Add the simple lookup path when optional integrations are introduced; it is part of the agreed integration architecture, not an extra step imposed on every ordinary core operation. No application code was changed in this discussion.

Evaluate smarter ranking, schema caching/eviction, provider-native discovery and per-model tuning after the basic path works. Large catalogs are where lookup is expected to help most; for a small core, its extra request would add work without meaningful context savings.

Only select within the currently permitted catalog; finding a tool does not grant permission. Apply changes at model-request boundaries, retain valid call/result history and never remove a definition needed to validate an already-started action. Discoverability and correctness must be evaluated as well as token savings: an extra discovery step can make a small catalog less efficient.

Measure schema tokens, remaining task/history space, incorrect tool choices, malformed arguments, successful tasks and response latency per model. Tune profiles from those results instead of imposing fixed 100k/500k cutoffs. This evaluation is listed in [[Things to Optimize]].

## Current implementation baseline

The inspected loop passes `registry.definitions` to `adapter.step` each time, and the chat-completions adapter serializes that list as tool definitions. The loop's byte guard currently counts input/history and instructions; it is not the proposed full model-token-aware accounting of serialized schemas and protocol overhead. No adaptive selector was implemented during this planning discussion.

Sources: `src/backend/harness/loop.ts`, `src/backend/harness/tools/registry.ts`, `src/backend/harness/providers/chat-completions.ts`.

## Evidence checked October 24, 2026

[Anthropic's advanced tool-use article](https://www.anthropic.com/research/advanced-tool-use) describes both definition-token overhead and incorrect tool selection/arguments in large catalogs. It reports benefits from loading relevant definitions on demand, while also identifying extra search latency and less benefit for compact catalogs. These are vendor findings, not a universal context-size cutoff.

[LM Studio's tool-use documentation](https://lmstudio.ai/docs/developer/openai-compat/tools) distinguishes native from fallback tool formatting and describes malformed-call problems for some models. This supports treating model/host tool-use compatibility as a separate factor from context capacity; it does not establish a reliable maximum tool count for every model.

## Codex-style baseline checked October 25, 2026

The current Codex session exposes core tools and deferred optional tool namespaces; that is direct session evidence, not a guarantee about all Codex releases or configurations. Adopt that observable pattern rather than copying undocumented internals.

[Official OpenAI tool-search documentation](https://developers.openai.com/api/docs/guides/tools-tool-search) documents runtime loading of deferred definitions, including client-executed discovery and provider/model compatibility requirements. This supports the pattern, but is API documentation rather than proof of every Codex implementation. Granite’s ordinary `lookup_tools` fallback preserves the architecture for compatible self-hosted models without requiring a proprietary native feature. Advanced ranking/caching remains in [[Things to Optimize]].
