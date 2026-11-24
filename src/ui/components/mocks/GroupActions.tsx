import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import type { StubMapping } from '@/server/wiremock/types'
import { useDeleteMockGroup } from '@/ui/api/queries'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/components/ui/alert-dialog'
import { Button } from '@/ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu'
import { useT } from '@/ui/i18n'

/** The row menu of a mock with several responses: Open, and Delete (every response, after a confirmation). */
export function GroupRowActions({ id, first, name }: { id: string; first: StubMapping; name: string }) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteMockGroup()
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('mocks.actionsFor', { name })}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link to="/mocks/$id" params={{ id: first.id }}>
              <PencilIcon />
              {t('mocks.open')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash2Icon />
            {t('mocks.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('groups.deleteTitle', { name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('groups.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                remove.mutate(id, {
                  onSuccess: () => toast.success(t('mocks.deleted')),
                  onError: (error) => toast.error(error.message || t('error.generic')),
                })
              }
            >
              {t('mocks.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
