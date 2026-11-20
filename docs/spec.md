# wiremock-ui — Product & Technical Spec

Nov 19, 2026 · Abdulsalam

> Amendments made while planning Milestone 1 are listed at the end ("Amendments"). Where they conflict with the body, the amendment wins.

## Summary

wiremock-ui is a self-hosted web app that lets QA and developers create, edit and inspect WireMock mocks without writing stub JSON. It ships on Docker Hub as a UI-only image and as an all-in-one image with WireMock inside.

**Problem.** Open-source WireMock has a strong engine but no friendly UI, no users, and keeps stubs in memory. QA cannot edit stub JSON, and a restart loses every mock added at runtime.

## Goals

- Cover every open-source WireMock 3 feature through forms, with a raw JSON editor as the fallback.
- QA can add or edit a mock in under a minute from a catalog of known endpoints.
- Mocks survive WireMock restarts: the UI's store (Redis) is the source of truth.
- Show why a request did not match (near misses) next to the request log.
- Ship a built-in OIDC login template, including the browser redirect, for SSO flows such as Qiwa.
- One `docker run` for a quick start; a two-container layout for Kubernetes.

## Non-goals (v1)

- Multi-tenancy across many WireMock instances (one UI = one WireMock in v1).
- gRPC and GraphQL mocking extensions.
- Replacing Saloon/unit-test fakes: this is for shared dev and QA environments, not in-process tests.
- Product-specific catalogs inside the public image: those are loaded at deploy time.

## Users and UX principles

The UI is built QA-first: every common task is a form, and full WireMock power sits one click away for developers.

| User | Main jobs | What they must never need |
|---|---|---|
| QA tester | Add a mock for a test person, switch it to an error, check why a call did not match, sign in as any SSO user | Stub JSON, regex, JSONPath |
| Developer | Define the endpoint catalog, write advanced stubs, import baselines, debug matching | Restarting containers to change mocks |
| Admin | Manage users and roles, configure WireMock connection, export backups | Shell access to the server |

Principles:

1. **Catalog first.** QA start from a named endpoint ("NIC → Fetch citizen"), never from a blank stub.
2. **Two modes on every screen.** Simple shows forms with plain labels; Advanced shows every WireMock option and the raw stub JSON, kept in sync both ways.
3. **Explain, don't fail silently.** Every unmatched request links to its closest stubs and the exact field that differed.
4. **Safe by default.** Validate before save, confirm before delete, keep a version history per mock, and allow undo.
5. **Fast to scan.** Lists filter by integration, owner, status code and text; the request log updates live.
6. ~~**Bilingual-ready.** English and Arabic UI strings with RTL support from day one.~~ Dropped: English only (Amendment A7).

## Architecture

Three parts: the UI (frontend and backend), a store, and a stock WireMock 3. Only the UI backend changes WireMock, through its admin API. Clients call WireMock directly for stubs; browsers reach WireMock only for the OIDC login pages. Everything else goes through the UI.

| Part | Responsibility |
|---|---|
| Frontend | Forms, editors, live request log, scenario view; talks only to the backend |
| Backend | Auth and roles, store access, stub building and validation, sync and reconcile, import and export |
| Store | Mocks, catalog, users, history, audit log |
| WireMock | Matching, templating, responses, request journal, scenarios, recording |

## Storage and sync

The store holds the real copy of every mock; WireMock holds a working copy the UI can rebuild at any time. WireMock never writes its own files (`persistent: false` on every stub).

**Store drivers.** One interface, two drivers: Redis (default for production, AOF persistence required) and SQLite on a volume (default for the all-in-one image). Selected by `STORE_DRIVER`.

### Data model (Redis)

| Key | Holds |
|---|---|
| `stub:{id}` | The full WireMock stub JSON exactly as WireMock accepts it, our fields in its metadata |
| `stub:{id}:history` | Last 20 versions of the stub, for diff and undo |
| `stubs:all`, `stubs:by-integration:{key}`, `stubs:by-owner:{user}` | Index sets for listing and filters |
| `integration:{key}`, `catalog:{integration}:{endpoint}` | Integrations and endpoint catalog entries |
| `user:{id}`, `session:{id}` | UI users and sessions |
| `sync:lock` | Lock held during a full sync |

