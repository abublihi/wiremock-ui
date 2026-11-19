# wiremock-ui

A web UI and REST API for managing WireMock stubs. Redis is the source of truth: stubs are saved there first and synced into WireMock, so they survive a WireMock restart.

> **Test environment only. No real personal data.** Mocks, request payloads and stored values are not protected like production data. Never put real personal data in a stub.
>
> WireMock serves stubs and its admin API on the same port. The UI always starts WireMock with admin basic auth, but do not expose WireMock's port (8080) beyond the test network in a real deployment.

## Quick start

```sh
cp .env.example .env        # then replace the placeholder passwords and secret
docker compose up -d --build
```

The UI listens on http://localhost:3000 and WireMock on http://localhost:8080. Compose sets `WIREMOCK_URL` and `REDIS_URL` for the UI itself; everything else comes from `.env`.

## Authentication

Accounts live in Redis. On first start the UI creates one admin from `ADMIN_USER` / `ADMIN_PASSWORD` (only when there are no users yet; changing those variables later does not touch existing accounts).

| Role | Can |
| --- | --- |
| `viewer` | Read mocks, the catalog and the request log |
| `tester` | Also create mocks and edit or delete their own |
| `developer` | Also edit anyone's (non-baseline) mocks, write the catalog (integrations and endpoints) and clear the request log |
| `admin` | Also edit baseline mocks, delete catalog entries, manage users, read the audit log and run imports |

- **Browser sessions:** `POST /api/session` with `{ "username", "password" }` sets an HttpOnly `wmui_session` cookie and returns `{ user, csrfToken }`. Send the token as `X-CSRF-Token` on every `POST`, `PUT`, `PATCH` and `DELETE`. `DELETE /api/session` signs out. The cookie is `Secure` when `PUBLIC_UI_URL` is https, or when `TRUST_PROXY` is on and the proxy sends `X-Forwarded-Proto: https`.
- **Scripts:** HTTP Basic with a user account. No CSRF token is needed and no `WWW-Authenticate` challenge is sent, so browsers never pop a login dialog.
- **Rate limit:** browser sign-in and Basic auth share one limit of 10 failed attempts per 15 minutes per client IP; after that every attempt from that IP gets `429` (even with the right password) until the window ends. Successful sign-ins do not count.
- Admins manage accounts through `/api/users`; anyone can change their own password with `POST /api/session/password` (`{ current, next }`). An admin who resets their own password through `/api/users` stays signed in on that session; their other sessions end.
- **Audit log:** admins read it with `GET /api/audit?limit=100` (1–500, newest first). The response is `{ entries, nextCursor }`; pass `cursor=<nextCursor>` for the next page until it is `null`. Entries are kept 30 days.

Behind a reverse proxy, set `TRUST_PROXY=true` so the client IP (for rate limiting) is taken from `X-Forwarded-For`. The rightmost hop is used, because that is the one your proxy appended; do not enable it without a proxy, as clients could spoof the header. `PUBLIC_UI_URL` is the externally visible base URL of the UI (for example `https://wiremock-ui.example.com`); an https URL marks session cookies `Secure`.

Examples below use the bootstrap admin with basic auth:

```sh
# create
curl -u admin:change-me-admin -H 'Content-Type: application/json' \
  -X POST http://localhost:3000/api/mocks \
  -d '{"request":{"method":"GET","urlPath":"/hello"},"response":{"status":200,"body":"hi"}}'

# list
curl -u admin:change-me-admin http://localhost:3000/api/mocks

# delete (use the id and version from the create response)
curl -u admin:change-me-admin -X DELETE 'http://localhost:3000/api/mocks/<id>?version=1'

# the stub is served by WireMock
curl http://localhost:8080/hello
```

`GET /healthz` needs no auth.

## Checking that stubs survive a restart

```sh
bash scripts/e2e-restart.sh
```

It starts a throwaway stack (`WIREMOCK_PORT` and `UI_PORT` override the host ports), saves a stub, restarts WireMock, checks the stub comes back and the admin API still answers 401, then removes everything it created.

## Importing a bundle and seeding baseline mocks

A bundle is JSON in any of these shapes: `{ "integrations": [], "catalog": [], "mocks": [], "oidcIdentities": [] }` (every key optional), a WireMock export `{ "mappings": [...] }`, a single stub, or an array of stubs. Admins can `POST /api/import` (add `?prune=true` to delete baseline mocks that are not in the bundle; bodies over 10 MB get a 413).

Set `SEED_PATH` to a file or a folder to import at boot, as user `system`, before the reconciler starts. A folder is read recursively (every `*.json`, sorted by path, dotfiles ignored), so a WireMock `mappings/` folder works as is. `SEED_PRUNE=true` also prunes baseline mocks missing from the seed. Symlinked entries are followed, so a Kubernetes ConfigMap volume mounted as `SEED_PATH` works. A dangling symlink is skipped with a warning, and when anything was skipped the prune step is skipped too (`prune skipped: seed folder had unreadable entries`). A seed that fails validation stops the boot.

A small bundle:

```json
{
  "integrations": [{ "key": "pay", "name": "Payments", "prefix": "/pay" }],
  "mocks": [
    {
      "request": { "method": "GET", "urlPath": "/pay/status" },
      "response": { "status": 200, "body": "ok" }
    }
  ]
}
```

The first start-up sync and any sync caused by a missing marker (WireMock was reset) are recorded in the audit log as `sync` by `system`.

- Mocks without an `id` get a stable UUID derived from their content, so re-imports change nothing.
- The owner is `metadata.wiremockUi.owner`, else `baseline`. Mocks owned by a person are never touched by an import.
- A mock without `metadata.wiremockUi.integration` is assigned to the integration with the longest `prefix` that its URL starts with.
- `oidcIdentities` are counted and ignored for now.
- The whole bundle is validated before anything is written. A stub that WireMock itself rejects can still fail the import after earlier entries were written; fix it and import again (re-imports are idempotent: unchanged mocks, integrations and endpoints are not rewritten).
- Give seed mocks a fixed `id`, or set `SEED_PRUNE=true`: an id-less mock's id is derived from its content, so editing it in the seed adds a new mock and leaves the old version live. The boot log warns when a seed has id-less mocks and prune is off.
- When a person's mock and a baseline mock match the same request with the same priority, the person's mock wins, also after WireMock restarts and after re-imports.

## Catalog notes

- Endpoints with `pathType: regex` are matched by WireMock, so the pattern uses Java's regex dialect; the UI only checks that it parses as a JavaScript regex.
- An endpoint cannot be deleted while mocks built from it exist (`409`), and an integration cannot be deleted while it has mocks.

## Development

```sh
npm ci
npm run dev        # needs Redis and WireMock reachable per .env
npm test
npm run typecheck
npm run build && npm start
```

## Licence

MIT. See [LICENSE](LICENSE).
