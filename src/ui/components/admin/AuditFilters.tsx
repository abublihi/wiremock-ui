import { useId } from 'react'
import { XIcon } from 'lucide-react'
import type { AuditFilter } from '@/server/audit/view'
import { useUsers } from '@/ui/api/queries'
import { Button } from '@/ui/components/ui/button'
import { Input } from '@/ui/components/ui/input'
import { Label } from '@/ui/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/ui/components/ui/select'
import { useT } from '@/ui/i18n'

const ANY = '__any__'
const SYSTEM = 'system'
export const AUDIT_ACTION_GROUPS = ['mock', 'catalog', 'recording', 'scenario', 'user', 'import', 'requests'] as const

/** Who, what and which days: the audit page's filters (kept in the URL). */
export function AuditFilters({ filter, onChange }: { filter: AuditFilter; onChange: (next: AuditFilter) => void }) {
  const t = useT()
  const ids = useId()
  const users = useUsers()
  const names = [...new Set([...(users.data ?? []).map((u) => u.username), ...(filter.actor && filter.actor !== SYSTEM ? [filter.actor] : [])])].sort()
  const set = (patch: AuditFilter) => onChange({ ...filter, ...patch })
  const any = Object.values(filter).some((v) => v !== undefined)
  return (
    <div role="group" aria-label={t('audit.filters')} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-actor`} className="text-xs text-muted-foreground">
          {t('audit.filter.actor')}
        </Label>
        <Select value={filter.actor ?? ANY} onValueChange={(v) => set({ actor: v === ANY ? undefined : v })}>
          <SelectTrigger id={`${ids}-actor`} className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t('audit.filter.anyone')}</SelectItem>
            {names.map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
            <SelectItem value={SYSTEM}>{t('audit.filter.system')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${ids}-action`} className="text-xs text-muted-foreground">
          {t('audit.filter.action')}
        </Label>
        <Select value={filter.action ?? ANY} onValueChange={(v) => set({ action: v === ANY ? undefined : v })}>
          <SelectTrigger id={`${ids}-action`} className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>{t('audit.filter.anything')}</SelectItem>
            {AUDIT_ACTION_GROUPS.map((g) => (
              <SelectItem key={g} value={g}>
                {t(`audit.filter.action.${g}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {(['from', 'to'] as const).map((name) => (
        <div key={name} className="flex flex-col gap-1">
          <Label htmlFor={`${ids}-${name}`} className="text-xs text-muted-foreground">
            {t(`audit.filter.${name}`)}
          </Label>
          <Input
            id={`${ids}-${name}`}
            type="date"
            className="w-40"
            aria-describedby={`${ids}-dates`}
            value={filter[name] ?? ''}
            min={name === 'to' ? filter.from : undefined}
            max={name === 'from' ? filter.to : undefined}
            onChange={(e) => set({ [name]: e.target.value || undefined })}
          />
        </div>
      ))}
      {any && (
        <Button variant="ghost" size="sm" onClick={() => onChange({})}>
          <XIcon data-icon="inline-start" />
          {t('audit.filter.clear')}
        </Button>
      )}
      <p id={`${ids}-dates`} className="sr-only">
        {t('audit.filter.datesHint')}
      </p>
    </div>
  )
}