Stub metadata carries `wiremockUi: {integration, endpoint, owner, version, updatedAt, updatedBy, source}`. Response bodies are always inline (`jsonBody` or `body`), never `__files`, so the store holds everything.

### Save (create or edit)

1. The backend builds the stub JSON; a new mock gets a UUID, an edit keeps its id and bumps version.
2. Optimistic lock: the save carries the version it started from; a newer version in the store rejects it with "changed by someone else" (Redis WATCH/MULTI).
3. Push to WireMock first with `POST /__admin/mappings/import`, this one stub, duplicate policy `OVERWRITE`. WireMock validates it, so an invalid stub is never stored.
4. Write to the store and indexes; append the old version to history.
5. If the store write fails, delete the stub from WireMock again and show the error. *(See Amendment A2.)*

**Delete.** `DELETE /__admin/mappings/{id}` (a 404 counts as done), then remove from store and indexes; history is kept 7 days for undo.

**Read.** Lists, filters and the editor read the store only. WireMock is read only for live data: the request log, near misses and scenario state.

### Reconcile after a WireMock restart

1. The UI keeps a hidden marker stub with a fixed id, matching `/__wiremock-ui/marker`.
2. Every 5 seconds it calls `GET /__admin/mappings/{markerId}`.
3. Marker missing → take `sync:lock`, then full sync: `POST /__admin/mappings/import` with all stubs in batches of 500, duplicate policy `OVERWRITE` and `deleteAllNotInImport: true`, so WireMock ends equal to the store. *(See Amendment A1.)*
4. Recreate the marker last, so a sync that breaks halfway retries on the next check.
5. A full sync also runs at UI startup and every 10 minutes as a safety net.
6. Before that first full sync, a store with no mocks at all **adopts** the stubs WireMock already serves (all but the marker), so pointing the UI at a WireMock that has stubs keeps them instead of deleting them. The decision is made at startup, before the seed writes anything, and recorded in the store as an `adoption-pending` flag. Adoption then runs under `sync:lock` (an instance that finds the lock held skips it; the holder adopts) and stores every WireMock stub missing from the store, keeping its id: source `adopt`, the owner its `wiremockUi` metadata names or else `wiremock`, and an integration from its metadata or guessed from the catalog prefixes. Adopted stubs are written to the store only; they are already in WireMock, so their `persistent` setting there is untouched. The flag is cleared once adoption completes. While it is set, a later start adopts whatever is still missing (so a start that stops part-way loses nothing), and a full sync deletes no live stub. The log says `adopted N existing WireMock stubs` and the audit log records `adopt`. Once adoption is done the store is the source of truth again, and nothing is adopted later.

**What is not stored.** The request log and scenario state stay in WireMock memory. The log is capped with `--max-request-journal-entries` (default 5000).

## Core concepts

| Concept | What it is | Example | Maps to WireMock |
|---|---|---|---|
| Integration | One external system, with a URL path prefix | NIC, prefix `/nic` | A urlPath prefix on every stub |
| Endpoint (catalog entry) | Method, path, where the key lives, example request and response, allowed statuses | `POST /nic-service/get-citizen-info`, key at `$.idNo` | A stub template the form fills in |
| Mock | One answer: key value, status, headers, body, delay, fault | idNo = 1012345678 → 200 with a citizen | One stub mapping |
| Default mock | The answer when no key matches | 404 `{}` | Low-priority stub with no key matcher |
| Owner | Who created the mock, or baseline | sara, baseline | `metadata.wiremockUi.owner` |

Endpoint catalog fields:

- method, path (exact, template such as `/members/{id}`, or regex)
- key: where the lookup value lives — body JSONPath, body XPath, query parameter, path segment or header
- exampleRequest, exampleResponse per status (200, 404, 500 …), shown as starting points
- contentType (JSON, XML, text, HTML)
- description and links, shown to QA in the form

**Priority rule.** Key-matched mocks get priority 5, defaults priority 10, so a specific mock always beats the default. Advanced users can set any priority.

## Mock editor: request matching

