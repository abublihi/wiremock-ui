import { useRef } from 'react'

/** What opened the dialog: the focused element, or the menu's button when the focus is on a menu item. */
function opener(): HTMLElement | null {
  const active = document.activeElement
  if (!(active instanceof HTMLElement) || active === document.body) return null
  // A menu item goes away with its menu; the menu names its button through aria-labelledby.
  const labelledBy = active.closest('[role="menu"]')?.getAttribute('aria-labelledby')
  return (labelledBy && document.getElementById(labelledBy)) || active
}

type Handler = (event: Event) => void

/**
 * Radix returns focus on close only to its own Trigger, so dialogs opened through state (a button's onClick,
 * a menu item) would drop the focus on <body>. Remembers what was focused when the dialog opens and focuses
 * it again on close, unless the caller's own onCloseAutoFocus already handled it.
 */
export function useReturnFocus({ onOpenAutoFocus, onCloseAutoFocus }: { onOpenAutoFocus?: Handler; onCloseAutoFocus?: Handler }) {
  const target = useRef<HTMLElement | null>(null)
  return {
    // Runs before Radix moves the focus into the dialog.
    onOpenAutoFocus: (event: Event) => {
      target.current = opener()
      onOpenAutoFocus?.(event)
    },
    onCloseAutoFocus: (event: Event) => {
      onCloseAutoFocus?.(event)
      const el = target.current
      target.current = null
      if (event.defaultPrevented || !el?.isConnected) return
      event.preventDefault()
      el.focus()
    },
  }
}
