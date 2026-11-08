import type { Readable } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'

// Each pipe owns its UTF-8 continuation state, even when output is interleaved.
export function captureTerminalOutput(stream: Readable, output: TerminalOutput, onOutput?: (text: string) => void) {
  const decoder = new StringDecoder('utf8')
  const append = (text: string) => {
    const clean = output.append(text)
    if (clean) onOutput?.(clean)
  }
  stream.on('data', (chunk: Buffer) => append(decoder.write(chunk)))
  stream.on('end', () => append(decoder.end()))
}

// Streaming escape filtering: sequences may be split across arbitrary chunks.
// The result is plain text, never terminal commands, HTML or OSC hyperlinks.
export class TerminalOutput {
  private mode: 'text' | 'escape' | 'csi' | 'string' | 'stringEscape' = 'text'
  private buffer = ''
  private first = ''
  private base = 0
  private total = 0
  append(chunk: string) {
    let clean = ''
    for (const char of chunk) {
      const code = char.charCodeAt(0)
      if (this.mode === 'stringEscape') { this.mode = char === '\\' ? 'text' : 'string'; continue }
      if (this.mode === 'string') { if (char === '\x07' || char === '\x9c') this.mode = 'text'; else if (char === '\x1b') this.mode = 'stringEscape'; continue }
      if (this.mode === 'csi') { if (code >= 0x40 && code <= 0x7e) this.mode = 'text'; continue }
      if (this.mode === 'escape') {
        this.mode = char === '[' ? 'csi' : [']', 'P', '^', '_'].includes(char) ? 'string' : 'text'
        continue
      }
      if (char === '\x1b') { this.mode = 'escape'; continue }
      if (char === '\x9b') { this.mode = 'csi'; continue }
      if (char === '\x9d' || char === '\x90') { this.mode = 'string'; continue }
      if (code < 32 && !['\n', '\r', '\t'].includes(char) || code >= 0x7f && code < 0xa0) continue
      clean += char
    }
    this.first = (this.first + clean).slice(0, 32_000)
    this.buffer += clean; this.total += clean.length
    if (this.buffer.length > 512_000) { this.base += this.buffer.length - 512_000; this.buffer = this.buffer.slice(-512_000) }
    return clean
  }
  read(offset = 0, limit = 16_000) {
    const start = Math.min(this.total, Math.max(this.base, offset))
    const output = this.buffer.slice(start - this.base, start - this.base + limit)
    return { output, offset: start, nextOffset: start + output.length, truncated: offset < this.base, available: this.total }
  }
  preview() { return { output: this.first, truncated: this.total > this.first.length } }
  tail() { return this.buffer.slice(-8000) }
}
