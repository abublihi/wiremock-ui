import { useState } from 'react'
import { MoreHorizontalIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { StubMapping } from '@/server/wiremock/types'
import { useDeleteMock, useDuplicateMock, useMocks, useResetMine, restoreMock } from '@/ui/api/queries'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/components/ui/dropdown-menu'
import { useWireMockOnly } from '@/ui/config'
import { useT } from '@/ui/i18n'

export const mockName = (stub: StubMapping) => stub.name || stub.id
export const mockVersion = (stub: StubMapping) => stub.metadata?.wiremockUi?.version ?? 0

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export function NewMockButton() {
  const t = useT()
  return (
    <Button asChild>
      <Link to="/mocks/new">
        <PlusIcon data-icon="inline-start" />
        {t('mocks.new')}
      </Link>
    </Button>
  )
}

/** The per-row menu: open, duplicate, delete (with confirmation and an Undo toast). */
export function MockRowActions({ stub }: { stub: StubMapping }) {
  const t = useT()
  const [confirming, setConfirming] = useState(false)
  const duplicate = useDuplicateMock()
  const remove = useDeleteMock()
  const queryClient = useQueryClient()
  // No history in WireMock-only mode, so nothing to undo a delete from.
  const wiremockOnly = useWireMockOnly()
  const name = mockName(stub)

  const onDelete = () => {
    const version = mockVersion(stub)
    remove.mutate(
      { id: stub.id, version },
      {
        onSuccess: () =>
          toast(t('mocks.deleted'), wiremockOnly ? undefined : {
            action: {
              label: t('mocks.undo'),
              onClick: () =>
                restoreMock(queryClient, stub.id, version).then(
                  () => toast.success(t('mocks.restored')),
                  (error: unknown) => toast.error(errorMessage(error, t('error.generic'))),
                ),
            },
          }),
        onError: (error) => toast.error(errorMessage(error, t('error.generic'))),
      },
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('mocks.actionsFor', { name })}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link to="/mocks/$id" params={{ id: stub.id }}>
              {t('mocks.open')}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              duplicate.mutate(stub.id, {
                onSuccess: () => toast.success(t('mocks.duplicated')),
                onError: (error) => toast.error(errorMessage(error, t('error.generic'))),
              })
            }
          >
            {t('mocks.duplicate')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirming(true)}>
            <Trash2Icon />
            {t('mocks.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mocks.deleteTitle', { name })}</AlertDialogTitle>
            <AlertDialogDescription>{t('mocks.deleteBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>
              {t('mocks.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** "Reset my mocks": confirms with the live count of the user's own mocks, then deletes them all. */
export function ResetMineButton() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const mine = useMocks({ owner: 'me' }, { enabled: open })
  const reset = useResetMine()
  const count = mine.data?.length

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Trash2Icon data-icon="inline-start" />
        {t('mocks.resetMine')}
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="glass-panel">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mine.isError
                ? t('mocks.resetCountFailed')
                : count === undefined
                  ? t('mocks.resetCounting')
                  : t(count === 1 ? 'mocks.resetTitleOne' : 'mocks.resetTitle', { count })}
            </AlertDialogTitle>
            <AlertDialogDescription>{mine.isError ? mine.error.message : t('mocks.resetBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            {mine.isError && (
              <Button variant="outline" onClick={() => void mine.refetch()}>
                {t('mocks.retry')}
              </Button>
            )}
            <AlertDialogAction
              variant="destructive"
              disabled={count === undefined || count === 0}
              onClick={() =>
                reset.mutate(undefined, {
                  onSuccess: ({ deleted }) => toast.success(t(deleted === 1 ? 'mocks.resetDoneOne' : 'mocks.resetDone', { count: deleted })),
                  onError: (error) => toast.error(errorMessage(error, t('error.generic'))),
                })
              }
            >
              {t('mocks.resetMine')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
