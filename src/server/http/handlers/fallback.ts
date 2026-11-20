import { json } from '../wrap'

// Without these, a request the API has no handler for falls through to the page router, which answers a JSON
// client with "Only HTML requests are supported here" (406). Every /api URL answers JSON instead.

const pathOf = (request: Request) => new URL(request.url).pathname

/** A URL ending in `/` (or with an empty part) usually lost an ID: `PUT /api/integrations/` with an empty key. */
const missingPart = (path: string) => (path.endsWith('/') || path.includes('//') ? ' Part of the URL is empty: an ID may be missing.' : '')

/** Any method an /api route has no handler for → 405 JSON { error }. */
export function methodNotAllowed(request: Request): Response {
  const path = pathOf(request)
  return json({ error: `${request.method.toUpperCase()} ${path} is not supported.${missingPart(path)}` }, 405)
}

/** Any /api URL no route matches → 404 JSON { error }. */
export function apiNotFound(request: Request): Response {
  const path = pathOf(request)
  return json({ error: `No API route at ${path}.${missingPart(path)}` }, 404)
}
