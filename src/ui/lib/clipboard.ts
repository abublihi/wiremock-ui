/**
 * Puts text on the clipboard. The Clipboard API needs a secure context (https or localhost); elsewhere — an
 * intranet host over plain http, say — a hidden textarea and `execCommand('copy')` still work. The textarea
 * goes inside the open dialog, if any, so the dialog's focus trap doesn't pull focus away from it.
 */
export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // denied or unavailable: try the fallback
    }
  }
  const host = document.activeElement?.closest('[role="dialog"]') ?? document.body
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  const previous = document.activeElement as HTMLElement | null
  host.appendChild(area)
  area.focus()
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } finally {
    area.remove()
    previous?.focus?.()
  }
  if (!ok) throw new Error('The browser refused to copy. Select the text and copy it by hand.')
}

/**
 * Copies text that is still being worked out (a fetch first). Safari only lets a page write to the clipboard during
 * the click itself, so where ClipboardItem exists the write starts now with a promise of the text; elsewhere the text
 * is awaited and copied as usual.
 */
export async function copyTextLater(text: Promise<string>): Promise<void> {
  const Item = typeof window !== 'undefined' ? (window as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem : undefined
  if (Item && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new Item({ 'text/plain': text.then((s) => new Blob([s], { type: 'text/plain' })) })])
      return
    } catch {
      // not allowed here: fall back below
    }
  }
  await copyText(await text)
}