The editor exposes every WireMock 3 request matcher; Simple mode shows only the catalog key, Advanced mode shows them all.

| Part of the request | Matchers offered | Simple mode |
|---|---|---|
| Method | Any method, or ANY | Fixed by the catalog |
| URL | url, urlPath, urlPattern, urlPathPattern, urlPathTemplate with path parameters | Fixed by the catalog |
| Path parameters | Each operator below, per `{param}` | Shown when the key is a path segment |
| Query parameters | Each operator below, per parameter; multi-value hasExactly / including | Shown when the key is a query value |
| Headers and cookies | Each operator below, absent | Hidden |
| Body | equalToJson (ignore array order, ignore extra elements), matchesJsonPath with a sub-matcher, matchesJsonSchema, equalToXml, matchesXPath with namespaces, binaryEqualTo, multipart parts | One field: the key value |
| Form fields | Each operator below, per field | Shown when the key is a form field |
| Basic auth | Username and password | Hidden |
| Host, port, scheme, client IP | Equality or pattern | Hidden |
| Logical | and, or, not over any matchers | Hidden |
| Custom matcher | Named extension and parameters | Hidden |

String operators for any field: equal to (with case-insensitive option), contains, does not contain, matches regex, does not match, before / after / equal to date-time (with offset), absent.

Helpers:

- A "match on" picker generated from the example request: click a field in the JSON or XML tree to match on it.
- Live test panel: paste or pick a request from the log and see match or mismatch per field before saving.
- Regex and JSONPath fields validate as you type and show a sample result.
- Priority, name and notes are always visible; duplicate and "copy as curl" are one click.

## Mock editor: responses

| Area | Options | Simple mode |
|---|---|---|
| Status | Any code and reason phrase | Presets: Success, Not found, Validation error, Server error, Timeout |
| Headers | Any header; content type picker (JSON, XML, text, HTML) | Content type only |
| Body | JSON editor, XML editor, text, base64 binary; always stored inline | Editor prefilled from the catalog example |
| Templating | Handlebars on or off per stub; helpers: request.*, jsonPath, xPath, parseJson, now with offsets and formats, randomValue, urlEncode, base64, math, assign, conditionals and loops | Insert-a-value menu: echo a request field, today + N days, random id |
| Delays | Fixed delay, uniform or log-normal random delay, chunked dribble delay | "Slow response" toggle with seconds |
| Faults | Empty response, malformed chunk, random data then close, connection reset | "Break the connection" dropdown |
| Proxy | Proxy to a real base URL, add or remove headers, strip path prefix | Hidden |
| Redirects | 3xx with a templated Location header | Used by the OIDC template |
| Extensions | Named response transformers and their parameters | Hidden |

**Preview.** A "Render" button runs the response template against a sample request (from the catalog or the log) through WireMock itself, so what QA see is what any client will get.

**Response files.** `bodyFileName` is not offered; uploads are stored inline so the store stays the single source.

## Scenarios, recording, request log and webhooks

### Request log (live)

- Live table of requests from `/__admin/requests`: time, method, URL, status, matched mock (link) or "no match", duration.
- Filters: integration, matched / unmatched, status, text in URL or body, time range.
- Detail drawer: full request and response, headers, timing, and "Create mock from this request" prefilled from it.
- Unmatched requests show near misses (`/__admin/requests/unmatched/near-misses`): the closest 3 stubs, with each differing field highlighted in red.
- Clear log, export as JSON or HAR. Polling every 2 seconds, paused when the tab is hidden.

**Verification.** A "Count requests" tool runs `/__admin/requests/count` with any matcher, so QA can confirm a call was made N times.

### Scenarios (stateful mocks)

- Visual state machine per scenario: states as boxes, mocks as arrows with `requiredScenarioState` and `newScenarioState`.
- Current state shown live; buttons to set a state or reset one or all scenarios.
- Example use: first call returns "pending", second returns "approved".

### Recording and snapshots

- Start and stop recording against a real target URL (`/__admin/recordings/start`, `stop`), with filters, header capture and "extract bodies inline".
- Snapshot from the existing log (`/__admin/recordings/snapshot`).
- Recorded stubs land in a review list first; nothing reaches the store until a user accepts them.
- Recording is admin-only and off on environments marked `RECORDING_ALLOWED=false`.

