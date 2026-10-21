import { useSyncExternalStore } from 'react'
import type { StreamDelta } from '../../../../shared/chat'

type Timing = {
  requestId: string
  start: number
  startedAt: number
  endedAt?: number
  firstChunk?: number
  lastChunk?: number
  firstVisible?: number
  lastVisible?: number
  thinking: number
  reasoningSince?: number
  reasoningCharacters: number
  characters: number
  visibleCharacters: number
}
let enabled = false
const records = new Map<string, Timing>()
const aliases = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0
function publish() { version++; listeners.forEach(listener => listener()) }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useDevTimings() {
  useSyncExternalStore(subscribe, () => version)
  return { enabled, records, aliases }
}
export function toggleDevTimings() { enabled = !enabled; publish() }
export function beginTiming(requestId: string) {
  if (!enabled) return
  records.set(requestId, {
    requestId, start: performance.now(), startedAt: Date.now(),
    thinking: 0, reasoningCharacters: 0, characters: 0, visibleCharacters: 0
  })
}
export function recordDelta(delta: StreamDelta) {
  const timing = records.get(delta.requestId)
  if (!timing) return
  const now = performance.now()
  if (delta.activity && delta.activity.reasoningCharacters > timing.reasoningCharacters) {
    timing.reasoningSince ??= now
    timing.reasoningCharacters = delta.activity.reasoningCharacters
  }
  if (delta.text || delta.tool) {
    if (timing.reasoningSince !== undefined) {
      timing.thinking += now - timing.reasoningSince
      timing.reasoningSince = undefined
    }
  }
  if (delta.text) {
    timing.firstChunk ??= now
    timing.lastChunk = now
    timing.characters += delta.text.length
  }
}
export function finishTiming(requestId: string) {
  const timing = records.get(requestId)
  if (!timing || timing.endedAt !== undefined) return
  if (timing.reasoningSince !== undefined) {
    timing.thinking += performance.now() - timing.reasoningSince
    timing.reasoningSince = undefined
  }
  timing.endedAt = Date.now()
  publish()
}
export function bindTiming(requestId: string, messageId: string) {
  if (!records.has(requestId)) return
  aliases.set(messageId, requestId)
  publish()
}
export function timingFor(messageId: string) { return records.get(aliases.get(messageId) ?? messageId) }
export function recordVisible(messageId: string, characters: number) {
  const timing = timingFor(messageId)
  if (!timing || !characters || characters === timing.visibleCharacters) return
  const now = performance.now()
  timing.firstVisible ??= now
  timing.lastVisible = now
  timing.visibleCharacters = characters
  if (timing.endedAt !== undefined && characters >= timing.characters) publish()
}
