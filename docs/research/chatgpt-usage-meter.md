# ChatGPT usage meter investigation

Checked October 26, 2026 against the current Granite implementation and the saved ChatGPT connection. No model generation was requested.

## Cause of the missing circle

The sidebar only receives readings parsed from `x-ratelimit-limit-*`, `x-ratelimit-remaining-*`, and `x-ratelimit-reset-*` headers on inference responses. It has no ChatGPT account-allowance reader. Its data type only represents request and token counts, so it cannot currently display account windows such as five hours or a week.

Connections without a reading are intentionally hidden. The missing ChatGPT circle follows that code path; it is not a CSS or positioning problem.

## Live findings

- The connected account uses Sign in with ChatGPT plan sharing, with `chatgpt.tokens.use.direct` and `resource.invoke` permissions.
- Granite's existing account manager renewed its expired session successfully.
- A read-only `GET https://api.openai.com/v1/models` returned HTTP 200 and a model catalog. It returned no usage, quota, or rate-limit headers. This checks catalog access; it does not establish what every inference response can contain.
- The account token exposes encrypted authentication metadata, without the `chatgpt_account_id` required for the documented external-token Codex login.
- A separate ephemeral Codex app-server diagnostic, supplied the Granite access token through `CODEX_ACCESS_TOKEN`, reported no authenticated Codex account. `account/rateLimits/read` returned JSON-RPC error `-32600`: `codex account authentication required to read rate limits`. This is an authentication prerequisite failure, not a returned account balance or a remote quota-endpoint rejection.
- The diagnostic did not read another application's account limits or replace Granite's model transport.

## What is required for actual allowance readings

OpenAI documents `account/rateLimits/read` and `account/rateLimits/updated` for authenticated Codex accounts. These return `usedPercent`, `windowDurationMins`, and `resetsAt`, with optional multiple metering buckets. They are a different source from the API request/token headers implemented by Granite.

The documented Sign in with ChatGPT integration directs usage controls to ChatGPT Settings → Usage. It does not establish that Granite's existing plan-sharing grant can read the Codex account-limit interface. No compatible direct allowance-reading endpoint was confirmed in this investigation.

An optional, separately authorized Codex usage connection could supply those readings without changing Granite's own agent loop or current model connection. It would need explicit account association, protected credentials, allowance-window normalization, refresh handling, and tests of the real account-reader path. It must never silently display the limits of an unrelated locally signed-in account.

The previous API-header tests verify API meters only; they do not verify ChatGPT five-hour or weekly allowance support. Do not describe that feature as implemented.

## User decision

On October 26, 2026, the user deferred any integration that requires another sign-in solely for usage limits. Track this in [Things to Optimize](../vault/Things%20to%20Optimize.md#chatgpt-account-usage-limits). Prefer a compatible reader using the existing model-access sign-in if one becomes available; a separate sign-in has not been established as the only possible future approach.

## Official documentation

- [Codex app-server account authentication and rate limits](https://learn.chatgpt.com/docs/app-server#auth-endpoints)
- [Codex app-server with a ChatGPT plan-sharing access token](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server)
- [Sign in with ChatGPT accounts, sessions, and usage controls](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage)
- [Codex credential storage, including ephemeral authentication](https://learn.chatgpt.com/docs/auth#credential-storage)