### Webhooks and callbacks

- Form for WireMock's webhook post-serve action: method, URL, headers, templated body, fixed or random delay.
- Example use: after a payment mock responds, call the app's callback URL 2 seconds later.

**Global settings.** Fixed delay for all responses and the request-journal cap, edited from Settings via `/__admin/settings`.

## OIDC login template

Creating an integration from the "OIDC login" template generates the stubs for a full sign-in round trip, browser redirect included, using only built-in WireMock features.

Template settings: issuer, client id, path names for authorize, token and logout (defaults `/authorize`, `/token`, `/logout`; Qiwa uses `/authorized`, `/token`, `/oidc-logout-api`), claim names for the user id, name, email and phone, token lifetime, and login mode.

Flow:

1. The app sends the browser to `{issuer}/authorize?redirect_uri=…&state=…&nonce=…`.
2. WireMock answers by login mode:
   - Login page: an HTML form (templated) with hidden redirect_uri, state, nonce and fields for the claims; it submits with GET to `/authorize/submit`.
   - Instant: a 302 straight back as a fixed default user.
3. The submit stub returns 302 to `{redirect_uri}?state={state}&code={code}`. The code is base64 JSON of the nonce and claims, so no server state is needed.
4. The app's server calls `POST {token}`; the stub decodes the code and returns id_token, access_token, token_type, expires_in. `exp` uses `now` with format unix.
5. Logout returns 200, or a 302 to `post_logout_redirect_uri` when given.

| Token signing mode | How | Fits |
|---|---|---|
| Unsigned (default) | `alg: none` token built with built-in base64 helpers | Clients that only decode the token |
| Signed | wiremock-jwt-extension (bundled in the all-in-one image) plus a `/.well-known/jwks.json` stub | Clients that verify signatures |

**Saved test people.** The UI keeps a list of test identities per OIDC integration. The UI hosts a nicer login page listing them; picking one sends the browser to the submit stub with those claims.

**Safety.** Codes can be forged by design; the template shows a banner "test-only, never point a real environment here", and discovery (`/.well-known/openid-configuration`) is generated so standard clients find every endpoint.

## Users, roles and ownership

The UI is the only gatekeeper: WireMock's admin API is behind basic auth that only the UI backend knows.

**Sign-in.** Local accounts (bcrypt passwords) by default; optional OIDC sign-in to the UI itself (`AUTH_OIDC_*`). First admin comes from `ADMIN_USER` / `ADMIN_PASSWORD` on first start. Sessions are stored in the store, 12-hour lifetime.

| Role | Mocks | Catalog and integrations | Request log | Settings, users, recording |
|---|---|---|---|---|
| Viewer | Read | Read | Read | No |
| Tester | Create; edit and delete own | Read | Read, clear own filter view | No |
| Developer | Create, edit and delete any | Create and edit | Read and clear | Recording |
| Admin | All | All | All | All |

Ownership:

- Every mock records owner, updatedBy and updatedAt in its metadata.
- The mock list defaults to "My mocks"; one toggle shows all.
- `baseline` mocks are read-only for testers and developers; only admins and the import endpoint change them. A tester can duplicate a baseline mock into their own.
- "Reset my mocks" deletes all mocks a user owns, after confirmation.

**Audit log.** Every create, edit, delete, import, sync and setting change is written with user, time and stub id; kept 30 days, viewable by admins.

## Import, export and baseline seeding

Product-specific content (catalog and baseline mocks) lives in the product's private repo and is loaded at deploy time; the public image ships none of it.

**Bundle format.** One JSON (or a folder of JSON files) with `integrations`, `catalog`, `mocks` (plain WireMock stub JSON) and `oidcIdentities`. Plain WireMock `mappings/` files are also accepted.

| Source | How | Result |
|---|---|---|
| Bundle file or folder | UI upload, `POST /api/import`, or `SEED_PATH` at startup | Upsert by id; mocks marked `owner: baseline` unless they carry an owner |
| WireMock mappings | Same, detected by shape | Stubs imported, integration guessed from path prefix |
| Postman v2 collection | UI upload with preview | Catalog entries plus one mock per saved example |
| OpenAPI 3 | UI upload with preview | Catalog entries plus example-based mocks |
| Recording | See recording above | Stubs in the review list |

