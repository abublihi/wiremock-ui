import { useState } from 'react'
import { AlertCircleIcon, KeyRoundIcon, MoreHorizontalIcon, Trash2Icon, UserCheckIcon, UserXIcon } from 'lucide-react'
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
              <UserRowActions user={user} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableShell>
  )
}

function UserRowActions({ user }: { user: PublicUser }) {
  const t = useT()
  const [resetting, setResetting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const update = useUpdateUser()

  const toggle = () =>
    update.mutate(
      { id: user.id, disabled: !user.disabled },
      {
        onSuccess: () => toast.success(t(user.disabled ? 'users.enabledToast' : 'users.disabledToast', { name: user.username })),
        // The server's own words, e.g. "At least one active user is required".
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
          <DropdownMenuItem onSelect={toggle}>
            {user.disabled ? <UserCheckIcon /> : <UserXIcon />}
            {t(user.disabled ? 'users.enable' : 'users.disable')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2Icon />
            {t('users.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <UserDialog user={user} open={resetting} onOpenChange={setResetting} />
      <DeleteUserDialog user={user} open={deleting} onOpenChange={setDeleting} />
    </>
  )
}

/** Confirms a delete; a refusal (409 "At least one active user is required") stays in the dialog, verbatim. */
function DeleteUserDialog({ user, open, onOpenChange }: { user: PublicUser; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const remove = useDeleteUser()
  const [error, setError] = useState<string | null>(null)

  const confirm = async (event: React.MouseEvent) => {
    event.preventDefault() // closes only on success
    setError(null)
    try {
      await remove.mutateAsync(user.id)
      toast.success(t('users.deleted', { name: user.username }))
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
          <AlertDialogTitle>{t('users.deleteTitle', { name: user.username })}</AlertDialogTitle>
          <AlertDialogDescription>{t('users.deleteBody')}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertCircleIcon />
            <AlertTitle>{t('users.deleteFailed')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={remove.isPending} onClick={(e) => void confirm(e)}>
            <Trash2Icon data-icon="inline-start" />
            {t('users.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
