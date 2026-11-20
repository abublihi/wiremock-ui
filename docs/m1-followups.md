# Follow-ups

Open items from the Milestone 1, 2A and 2B reviews. None blocks a release; pick them up when the area is next touched.

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
- Integrations (called Catalog at the time): regex endpoints are validated as JS regex but run as Java regex (documented in docs/USAGE.md); non-atomic `upsertEndpoint`/`deleteIntegration` checks; no length caps on names/descriptions.
- Import: the request body is buffered before the 10 MB check for chunked bodies; duplicate ids in one bundle resolve last-wins silently; WireMock-rejected stubs fail after earlier writes (documented; re-import is idempotent).
- Request log: filtering happens after fetching `limit` events; `since` with an unencoded `+` offset is rejected.
- Near misses: Jayway-only JSONPath functions report false rather than "not checked"; `doesNotContain`/`doesNotMatch` on a missing value report false.
- Test gaps: Content-Length 413 branch, status fallback in the request log, marker-by-id hiding.
- Recording (M4) must stamp `metadata.wiremockUi.version` on every recorded stub it stores.
- Equal-priority precedence: an admin restoring a deleted baseline mock adds it on top of person-owned mocks until the next import or reset-triggered sync; repositioning person mocks briefly removes each from WireMock and can resurrect one deleted in that instant (the safety-net sync removes it).
- Precedence repositioning (after imports/seeds) does not take the sync lock: a concurrent full sync can see a person mock mid-move and run one extra resync; a user edit landing between re-read and re-add can leave WireMock serving the older version until the 10-minute safety-net sync; an import that fails partway skips repositioning. Take the sync lock, re-check versions after re-adding, and reposition in a `finally`. Repositioning also moves every person mock, not only those that collide with a written baseline stub.
- Rate limit: an infrastructure error (Redis, bcrypt) during verification keeps the attempt counted.
- Rate limit: more than 10 *concurrent* Basic/login attempts from one IP can get a transient `429` even when they would succeed (slots are taken before verifying).

## From Milestone 2B (UI)

- Radix dialogs return focus only to their own `Trigger`; dialogs opened through state dropped focus on `<body>`. The `Dialog`, `AlertDialog` and `Sheet` wrappers now remember the opener (`src/ui/lib/return-focus.ts`). Any new overlay built on another Radix primitive, or on the bare primitives, needs the same.
- `GET /api/mocks?owner=all` is taken literally (an owner named "all"); the UI maps "All mocks" to no filter. Consider accepting `all` in the API.
- The bootstrap admin's `user.create` audit entry still records `role: "admin"` in its details, a leftover from before spec A8.
- The request drawer's accessible name is the request line (`POST /orders/…`), not "Request details"; fine, but tests must not look for the title.
- e2e: specs share one stack and run serially (`workers: 1`) on the fixed port 3417 (`E2E_UI_PORT`). They need Docker and a Chromium download (`npx playwright install chromium`). The axe pass runs with reduced motion, because entrance fades make the contrast check read blended colours; it fails only on serious or critical violations.
- Docs: the `SEED_PATH` Compose override is documented as a snippet, not shipped as a file. `.env.example` could not be read in this task, so its placeholders were not re-checked against docs/INSTALL.md.
