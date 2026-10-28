export interface ChatAttachment {
  id: string
  name: string
  size: number
  content: string
}

export const attachmentLimit = 24_000
export const messageLimit = 32_000

export async function readAttachments(files: File[], existing: ChatAttachment[]): Promise<ChatAttachment[]> {
  if (files.length + existing.length > 5) throw new Error('Attach up to 5 text or code files per message.')
  if (files.reduce((size, file) => size + file.size, existing.reduce((size, file) => size + file.size, 0)) > attachmentLimit) {
    throw new Error('Attached files must total 24 KB or less.')
  }
  const added = await Promise.all(files.map(async file => {
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer())
      if (/[\u0000-\u0008\u000e-\u001f]/.test(content)) throw new Error('Binary file')
    } catch { throw new Error(`${file.name}: choose a UTF-8 text or code file.`) }
    return { id: crypto.randomUUID(), name: file.name, size: file.size, content }
  }))
  return [...existing, ...added]
}

export function messageWithAttachments(draft: string, attachments: ChatAttachment[]): string {
  const text = [draft.trim(), ...attachments.map(file => {
    const longest = Math.max(2, ...(file.content.match(/`+/g) ?? []).map(run => run.length))
    const fence = '`'.repeat(longest + 1)
    return `### Attached file: ${JSON.stringify(file.name)} (${file.size} bytes)\n${fence}text\n${file.content}\n${fence}`
  })].filter(Boolean).join('\n\n')
  if (text.length > messageLimit) throw new Error('The message and attached files are too long. Shorten the message or remove a file.')
  return text
}

export function sentAttachments(content: string): { name: string; size: number; content: string }[] {
  const pattern = /^### Attached file: ("(?:[^"\\]|\\.)*") \((\d+) bytes\)\n(`{3,})text\n([\s\S]*?)\n\3(?=\n|$)/gm
  return [...content.matchAll(pattern)].flatMap(match => {
    try { return [{ name: JSON.parse(match[1]) as string, size: Number(match[2]), content: match[4] }] }
    catch { return [] }
  })
}
