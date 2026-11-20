import { useState } from 'react'
import { AlertCircleIcon, KeyRoundIcon, MoreHorizontalIcon, Trash2Icon, TriangleAlertIcon, UserCheckIcon, UserXIcon } from 'lucide-react'
import { toast } from 'sonner'
import type { PublicUser } from '@/server/users/types'
import { useDeleteUser, useSession, useUpdateUser } from '@/ui/api/queries'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
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
import { Badge } from '@/ui/components/ui/badge'
import { Button } from '@/ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/ui/components/ui/dropdown-menu'
import { Skeleton } from '@/ui/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/components/ui/table'
import { useT } from '@/ui/i18n'
import { isValidDate } from '@/ui/lib/time'
import { cn } from '@/ui/lib/utils'
import { UserDialog } from './UserDialog'

const COLUMNS = [
  { key: 'users.colUsername', hide: false },
  { key: 'users.colName', hide: true },
  { key: 'users.colStatus', hide: false },
  { key: 'users.colCreated', hide: true },
] as const

function TableShell({ children }: { children: React.ReactNode }) {
  const t = useT()
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((col) => (
              <TableHead key={col.key} className={cn('text-[10px] tracking-[0.14em] text-muted-foreground uppercase', col.hide && 'hidden md:table-cell')}>
                {t(col.key)}
              </TableHead>
            ))}
            <TableHead className="w-10">
              <span className="sr-only">{t('users.colActions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        {children}
      </Table>
    </div>
  )
}

export function UsersTableSkeleton() {
  return (
    <TableShell>
      <TableBody>
        {Array.from({ length: 4 }, (_, i) => (
          <TableRow key={i}>
            {Array.from({ length: 5 }, (_, j) => (
              <TableCell key={j}>
                <Skeleton className="h-4 w-full max-w-32" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </TableShell>
  )
}

export function UsersTable({ users }: { users: PublicUser[] }) {
  const t = useT()
  const session = useSession()
  const me = session.data?.user.id
  return (
    <TableShell>
      <TableBody className="stagger-children">
        {users.map((user) => (
          <TableRow key={user.id} className="hover:bg-surface-2">
            <TableCell>
              <span dir="ltr" className="font-mono text-xs font-medium">
                {user.username}
              </span>
              {user.id === me && <span className="ms-2 text-[10px] text-muted-foreground">({t('users.you')})</span>}
              <p className="truncate text-[10px] text-muted-foreground md:hidden">{user.displayName}</p>
            </TableCell>
            <TableCell className="hidden text-xs md:table-cell">{user.displayName}</TableCell>
            <TableCell>
              {user.disabled ? (
                <Badge variant="outline" className="border-hazard/40 bg-hazard/10 text-hazard-fg">
                  {t('users.disabled')}
                </Badge>
              ) : (
                <Badge variant="outline" className="border-signal/40 bg-signal/10 text-signal-fg">
                  {t('users.active')}
                </Badge>
              )}
            </TableCell>
            <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
              {isValidDate(user.createdAt) ? <time dateTime={user.createdAt}>{new Date(user.createdAt).toLocaleDateString('en', { dateStyle: 'medium' })}</time> : '—'}
            </TableCell>
            <TableCell className="text-end">
              <UserRowActions user={user} self={user.id === me} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableShell>
  )
}

function UserRowActions({ user, self }: { user: PublicUser; self: boolean }) {
  const t = useT()
  const [resetting, setResetting] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const update = useUpdateUser()
  const remove = useDeleteUser()

  // Enabling is harmless and immediate; disabling signs the user out, so it is confirmed first.
  const enable = () =>
    update.mutate(
      { id: user.id, disabled: false },
      {
        onSuccess: () => toast.success(t('users.enabledToast', { name: user.username })),
        onError: (error) => toast.error(t('users.updateFailed'), { description: error.message || t('error.generic') }),
      },
    )

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('users.actionsFor', { name: user.username })}>
            <MoreHorizontalIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => setResetting(true)}>
            <KeyRoundIcon />
            {t('users.resetPassword')}
          </DropdownMenuItem>
          {user.disabled ? (
            <DropdownMenuItem onSelect={enable}>
              <UserCheckIcon />
              {t('users.enable')}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setDisabling(true)}>
              <UserXIcon />
              {t('users.disable')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2Icon />
            {t('users.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <UserDialog user={user} open={resetting} onOpenChange={setResetting} />
      <ConfirmUserDialog
        open={disabling}
        onOpenChange={setDisabling}
        title={t('users.disableTitle', { name: user.username })}
        body={t('users.disableBody')}
        warning={self ? t('users.disableSelfWarning') : undefined}
        failedTitle={t('users.updateFailed')}
        action={t('users.disable')}
        icon={<UserXIcon data-icon="inline-start" />}
        pending={update.isPending}
        run={async () => {
          await update.mutateAsync({ id: user.id, disabled: true })
          toast.success(t('users.disabledToast', { name: user.username }))
        }}
      />
      <ConfirmUserDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t('users.deleteTitle', { name: user.username })}
        body={t('users.deleteBody')}
        warning={self ? t('users.deleteSelfWarning') : undefined}
        failedTitle={t('users.deleteFailed')}
        action={t('users.delete')}
        icon={<Trash2Icon data-icon="inline-start" />}
        pending={remove.isPending}
        run={async () => {
          await remove.mutateAsync(user.id)
          toast.success(t('users.deleted', { name: user.username }))
        }}
      />
    </>
  )
}

/**
 * Confirms a disable or delete. A refusal (409 "At least one active user is required") stays in the dialog, verbatim.
 * `warning` is shown when the action targets the signed-in user.
 */
function ConfirmUserDialog({
  open,
  onOpenChange,
  title,
  body,
  warning,
  failedTitle,
  action,
  icon,
  pending,
  run,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  body: string
  warning?: string
  failedTitle: string
  action: string
  icon: React.ReactNode
  pending: boolean
  run: () => Promise<void>
}) {
  const t = useT()
  const [error, setError] = useState<string | null>(null)

  const confirm = async (event: React.MouseEvent) => {
    event.preventDefault() // closes only on success
    setError(null)
    try {
      await run()
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('error.generic'))
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setError(null)
      }}
    >
      <AlertDialogContent className="glass-panel">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{body}</AlertDialogDescription>
        </AlertDialogHeader>
        {warning && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>{t('users.selfWarningTitle')}</AlertTitle>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        )}
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
            {icon}
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
