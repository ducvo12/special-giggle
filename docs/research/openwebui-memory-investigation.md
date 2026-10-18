# Open WebUI memory and Qwen3.5 generation investigation

Investigated October 18, 2026. This is a research record; no Granite runtime settings were changed as part of this investigation.

## Findings

Memory is not uniquely required to avoid the observed generation pattern. In ten controlled, short requests to the user's configured LM Studio server, both eight memory function definitions and two timestamp function definitions produced completed replies. Plain requests and a simple system-instruction request exhausted a 384-token limit entirely in reasoning without producing answer text, for both seeds tested.

The successful user-provided log contains 36 tools, not just memory tools, and has no system message or saved memory content in its messages array. This rules out injected saved memories as the immediate input difference for that particular logged first turn. It does not rule out different behavior in other chats.

## Evidence and scope

- Open WebUI tag: `v0.12.2`.
- Exact checked-out commit: `6a18585ff4c2e5f6805f682222cfbc46dc669ef8`.
- Examined the model editor, capability and builtin-category toggles, metadata defaults, chat feature assembly, memory context insertion, builtin registration and schemas, outgoing provider request construction, and incoming reasoning-stream handling.
- Parsed the complete user-provided successful request and compared it with the failing request supplied in the conversation.
- Inspected the published Hauhau Q6_K GGUF metadata, using an HTTP range request rather than downloading weights. The published file is 7,359,259,008 bytes, matching the described 7.36 GB model. Its embedded name is `Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-BF16`; its architecture is `qwen35`. This identifies the published artifact inspected, not a cryptographic verification of the user's installed file or any LM Studio template override.
- No full Open WebUI deployment was started. Registry selection was exercised by extracting its actual function via Python AST and supplying lightweight stubs for configuration, permissions, and callable construction. This checks selection logic rather than a complete integration deployment.

## What the successful request actually contains

Top-level fields: `stream`, `model`, `messages`, `tools`. The messages array has one user message: `Write one original inspirational quote in one sentence.` There is no system message, previous conversation, retrieved memory, sampling override, or explicit reasoning-effort override in that request.

| Category | Count | Functions |
| --- | ---: | --- |
| Time & Calculation | 2 | `get_current_timestamp`, `calculate_timestamp` |
| Ask User | 1 | `ask_user` |
| Knowledge Base | 7 | `list_knowledge_bases`, `search_knowledge_bases`, `query_knowledge_bases`, `grep_knowledge_files`, `search_knowledge_files`, `query_knowledge_files`, `view_knowledge_file` |
| Chat History | 2 | `search_chats`, `view_chat` |
| Memory | 8 | `search_memories`, `list_memory_paths`, `read_memory_path`, `list_memories`, `update_memory`, `add_memory`, `replace_memory_content`, `delete_memory` |
| Notes | 4 | `search_notes`, `view_note`, `write_note`, `replace_note_content` |
| Skills | 1 | `create_skill` |
| Task Management | 2 | `create_tasks`, `update_task` |
| Automations | 5 | `create_automation`, `update_automation`, `list_automations`, `toggle_automation`, `delete_automation` |
| Calendar | 4 | `search_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event` |
| Total | 36 | Eight memory functions and 28 unrelated functions |

The failing request also includes `stream_options.include_usage=true`. That option requests usage reporting, not a different user prompt. All ten direct comparison requests included it, so that difference cannot explain the contrast reproduced in these tests.

## Why the extra functions appear

There are three distinct model metadata controls:

1. `meta.capabilities.memory`: whether memory is permitted for the model.
2. `meta.capabilities.builtin_tools`: master gate for builtin tool injection in normal UI chats.
3. `meta.builtinTools`: category-level allow/deny settings, including `memory`, `time`, `knowledge`, etc.

In the frontend, category values are **enabled unless explicitly false**. Turning a category on deletes its explicit override; turning it off writes `false`. The backend uses the same default-on behavior. Turning off the master capability hides the category section; it does not erase or disable each category setting.

The memory category appends exactly eight functions when its category, model capability, instance setting, user feature, and permissions permit it. It does not register calendar, knowledge, or task functions as dependencies.

With stubbed global features matching the observed request, the actual registry produced:

| Effective selection | Function count |
| --- | ---: |
| Default category settings, memory permitted | 36, in the same order as the supplied log |
| Same settings, memory capability disabled | 28 |
| All categories explicitly disabled except memory | 8 |
| All categories explicitly disabled except time | 2 |
| All categories explicitly disabled | 0 |

Consequently, a 36-to-zero difference is not explained by flipping only the memory category under identical effective settings. A wider selection/default/master-gate difference reached the server. The logs do not reveal whether that came from UI state, saved model metadata, inheritance, a different preset, or stale configuration; a model configuration export would be needed to identify that origin.

Sources at the inspected tag:

