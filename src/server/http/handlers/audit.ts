import { ValidationError } from '../../errors'
import { listAuditView, parseAuditFilter } from '../../audit/view'
import { json, withAuth } from '../wrap'

export const listAudit = withAuth('audit.read', async ({ rt, request }) => {
  const q = new URL(request.url).searchParams
  const rawLimit = q.get('limit')
  let limit: number | undefined
  if (rawLimit !== null) {
    limit = Number(rawLimit)
    if (!/^\d+$/.test(rawLimit) || limit < 1 || limit > 500) throw new ValidationError('limit must be an integer between 1 and 500')
  }
  const cursor = q.get('cursor')
  if (cursor === '') throw new ValidationError('cursor is invalid')
  const filter = parseAuditFilter(q)
  return json(await listAuditView(rt, { limit, cursor: cursor ?? undefined, filter }))
})
