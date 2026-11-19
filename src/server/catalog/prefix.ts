/** Path-boundary prefix rule: `/pay` matches `/pay`, `/pay/x`, `/pay?q=1`, not `/payments`. `/` matches everything. */
export function matchesPrefix(url: string, prefix: string): boolean {
  return prefix === '/' || url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`)
}

/** Key of the entry whose prefix matches any of `urls`; the longest prefix wins. */
export function longestPrefixMatch(urls: string[], prefixes: { key: string; prefix: string }[]): string | undefined {
  let best: { key: string; prefix: string } | undefined
  for (const url of urls) {
    for (const p of prefixes) {
      if (matchesPrefix(url, p.prefix) && (!best || p.prefix.length > best.prefix.length)) best = p
    }
  }
  return best?.key
}
