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

Accounts live in Redis. On first start the UI creates one admin from `ADMIN_USER` / `ADMIN_PASSWORD` (only when there are no users yet; changing those variables later does not touch existing accounts). Roles: `viewer` (read), `tester` (create and edit own mocks), `developer` (edit anyone's mocks), `admin` (also baseline mocks and user management).

- **Browser:** `POST /api/session` with `{ "username", "password" }` sets an HttpOnly `wmui_session` cookie and returns `{ user, csrfToken }`. Send the token as `X-CSRF-Token` on every `POST`, `PUT`, `PATCH` and `DELETE`. `DELETE /api/session` signs out.
- **Scripts:** HTTP Basic with a user account (no CSRF token needed). Failed attempts are rate-limited per IP.
- Admins manage accounts through `/api/users`; anyone can change their own password with `POST /api/session/password` (`{ current, next }`).

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