- [Category UI defaults and toggle behavior](https://github.com/open-webui/open-webui/blob/v0.12.2/src/lib/components/workspace/Models/BuiltinTools.svelte#L84)
- [Master capability controls category visibility](https://github.com/open-webui/open-webui/blob/v0.12.2/src/lib/components/workspace/Models/Capabilities.svelte#L154)
- [Backend category defaults](https://github.com/open-webui/open-webui/blob/v0.12.2/backend/open_webui/utils/tools.py#L613)
- [Eight memory functions](https://github.com/open-webui/open-webui/blob/v0.12.2/backend/open_webui/utils/tools.py#L773)
- [Master injection gate](https://github.com/open-webui/open-webui/blob/v0.12.2/backend/open_webui/utils/middleware.py#L2456)
- [Tool resolution and outgoing schemas](https://github.com/open-webui/open-webui/blob/v0.12.2/backend/open_webui/utils/middleware.py#L3194)

## What tools change inside the model's prompt

The published Hauhau Q6_K artifact embeds a Qwen-style Jinja template. When `tools` is nonempty, it creates a system turn containing:

- A heading describing available functions.
- JSON schemas for the supplied functions.
- Instructions for the structure of function calls.
- Guidance to answer normally using existing knowledge when no function is available for the question.

With no tools and no caller-supplied system message, that system turn is absent. The first-turn prompt consists of the user question followed by the assistant generation prefix and an opening thinking marker.

Both branches still open the thinking sequence unless `enable_thinking` is explicitly false. Tool availability does not inherently turn reasoning off. The template has no instruction to invent tools when none exist, and no memory-specific loop prevention.

The published model used for metadata inspection is [HauhauCS Qwen3.5-9B Uncensored Aggressive Q6_K](https://huggingface.co/HauhauCS/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive/blob/main/Qwen3.5-9B-Uncensored-HauhauCS-Aggressive-Q6_K.gguf). The corresponding [official Qwen template](https://huggingface.co/Qwen/Qwen3.5-9B/blob/main/chat_template.jinja) has the same relevant branch structure.

## Direct inference comparison

Each condition used the same prompt and model ID, `stream=true`, usage reporting, a 384-token maximum, and seeds 42 and 43. Temperature and other sampling fields were omitted for every condition, leaving the server's settings in place. Requests were sequential.

| Input condition | Completed answer within cap | First answer, seconds | Total time, seconds | Completion tokens |
| --- | --- | --- | --- | --- |
| No tools | 0 of 2 | None | 10.97 / 11.05 | 384 / 384 |
| Eight memory tools | 2 of 2 | 5.08 / 4.62 | 7.10 / 5.28 | 183 / 181 |
| Two timestamp tools | 2 of 2 | 3.74 / 2.88 | 4.19 / 3.60 | 115 / 121 |
| Full logged tool set | 2 of 2 | 11.08 / 4.24 | 12.71 / 4.84 | 120 / 134 |
| Simple system instruction, no tools | 0 of 2 | None | 11.24 / 11.23 | 384 / 384 |

The no-tools first reasoning event arrived after **193 ms and 325 ms**. The server reported all 384 generated tokens as reasoning tokens in both runs. The timestamp-only runs reported 96 and 93 reasoning tokens, then returned answer text and a normal stop. The memory-only runs similarly ended normally.

The longer first full-tool run included about nine seconds before the first stream event. Different prompt lengths and cache state affect these timings; these tests do not establish a universal latency advantage for tools.

All tools were advertised definitions only. There was no local executor and no memory database attached to this direct test client. Successful runs ended with `finish_reason=stop`, rather than a tool-call finish. This shows that actual memory retrieval or modification is not necessary for the observed improvement.

The memory test's first seed produced extra explanatory text after the quote, so completion is not equivalent to perfect adherence to the one-sentence constraint.

Machine-readable measurements: [openwebui-memory-tests.json](openwebui-memory-tests.json).

## Interpretation and limits

The available evidence supports **prompt-sensitive generation behavior**: the tool-enabled formatted prompt leads to a shorter reasoning sequence on this task, while the minimal prompt leads to extended drafting and self-revision. The tool names are not being created by an external harness. The displayed outline and candidate revisions are ordinary generated text, not executable function definitions.

The input change is observable and reproducible in these short comparisons. The exact internal reason the model changes style is not established. Possible contributing factors include learned tool-use formatting, the additional system instructions, specific function-description text, the derivative's weights, sampling, or the serving implementation. Two seeds and one creative prompt are not a general model evaluation.

The 384-token cap bounds cost and time; exhausting it does **not** prove an uncapped generation would never finish. Previous longer user-supplied outputs show extensive repetitive revision, but individual requests may eventually terminate.

A simple direct-answer system instruction did not reproduce the benefit. The specific effective component within the tool prompt remains to be isolated. There is no basis to add fake memory tools to Granite as a production fix.

No live requests were made to a hosted provider; the experiment used the user's saved keyless LM Studio connection. Granite source code and saved connection settings were not changed.
