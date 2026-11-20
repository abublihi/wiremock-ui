import { useRef, useState } from 'react'
import { FileUpIcon } from 'lucide-react'
import { Button } from '@/ui/components/ui/button'
import { useT } from '@/ui/i18n'
import { BodyFileError, readBodyFile, type BodyFile } from '@/ui/lib/body-file'

/**
 * "Upload body from file": a button with a hidden file input. Reads the file in the browser (5 MB at most) and
 * hands it over as text or base64; a problem goes to `onError` as a sentence.
 */
export function BodyFileButton({
  onFile,
  onError,
  label,
  disabled,
}: {
  onFile: (file: BodyFile) => void
  onError: (message: string | null) => void
  /** The visible text; the input is always named "Upload body from file". */
  label?: string
  disabled?: boolean
}) {
  const t = useT()
  const ref = useRef<HTMLInputElement>(null)
  const [reading, setReading] = useState(false)
  const pick = async (file: File | undefined) => {
    if (ref.current) ref.current.value = ''
    if (!file) return
    onError(null)
    setReading(true)
    try {
      onFile(await readBodyFile(file))
    } catch (error) {
      onError(error instanceof BodyFileError ? t(error.key, error.params) : t('editor.bodyFile.readFailed', { name: file.name }))
    } finally {
      setReading(false)
    }
  }
  return (
    <>
      <input
        ref={ref}
        type="file"
        className="sr-only"
        tabIndex={-1}
        aria-label={t('editor.bodyFile.upload')}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <Button type="button" variant="outline" size="xs" disabled={disabled || reading} title={t('editor.bodyFile.hint')} onClick={() => ref.current?.click()}>
        <FileUpIcon data-icon="inline-start" />
        {label ?? t('editor.bodyFile.upload')}
      </Button>
    </>
  )
}
