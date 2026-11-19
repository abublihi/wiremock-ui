# Follow-ups

Open items from the Milestone 1 and 2A reviews. None blocks a release; pick them up when the area is next touched.

## From Milestone 1

### Hardening

- A delete that lands during a full sync's final count check causes one spurious resync (harmless).
- Sync lock TTL is 60 s with no renewal; revisit before stores get large.
- `lastError` is not set by failures in `check()` or `acquireLock`; a failed timer sync is logged twice; a safety-net tick can be skipped while a check runs; `stop()` does not wait for an in-flight tick.
- Dev server only: HMR can start a second reconciler; unauthenticated requests trigger boot.
- Auth is opted into per handler; a `withAuth` wrapper would make it the default.
- `UpstreamError` detail is returned to authenticated API clients.
- `node:22-alpine` is pinned by major only (spec Security 6 -> M5: pin minor/digest).
- Compose publishes ports on all interfaces; consider `127.0.0.1:` by default. The WireMock admin password is visible in `docker inspect` (inherent to the flag).
- e2e script: no `curl --max-time`; values in `.env` can override `WIREMOCK_PORT`/`UI_PORT`.

### Test gaps

- WireMock client: exact-1000 paging boundary; fake-fetch unit tests for 5xx/network mapping; 401/403 -> `ConfigError` on non-startup calls; 200 with a non-JSON body.
- Store: the EXEC-null path in isolation; integration change/removal; updatedAt sort tie-break.
- Mock service: rollback that itself fails; delete when the stub is already missing from WireMock.
- Reconciler: batch size <= 500 not asserted.
- HTTP: auth edge cases (no colon, bad base64, password containing `:`); Redis warn rate-limiting.
- Logger noise in test output.

## From Milestone 2A

- Audit paging: the `before` cursor is ms-exclusive; same-ms entries can be skipped across pages.
- MULTI exec per-command errors are not checked in the Redis stores.
- A rate-limit key without a TTL never expires (e.g. after a manual SET or restore).
- Last-admin check-then-write race; `changeOwnPassword` is not rate-limited.
- Logout with an invalid cookie does not clear it.
- Catalog: JS vs Java regex dialect for regex endpoints; non-atomic `upsertEndpoint`/`deleteIntegration` checks; no length caps on names/descriptions.
- Simple-mode builder: a fault mock still requires a status; an empty name or whitespace key is accepted.
- Import: the request body is buffered before the 10 MB check for chunked bodies; duplicate ids in one bundle resolve last-wins silently; WireMock-rejected stubs fail after earlier writes.
- Request log: filtering happens after fetching `limit` events; `since` with an unencoded `+` offset is rejected.
- Near misses: Jayway-only JSONPath functions report false rather than "not checked"; `doesNotContain`/`doesNotMatch` on a missing value report false.
- Test gaps: Content-Length 413 branch, viewer-403 on catalog mock routes, status fallback in the request log, marker-by-id hiding.