**Seeding rule.** `SEED_PATH` runs on every start: baseline mocks with fixed ids are created or updated; mocks owned by people are never touched. `SEED_PRUNE=true` also deletes baseline mocks missing from the bundle.

**Exports.** Whole store, one integration, or "my mocks", as a bundle or as WireMock `mappings/` files ready to commit. A nightly export to a volume path (`BACKUP_PATH`) keeps 14 days.

## Configuration, images and deployment

Two images are published to Docker Hub for amd64 and arm64 on every tag, built by GitHub Actions with buildx.

| Image | Contains | Use it for |
|---|---|---|
| `wiremock-ui` | UI frontend and backend only | Kubernetes, or any setup that already runs WireMock |
| `wiremock-ui-allinone` | UI plus WireMock 3 (pinned) plus the JWT extension, run by s6-overlay | Quick start: one `docker run` with a volume |

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `WIREMOCK_URL` | `http://localhost:8080` | WireMock base URL the UI talks to |
| `WIREMOCK_ADMIN_USER`, `WIREMOCK_ADMIN_PASSWORD` | Generated in all-in-one | WireMock admin basic auth |
| `STORE_DRIVER` | `redis` (`sqlite` in all-in-one) | Store driver: `redis`, `sqlite`, or `none` for WireMock-only mode (A10) |
| `REDIS_URL` | none | Redis connection |
| `SQLITE_PATH` | `/data/wiremock-ui.db` | SQLite file |
| `ADMIN_USER`, `ADMIN_PASSWORD` | none, required | First admin account |
| `SESSION_SECRET` | none, required | Session signing |
| `SEED_PATH`, `SEED_PRUNE` | unset, `false` | Baseline import at startup |
| `RECORDING_ALLOWED` | `true` | Turn recording off per environment |
| `SYNC_INTERVAL_SECONDS` | `5` | Marker check interval |
| `BACKUP_PATH` | unset | Nightly export target |
| `PUBLIC_UI_URL` | none | Links and the OIDC login page |

### Layouts

- Quick start: `docker run -p 8080:8080 -p 3000:3000 -v data:/data wiremock-ui-allinone`.
- Compose: `wiremock/wiremock` + `wiremock-ui` + `redis` with AOF, sample file in the repo.
- Kubernetes: one pod with two containers (WireMock and UI), Redis as its own service. Expose the UI and, if needed, the OIDC paths through ingress; keep WireMock's port cluster-internal.

**Health.** `GET /healthz` reports UI, store and WireMock reachability and the last sync time; the all-in-one health check covers both processes. Logs go to stdout as JSON.

**Compatibility.** WireMock 3.x is required; the UI checks the version at startup and refuses older versions with a clear message.

## Security

The main risk is anyone changing mocks around the UI; WireMock serves stubs and `/__admin` on the same port, so network rules alone cannot hide the admin API.

1. **Admin API locked.** WireMock always starts with `--admin-api-basic-auth`; the all-in-one image generates a random password at start and passes it only to the UI process. The UI refuses to start if the admin API answers without auth.
2. **Browser never talks to WireMock admin.** All admin calls go through the UI backend; no CORS opening on `/__admin`.
3. **UI auth.** bcrypt passwords, HTTP-only secure cookies, CSRF tokens on writes, login rate limit (10 tries per 15 minutes per IP).
4. **Test-only banner.** The UI and every OIDC login page show "Test environment" so nobody mistakes a mock for production.
5. **No production data.** Docs and the seed format warn against real personal data; the request log is capped and never written to the store.
6. **Supply chain.** Pinned base images and WireMock version, Trivy scan in CI, SBOM published with each image.
7. **Licence.** WireMock is Apache 2.0; its notice ships in the all-in-one image.

## Milestones

Ship in five steps, each usable on its own; QA can start using it after step 2.

