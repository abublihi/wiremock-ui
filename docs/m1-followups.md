# Milestone 1 — follow-ups

Open items from the M1 reviews. None blocks M1; pick them up in M2 planning.

## Must handle in M2

- **Stamp `metadata.wiremockUi.version` on every stub that enters the store** (seed, import, plain WireMock mappings, recording). A stored stub with no version can never be updated: every edit returns 409.
- **Remove the interim basic auth on `/api/*`** (Amendment A3) once sessions and CSRF tokens land. Until then, writes need `Content-Type: application/json` (stops cross-site form posts).

## Hardening

- Boot deadline is not enforced inside one hung attempt: the unauthenticated probe in `assertWireMockReady` has no timeout, and the ioredis boot `ping()` waits out its own retries.
- A response-body read aborted by the client timeout throws a raw `TimeoutError` instead of `UpstreamError`.
- `/healthz` WireMock ping is bounded by the 5 s client timeout, but the image HEALTHCHECK times out at 3 s; bound it to ~2 s like the store ping.
- A delete that lands during a full sync's final count check causes one spurious resync (harmless).
- Sync lock TTL is 60 s with no renewal; revisit before stores get large.
- `lastError` is not set by failures in `check()` or `acquireLock`; a failed timer sync is logged twice; a safety-net tick can be skipped while a check runs; `stop()` does not wait for an in-flight tick.
- Dev server only: HMR can start a second reconciler; unauthenticated requests trigger boot.
- Auth is opted into per handler; a `withAuth` wrapper would make it the default.
- `UpstreamError` detail is returned to authenticated API clients.
- `node:22-alpine` is pinned by major only (spec Security §6 → M5: pin minor/digest).
- Compose publishes ports on all interfaces; consider `127.0.0.1:` by default. The WireMock admin password is visible in `docker inspect` (inherent to the flag).
- e2e script: no `curl --max-time`; values in `.env` can override `WIREMOCK_PORT`/`UI_PORT`.

## Test gaps

- WireMock client: exact-1000 paging boundary; fake-fetch unit tests for 5xx/network mapping; 401/403 → `ConfigError` on non-startup calls; 200 with a non-JSON body.
- Store: the EXEC-null path in isolation; integration change/removal; updatedAt sort tie-break.
- Mock service: rollback that itself fails; delete when the stub is already missing from WireMock.
- Reconciler: batch size ≤ 500 not asserted.
- HTTP: auth edge cases (no colon, bad base64, password containing `:`); Redis warn rate-limiting.
- Logger noise in test output.
