import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertCircleIcon, PlusIcon, UsersIcon } from 'lucide-react'
import { useUsers } from '@/ui/api/queries'
import { UserDialog } from '@/ui/components/admin/UserDialog'
import { UsersTable, UsersTableSkeleton } from '@/ui/components/admin/UsersTable'
import { Alert, AlertDescription, AlertTitle } from '@/ui/components/ui/alert'
import { Button } from '@/ui/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/ui/components/ui/empty'
import { useT } from '@/ui/i18n'

export const Route = createFileRoute('/_app/users')({ component: UsersPage })

export function UsersPage() {
  const t = useT()
  const users = useUsers()
  const [adding, setAdding] = useState(false)
  const count = users.data?.length ?? 0
  const add = (
    <Button onClick={() => setAdding(true)}>
      <PlusIcon data-icon="inline-start" />
      {t('users.add')}
    </Button>
  )
  return (
    <div className="fade-up flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="glow-text font-display text-4xl font-bold tracking-tight uppercase">{t('users.title')}</h1>
          <p className="text-xs text-muted-foreground">{users.data ? t(count === 1 ? 'users.captionOne' : 'users.caption', { count }) : '//'}</p>
        </div>
        {add}
      </header>

      {users.isPending ? (
        <UsersTableSkeleton />
      ) : users.isError ? (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertTitle>{t('users.loadFailed')}</AlertTitle>
          <AlertDescription>
            <p>{users.error.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void users.refetch()}>
              {t('users.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : count === 0 ? (
        <Empty className="rounded-md border border-dashed border-line">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>{t('users.emptyTitle')}</EmptyTitle>
            <EmptyDescription>{t('users.emptyBody')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{add}</EmptyContent>
        </Empty>
      ) : (
        <UsersTable users={users.data} />
      )}

      <UserDialog open={adding} onOpenChange={setAdding} />
    </div>
  )
}