1. **Core sync** (about 1 week). Backend, Redis store, save / delete / read paths, marker reconcile, admin auth, compose file.
2. **QA basics** (about 1–2 weeks). Integrations, catalog, Simple-mode mock form, request log with near misses, users and roles, seed import.
3. **OIDC template** (about 2–3 days). Login page, redirect, token, logout, saved test people.
4. **Full WireMock coverage** (about 2 weeks). Advanced matchers and responses, templating helper menu, scenarios, recording, webhooks, Postman and OpenAPI import.
5. **Packaging** (about 3–4 days). All-in-one image with s6-overlay and SQLite driver, multi-arch publish, docs site.

## Decisions (formerly open questions)

- [x] Frontend stack: TanStack Start (React), used full-stack — its server routes are the backend.
- [x] Confirm against the pinned WireMock 3.x: admin basic-auth flag, import options (`duplicatePolicy`, `deleteAllNotInImport`), templating opt-in per stub. *(Milestone 1, Task 2 pins these with tests.)* Confirmed on `wiremock/wiremock:3.13.1`: `--admin-api-basic-auth user:pass` protects `/__admin/*` (401 with wrong credentials, including `/__admin/version`); `POST /__admin/mappings/import` honours `duplicatePolicy: OVERWRITE` and `deleteAllNotInImport` true/false; an invalid regex is rejected on import with a 4xx; `GET /__admin/version` returns `.version` starting `3.`; `GET /__admin/mappings` pages with `limit`/`offset` (1500 stubs listed). Per-stub templating opt-in is not yet exercised (later task).
- [x] One UI per WireMock instance: one-to-one.
- [x] Request log is not copied to the store.
- [x] Licence for wiremock-ui: MIT.

## Amendments

**A1 — Full sync must not use `deleteAllNotInImport` per batch.** Sending each 500-stub batch with `deleteAllNotInImport: true` makes every batch delete the stubs the earlier batches loaded, so only the last batch survives. Full sync instead: (1) import all store stubs in batches of 500 with `duplicatePolicy: OVERWRITE` and `deleteAllNotInImport: false`; (2) list WireMock's stub ids and delete every id that is not in the store (the marker included); (3) recreate the marker last. WireMock is never emptied, so live traffic keeps matching during a sync.

**A2 — A failed store write rolls WireMock back to the previous version.** For a create, the stub is deleted from WireMock again. For an edit, the previous stored version is pushed back to WireMock (`OVERWRITE`), so a failed edit never deletes a working mock.

**A4 — Scripts authenticate with HTTP Basic against user accounts (from Milestone 2).** Browsers use the session cookie with CSRF tokens. Non-browser clients (CI, scripts) may send `Authorization: Basic` with a UI user's credentials; those requests need no CSRF token. Failed attempts — Basic or browser sign-in — count toward the per-IP login rate limit; successful ones do not. The UI never sends `WWW-Authenticate`, so browsers never cache Basic credentials (which would reopen cross-site request forgery).

**A5 — OIDC sign-in to the UI itself moves after Milestone 2.** Milestone 2 ships local accounts only; `AUTH_OIDC_*` sign-in is scheduled with Milestone 3 (OIDC template).

**A6 — Exports and nightly backups move to Milestone 4.** Milestone 2 ships imports and `SEED_PATH` seeding only.

**A6 amended — Export partly pulled forward (Milestone 2C).** `GET /api/export?scope=all|integration|mine&integration=&format=bundle|mappings` ships in Milestone 2C on every store driver: `bundle` is one JSON file `POST /api/import` takes back (`integrations`, `catalog` without `updatedAt`/`updatedBy`, `mocks` as stored, `oidcIdentities: []`); `mappings` is a zip of `mappings/<name>-<id>.json` built on the server; both are sent as attachments. "Mine" carries the integrations and endpoints its mocks link to. In WireMock-only mode (A10) both formats work: mocks come from WireMock and the catalog from memory, so a bundle export is how catalog changes made there are kept. The Mocks list ("Export", scope from its filter) and the Import page offer it. Import from the UI also grows: several files, a folder or a zip, read and merged in the browser into one import of at most 10 MB. Nightly backups (`BACKUP_PATH`) stay in Milestone 4.

