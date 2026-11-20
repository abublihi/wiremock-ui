/** Small URL helpers shared by config, validation and recording. Linear time on any input (no backtracking regex). */

/** An absolute http:// or https:// URL with a host. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host !== ''
  } catch {
    return false
  }
}

/** `https://x/api///` → `https://x/api`. */
export function trimTrailingSlashes(value: string): string {
  let end = value.length
  while (end > 0 && value.charCodeAt(end - 1) === 47 /* / */) end--
  return value.slice(0, end)
}
