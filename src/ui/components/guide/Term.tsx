import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/components/ui/tooltip'
import { GLOSSARY } from '@/ui/lib/guide'

/**
 * A WireMock word explained where it first shows up on a page: a dotted underline and, on hover or focus, the
 * Glossary's definition (from docs/guide/glossary.md). `name` is the glossary term; the children are the text shown.
 */
export function Term({ name, children }: { name: string; children: ReactNode }) {
  const meaning = GLOSSARY.get(name.toLowerCase())
  if (!meaning) return <>{children}</>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-description={meaning}
          className="cursor-help underline decoration-muted-foreground/60 decoration-dotted underline-offset-[3px] outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 leading-relaxed">{meaning}</TooltipContent>
    </Tooltip>
  )
}

/** `text` with the last `word` in it explained by the glossary's `name` (the text reads the same). */
export function WithTerm({ text, word, name }: { text: string; word: string; name: string }) {
  const at = text.lastIndexOf(word)
  if (at === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, at)}
      <Term name={name}>{word}</Term>
      {text.slice(at + word.length)}
    </>
  )
}