**A11 — Postman import pulled forward (Milestone 2C).** The Import page accepts a Postman Collection v2.0/v2.1 (as a file, in a folder or in a zip), maps it in the browser to one integration, one endpoint per request and one mock per saved example (the chosen default example at priority 10, the others at priority 5 with a matcher from their saved request), and sends it as one bundle to `POST /api/import` without prune. Key clashes with an existing integration's endpoints are settled per row before sending (Create new renames the key, Overwrite keeps it, Skip leaves it out). OpenAPI import stays in Milestone 4.

**A7 — English only (Milestone 2B).** Arabic UI strings and RTL support are not required. UI strings stay centralised in one English message file so a translation can be added later.

**A8 — Sign-in without authorization (Milestone 2B).** Users still sign in (local accounts, sessions, CSRF, rate-limited login, Basic auth for scripts), but every signed-in user can do everything: no roles in the UI or the API, no ownership restrictions, baseline mocks editable by anyone. Mocks still record `owner`, and imports still never touch person-owned mocks. Roles may return later.

**A9 — Works without Redis (pulled forward from Milestone 5).** The SQLite store driver ships in Milestone 2 using Node's built-in `node:sqlite` (no native build). `STORE_DRIVER` defaults to `redis` when `REDIS_URL` is set and to `sqlite` otherwise; `SQLITE_PATH` defaults to `./data/wiremock-ui.db` (`/data/wiremock-ui.db` in the image).

**A10 — WireMock-only mode (`STORE_DRIVER=none`, Milestone 2C).** For people who only want to view and edit the stubs a WireMock already has, without storing anything. It is never a default: `STORE_DRIVER=none` must be set explicitly (the A9 defaults stay). In this mode:
- **WireMock is the store.** Lists, filters and the editor read WireMock's admin API live (`GET /__admin/mappings`, all pages; filters and sorting are applied in memory, fine for a few thousand stubs). A save imports the one stub into WireMock (`OVERWRITE`), a delete removes it. The optimistic version check is made against the live stub's `metadata.wiremockUi.version` just before the write (0 = must not exist); two saves that race between that read and the write both land, and the later wins — accepted for this mode. A stub WireMock keeps in its own files (`persistent: true`) stays persistent when edited; new mocks are `persistent: false`.
- **Stubs made outside the UI are editable.** A stub without `wiremockUi` metadata is shown as version 1 owned by `wiremock`, with source `wiremock`; saving it adds the metadata. The UI's marker stub, if one is left from a store-backed run, is hidden.
- **No sync.** The reconciler does not start: no marker, no full sync, nothing is ever deleted or re-added behind the user's back. `/healthz` reports `lastSyncAt: null`, and `store` follows WireMock's reachability.
- **Kept in memory, lost on restart:** sessions and the sign-in rate limit, the audit log (the last 500 entries) and the catalog (seeded from `SEED_PATH` on every start; a seed's mocks are imported into WireMock; `SEED_PRUNE` is ignored with a warning, and `POST /api/import?prune=true` answers 400 `Prune is not available in WireMock-only mode`, so the UI never deletes stubs from the user's WireMock in bulk).
- **Accounts:** only the bootstrap account from `ADMIN_USER` / `ADMIN_PASSWORD`, for browser sign-in and Basic auth alike. Creating, changing (password included) or deleting accounts answers 400 `User management is not available in WireMock-only mode`.
- **No history:** `GET /api/mocks/{id}/history` is always empty, so restore and Undo are unavailable.
- **The UI** reads the mode from `GET /api/config` (`{ storeDriver }`, signed-in users) and replaces the Users page with a short explanation ("User management is not available in WireMock-only mode — sign in with ADMIN_USER"); it hides History/Restore, the Import page's prune option, Undo after a delete, Change password, Reset my mocks and the My/All toggle (the list shows every stub). Catalog shows a dismissible notice: "Catalog changes are kept in memory and lost on restart (WireMock-only mode)".

**A3 — Milestone 1 API protection.** Users, roles and sessions arrive in Milestone 2. Until then `/api/*` is protected by HTTP basic auth checked against `ADMIN_USER` / `ADMIN_PASSWORD`, and every write is recorded as made by `ADMIN_USER`.
