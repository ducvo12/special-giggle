// Normalize common LaTeX delimiters without touching fenced or inline code.
export function normalizeMathDelimiters(text: string): string {
  return text.replace(
    /(^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\2[^\n]*(?:\n|$)|(?![\s\S])))|(`+)[\s\S]*?\3|\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/gm,
    (match, fence, _marker, inline, display, math) => {
      if (fence || inline) return match
      if (display !== undefined) return `\n\n$$\n${display.trim()}\n$$\n\n`
      return `$${math}$`
    }
  )
}
