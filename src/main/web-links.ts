// Model-generated Markdown is untrusted. Only absolute web URLs may reach the
// operating system's browser launcher; never pass file or application schemes.
export function externalWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 8192 ||
      !/^https?:\/\//i.test(value) || /[\u0000-\u0020\u007f]/.test(value)) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    return url.href
  } catch { return null }
}
