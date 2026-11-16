/** First letters of the display name, or the first two letters of the email. */
export function initials(name: string, email: string): string {
  const source = name.trim() || email.trim()
  if (!source) return "?"
  const words = source.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    return `${words[0]![0] ?? ""}${words[1]![0] ?? ""}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}
