import { useState, type ReactNode } from 'react'
import { AlertCircleIcon, Trash2Icon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/ui/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { useT } from '@/ui/i18n'

/**
 * A delete button with a confirm dialog. A refusal (the server's 409 "still has mocks") stays in the dialog
 * with the server's own message, so the user reads exactly why; success closes it.
 */
export function DeleteConfirm({
  trigger,
  title,
  body,
  failedTitle,
  onConfirm,
}: {
  trigger: ReactNode
  title: string
  body: string
  /** Title of the refusal alert, naming what could not be deleted. */
  failedTitle: string
  onConfirm: () => Promise<void>
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async (event: React.MouseEvent) => {
    event.preventDefault() // the dialog closes itself only on success
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      setOpen(false)
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('error.generic'))
    } finally {
      setPending(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setError(null)
      }}
    >
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent className="glass-panel">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertCircleIcon />
            <AlertTitle>{failedTitle}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={(e) => void confirm(e)}>
            <Trash2Icon data-icon="inline-start" />
            {t('catalog.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
