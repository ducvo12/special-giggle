# Pass 3A.2 Implementation & Testing

> Dated verification record. Counts, environments and limitations below describe their recorded checkpoints. For current behavior use [the harness guide](../../harness.md); for delivery status use [[Start Here]]. Temporary evidence paths may no longer exist.

> Implemented October 27, 2026, following the user's request to implement the second pass. This extends [[Pass 3A.1 Implementation & Testing]] with human choices, bounded setup/retry permissions and managed local previews. Validation results and external-package limitations are recorded below; they are distinct from the full target specification in [[Repository Project Setup Plan]].

Related: [[Harness Implementation Plan]] · [[Tools & Permissions#Action authorization]] · [[Run Lifecycle Design]] · [[Run Lifecycle Design#Stop and unexpected closure]] · [[Tools & Permissions#Tool implementation and reuse]]

## Questions and continuation

`ask_user` asks one to three concise questions, with optional suggested choices and always a free-text answer. Its panel is separate from permission approval. The model should inspect existing files, reuse supplied choices/defaults, handle routine known installer answers itself, and ask only for consequential missing information. Credentials are excluded from this chat flow.

The run enters `question` state and retains its project reservation, but holds no model-capacity lease. Independent chats can respond while a question is pending. Each answer must match the owning run, opaque question ID and answer count. Answers are accepted once. Stop/closure rejects pending answers; steering withdraws the old question and the next model step sees the new direction. Startup removes pending question handles and marks interrupted transcript questions rather than answering/resuming them.

Question text, status and answers are kept in ordinary chat history. The user answer has a question association and is returned to the model as both the tool result and explicitly associated user input. A separate assistant message follows the answer, preserving transcript ordering and preventing the answered question from appearing to be the latest unfinished user request. Choice answers resolve choices; they do not grant unrelated capabilities or become global memory.

## Setup permissions and retries

Granite records task grants with owning agent/chat/run/project, operation, original user message or actual approval ID, state and retry lineage. Terminal enablement and repository membership remain separate prerequisites. Setup grants are shown in **Task permissions**, including recent ended/revoked records, and can be revoked from that chat.

Recognized direct requests for Next.js/Vite setup authorize their scaffold and necessary project dependency installations. A supplied supported scaffold command provides the same bounded intent; a direct dependency request or installation command authorizes dependency work. A package setup approval also covers its necessary installation steps, which its preview explicitly explains. The command classifier uses the maintained `shell-quote` parser, rejects shell operators/substitution and global/redirected installs, and recognizes supported single npm/pnpm/yarn/bun installation/create and npx/bunx/pnpm-dlx scaffold forms. Unsupported/compound commands require their own exact-action approval. These grants do not authorize deployment, Git mutations, push, host credentials or arbitrary network commands.

For a clear `try again`, retry or Continue, derive a fresh grant only from the immediately preceding human task's eligible grant, for the same chat/project. Record the new user request and previous grant ID. Do not search arbitrarily far back for an unrelated permission. Revoked/denied grants are not revived, task grants end at run closure, and current denials block repeated approval attempts within that task. A new explicit user request can establish a fresh scope. The model must inspect completed effects before retrying; no failed or interrupted action is automatically replayed.

Following the October 27 user revision, preview choices are ordinary task instructions and no longer use permission grants. “Do not start a preview” must not cancel a requested scaffold, and command flags such as `--no-interactive` are not natural-language denials. Recognition is deliberately conservative; unfamiliar or ambiguous wording falls back to a concrete approval rather than blanket permission. Granting command networking still permits that command's confined children to use networking under the existing command policy; this pass does not implement domain allowlists or a traffic proxy.

## Managed previews

New model tools: `repo_preview_start`, `repo_preview_list`, `repo_preview_read`, `repo_preview_stop`. User controls provide **Open preview**, **Refresh from current code** and **Stop preview**. Each preview has its own opaque ID, owning chat/project, status, output tail, local address, capture time and repository revision. Only the owning permanent repository chat can inspect/control it. Restart still requires terminal enabled; Stop remains available independently.

October 27 user revision: the agent may start a preview whenever useful, without a separate user request, authorization grant or approval dialog. It must still honor explicit instructions not to preview and Stop actions. Terminal enablement and repository ownership remain enforced. Historical preview permission records are preserved as data but ignored by current preview actions and excluded from task-permission displays/retries. Granite allocates or verifies an available unprivileged port and provides `HOST=127.0.0.1`, `HOSTNAME=127.0.0.1` and `PORT`. Commands must bind explicitly to those values; the tool describes Vite/Next.js flags. The process policy permits binding/inbound traffic only on that loopback port and outbound loopback traffic only to that port. Public outbound and nonloopback listening remain denied. This is independent of installer downloads and public web search.

Prepare a fresh isolated copy and compare complete source/staged manifests before starting. A running preview never publishes its writes. It has an isolated HOME/cache and inherits Granite's process supervision, minimal environment, Git protections and filesystem confinement. Readiness requires an actual successful HTTP response without following redirects, plus a listener PID belonging to the recorded process tree; spawn success/output text alone cannot establish readiness. Individual probes are bounded, while the server has no fixed lifetime deadline.

A **ready** preview may survive the final answer and releases model/project capacity while idle. An unfinished ordinary terminal or unready preview still cannot be abandoned by a successful final reply. Later source changes mark a preview stale after repository settlement or an explicit status check. The UI always labels its captured snapshot and tells the user to refresh after external edits. Refresh/restart stops the old copy and prepares current code; it never claims an old server reflects new edits. Manual refresh is unavailable during active project work, and unresolved repository outcomes block new previews.

Explicit Stop, Stop on the owning run, chat/agent deletion and normal app shutdown settle owned preview processes and remove disposable storage. A worker/app crash invokes the same private parent-liveness supervisor as commands. Startup checks durable process identities, settles remaining known writers and reports interruption; no preview is replayed automatically. Dismissing a known interruption acknowledges its notice without restarting the server or clearing an unresolved cleanup outcome. Unknown cleanup outcomes retain their record/storage for review and block deletion of that recovery data. Pending starts are tracked/cancellable so shutdown cannot miss a copy being prepared. Existing project/container deletion capabilities outside this pass remain on the pass-5 schedule.

The tools reuse Granite's own harness and supervisor. The preview network-policy form was checked against the [official Codex Seatbelt implementation](https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/seatbelt.rs), then restricted to the assigned port and tested locally. Granite does not embed or inherit Codex's harness.

## Verification

Automated suite: **133 passed, zero failed** in the final completed suite (`/tmp/granite-3a2-tests.log`). Coverage extends the existing terminal/link/publication tests with question ownership/count/one-answer behavior, capacity release, steering/Stop invalidation and persisted history; bounded command parsing and setup/retry denial; actual local readiness, confined server writes, stale snapshots and refresh; public/nonloopback denial; actual preview-owner SIGKILL and clean reopen without replay; a ready preview surviving a final reply, releasing project capacity and stopping on chat deletion. Additional coverage includes a question retaining the same-project queue, Stop during preview preparation, preview denial preserving authorized downloads, and rejection/cleanup of a final reply that abandons an unready server.

The desktop walkthrough uses an isolated profile, real worker/PTY/IPC/renderer and a deterministic simulated model. It passed the question options/free-text panel and resumed reply, persistent ready preview/status/Stop, project editing/diffs, queue release and actual worker-crash recovery. Initial screenshots were visually checked. Evidence: `/private/var/folders/p9/m26dt3sj2_s59n7tbqp8r82r0000gn/T/granite-repository-ui-rFm0bu`; log: `/tmp/granite-3a2-desktop.log`. The packaged walkthrough is checked separately after the final build.

### Real framework commands and previews

`scripts/verify-project-setup.mjs` uses disposable profiles/repositories, the actual command sandbox/import path and actual registry downloads. It now verifies a production preview HTTP response and explicit termination after successful builds. It accepts `vite` or `next`, followed optionally by an exact scaffold version.

Vite's current `create-vite@latest` resolved to **9.3.2**, whose published archive contained only five files and omitted its template directories. The CLI printed an ENOENT template error but exited zero; the following dependency step correctly failed because no package.json existed. This was reproduced by inspecting the published `npm pack create-vite@9.3.2` archive outside Granite's command environment. The latest-version result is **failed due to the published package**, not silently marked passed or hidden by an automatic fallback. Evidence: `/tmp/granite-3a2-vite-latest.log` and `/tmp/granite-create-vite-package-check/pack.log`.

Separate known-version acceptance used:

```sh
npm create --yes vite@9.3.1 . -- --template react-ts --no-interactive
npm install --no-audit --no-fund
npm run build
npm run preview -- --host "$HOST" --port "$PORT" --strictPort
```

Result: **passed installation, build, guarded publication, actual locally served preview and Stop**. Resolved Vite 8.3.5 and React 19.3.1; published 811 items including six executable links. Log: `/tmp/granite-3a2-vite.log`.

Next.js acceptance used:

```sh
npx --yes create-next-app@latest . --ts --eslint --app --src-dir --use-npm --no-tailwind --import-alias "@/*" --disable-git --webpack --yes
NEXT_TELEMETRY_DISABLED=1 npm run build
npm run start -- --hostname "$HOST" --port "$PORT"
```

Result: **passed installation, build, publication, actual HTTP preview and Stop**. Resolved Next.js **16.4.3**, React **19.3.0**; 23,501 items including 23 links. As in 3A.1, the supplied scaffold included `--webpack` but the observed build reported Turbopack. Log: `/tmp/granite-3a2-next.log`. A second complete run passed under the final restriction to the assigned loopback port: `/tmp/granite-3a2-next-final.log`.

### Live agent acceptance and final checks

`scripts/verify-project-agent-live.mjs` uses the configured ChatGPT account through Granite's normal OS-protected credentials, or an explicitly configured `GRANITE_MODEL_BASE_URL`/`GRANITE_MODEL_ID`. Tokens remain in memory/account storage, never in shell commands or logs. It creates disposable repositories and removes them afterward. `--probe` checks model availability without a task. Live validation is not replaced by the simulated model.

The configured local endpoint was unreachable; the configured ChatGPT connection successfully resolved **gpt-6.1-sol** through Responses. The supplied Vite 9.3.1 request passed real-agent inspection, scaffold/install/build without a question or extra approval. The underspecified Next.js case also **passed**: the real model asked one grouped question containing language and styling choices, received test-driver answers of TypeScript/plain CSS plus defaults, resumed an interactive scaffold, supplied known installer input, inspected results, repaired build problems and completed a successful build command. Both cases ran without unexpected approval. This test driver supplies the human answer; it is not evidence that an actual human clicked those choices in that live-model run. The separate desktop test exercises the real answer panel.

Live evidence: `/tmp/granite-3a2-live.log`. The model was genuinely gpt-6.1-sol through Responses, not the deterministic fixture. The source script now also asserts framework output artifacts and records commands/dependencies for subsequent runs; the completed live run used the earlier successful-build-command assertion, while separate real CLI checks verified build output directories and actual production HTTP responses. These checks are deliberately recorded separately.

Final type checking and production build passed through `npm run package`. Local arm64 packaging includes the native PTY helper. It remains unsigned because no valid Developer ID identity is configured; this is local verification, not a release or deployment. Log: `/tmp/granite-3a2-package-final.log`. The **packaged desktop walkthrough passed** against the final `app.asar`, including the real worker/PTY, question panel/answer continuation, ready preview persisting after the reply, explicit preview Stop, queue release and worker-crash recovery. Log: `/tmp/granite-3a2-packaged-desktop.log`; evidence/screenshots: `/private/var/folders/p9/m26dt3sj2_s59n7tbqp8r82r0000gn/T/granite-repository-ui-tEkR22`. The question and expanded preview screenshots were visually inspected. `git diff --check` passed. No commit was created by this task.

No hosted web search, deployment, new command platform or unattended process restart was added. Framework/registry availability can still fail; the agent must report the actual failure and verify resulting files/builds. The runtime does not claim every arbitrary installer, application, provider or natural-language request has been exhaustively tested.

## Manual-test follow-up: reply links — October 27

The user found that an underlined “Open the app” link in the agent reply did nothing, while the preview panel's address worked. Rendered Markdown already used ordinary `target="_blank"` anchors, but the main window denied every new-window request. The separate preview Open control was unaffected.

The main window now sends validated HTTP/HTTPS destinations to the system browser and still denies creating an Electron window or navigating Granite to external content. Local preview ports, routes, queries and fragments are supported. File/application protocols, malformed/control-character URLs and embedded credentials remain blocked. Browser-launch failures produce a visible error.

Production build/type checking passed; **135 tests passed** including the URL boundary cases. The actual desktop walkthrough clicked the reply link, observed the system browser request at the running isolated preview's `/manual-link-check` route, and verified Granite stayed on its original page. It also repeated the existing question/session/preview/Stop/queue/crash checks. Logs: `/tmp/granite-web-links-build.log`, `/tmp/granite-web-links-tests.log`, `/tmp/granite-web-links-desktop.log`. Evidence: `/private/var/folders/p9/m26dt3sj2_s59n7tbqp8r82r0000gn/T/granite-repository-ui-VjY4Gj`. This follow-up updates the development build; no new distribution package or commit was created.

## Manual-test follow-up: previews without authorization — October 27

The user requested agent discretion to start previews with no preview authorization. Removed the preview approval callback and grant/denial gating, removed generation of preview grants, and updated model/tool instructions to use previews when helpful while respecting explicit opt-outs and Stop. Legacy preview-grant records are excluded from permission UI, model grant context and network retry derivation. Their presence or revoked state cannot reinstate the old approval requirement. No data migration/deletion is needed. Installer/download permissions remain separate; preview access does not grant Internet networking.

Verification exercises a model choosing to preview during “Check the app,” without any preview request, even with an old revoked preview-approval record present. It must reach ready status with zero approval prompts, survive the reply, retain isolated snapshot behavior and stop on chat deletion. Terminal disablement still rejects preview starts and removes their schemas. The real desktop walkthrough uses the same general request and checks the preview, link, Stop and recovery controls. Production build/type checking and **135 tests passed**; the desktop walkthrough passed with no preview approval and verified its browser link and lifecycle controls. Evidence: `/private/var/folders/p9/m26dt3sj2_s59n7tbqp8r82r0000gn/T/granite-repository-ui-jm73mX`. Logs: `/tmp/granite-preview-autonomy-build.log`, `/tmp/granite-preview-autonomy-tests.log`, `/tmp/granite-preview-autonomy-desktop.log`.
