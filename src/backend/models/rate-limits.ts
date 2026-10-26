import type { RateLimitWindow } from '../../shared/connection-usage.ts'

function count(value: string | null) {
  if (value === null || !/^\d+$/.test(value.trim())) return

  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function resetTime(value: string | null, now: number) {
  if (!value) return

  // OpenAI reports durations such as 6m0s or 1.5s, not Unix timestamps.
  const units: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g)]
  if (!parts.length || parts.map(part => part[0]).join('') !== value) return

  const duration = parts.reduce((total, part) => total + Number(part[1]) * units[part[2]], 0)
  if (!Number.isFinite(duration) || duration <= 0 || duration > 366 * 86_400_000) return

  return now + duration
}

export function parseRateLimitHeaders(headers: Headers, now = Date.now()): RateLimitWindow[] {
  return (['requests', 'tokens', 'project-tokens'] as const).flatMap(kind => {
    const limit = count(headers.get(`x-ratelimit-limit-${kind}`))
    const remaining = count(headers.get(`x-ratelimit-remaining-${kind}`))
    if (limit === undefined || limit <= 0 || remaining === undefined || remaining > limit) return []

    const reset = headers.get(`x-ratelimit-reset-${kind}`)
    const resetsAt = resetTime(reset, now)
    // Don't retain an expired or unrecognized reset as an active limit.
    if (reset !== null && resetsAt === undefined) return []

    return [{ kind, limit, remaining, ...(resetsAt === undefined ? {} : { resetsAt }) }]
  })
}
