# Follow-ups

Open items from the Milestone 1 and 2A reviews. None blocks a release; pick them up when the area is next touched.

## From Milestone 1

### Hardening

- A delete that lands during a full sync's final count check causes one spurious resync (harmless).
- Sync lock TTL is 60 s with no renewal; revisit before stores get large.
- `lastError` is not set by failures in `check()` or `acquireLock`; a failed timer sync is logged twice; a safety-net tick can be skipped while a check runs; `stop()` does not wait for an in-flight tick.
- Dev server only: HMR can start a second reconciler; unauthenticated requests trigger boot.
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

- MULTI exec per-command errors are not checked in the Redis stores.
- Last-admin check-then-write race; `changeOwnPassword` is not rate-limited.
- Logout with an invalid cookie does not clear it.
- Catalog: regex endpoints are validated as JS regex but run as Java regex (documented in the README); non-atomic `upsertEndpoint`/`deleteIntegration` checks; no length caps on names/descriptions.
- Import: the request body is buffered before the 10 MB check for chunked bodies; duplicate ids in one bundle resolve last-wins silently; WireMock-rejected stubs fail after earlier writes (documented; re-import is idempotent).
- Request log: filtering happens after fetching `limit` events; `since` with an unencoded `+` offset is rejected.
- Near misses: Jayway-only JSONPath functions report false rather than "not checked"; `doesNotContain`/`doesNotMatch` on a missing value report false.
- Test gaps: Content-Length 413 branch, viewer-403 on catalog mock routes, status fallback in the request log, marker-by-id hiding.
- Recording (M4) must stamp `metadata.wiremockUi.version` on every recorded stub it stores.
- Equal-priority precedence: an admin restoring a deleted baseline mock adds it on top of person-owned mocks until the next import or reset-triggered sync; repositioning person mocks briefly removes each from WireMock and can resurrect one deleted in that instant (the safety-net sync removes it).
- Rate limit: more than 10 *concurrent* Basic/login attempts from one IP can get a transient `429` even when they would succeed (slots are taken before verifying).
