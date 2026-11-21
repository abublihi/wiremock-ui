# wiremock-ui

[![CI](https://github.com/abublihi/wiremock-ui/actions/workflows/ci.yml/badge.svg)](https://github.com/abublihi/wiremock-ui/actions/workflows/ci.yml)

A web console for [WireMock](https://wiremock.org), made for testers. Describe the services your application calls, make mocks for them in a few clicks (or as raw stub JSON), point your application at WireMock, and watch every request it receives, with a plain explanation when a request matches no mock.

![The mocks list](docs/screenshots/mocks-dark.png)

> **Test environments only. No real personal data.** Mocks, request payloads and stored values are not protected like production data. WireMock serves stubs and its admin API on the same port: the UI always runs it with admin auth, but keep WireMock's port inside the test network.

## Quick start

You need Docker. Redis is not needed.

**One container** (the UI and WireMock together, from a released version):

```sh
docker run -d --name wiremock-ui -p 3000:3000 -p 8080:8080 -v wiremock-ui:/data \
  -e ADMIN_USER=admin -e ADMIN_PASSWORD=choose-a-password \
  ghcr.io/abublihi/wiremock-ui:latest-standalone
```

**Or with Docker Compose**, from this repository (WireMock and the UI as two containers):

```sh
git clone https://github.com/abublihi/wiremock-ui.git && cd wiremock-ui
cp .env.example .env    # set the passwords and SESSION_SECRET
docker compose -f compose.sqlite.yaml up -d --build
```

Open http://localhost:3000 and sign in with `ADMIN_USER` / `ADMIN_PASSWORD`. WireMock answers your application on http://localhost:8080.

**Want something to click on right away?** Add `SEED_PATH=/app/examples/seed.json` to `.env` and run the `up` command again (from source: `SEED_PATH=examples/seed.json`). [`examples/seed.json`](examples/seed.json) loads a **Blog API** (`/blog/posts`) and an **Orders API** (`/orders/{orderId}`) with a few mocks and an order going pending → shipped → delivered:

```sh
curl http://localhost:8080/blog/posts/42     # {"id":42,"userId":7,"title":"Hello from the mock",…}
curl http://localhost:8080/orders/1001       # pending, then shipped, then delivered
```

With the one-container image, the seed is the same: add `-e SEED_PATH=/app/examples/seed.json` to `docker run`.

Other ways to run it (the one-container image's settings, with Redis, from source, Kubernetes, or against a WireMock you already have, storing nothing) are in [Installing](docs/INSTALL.md).

## Features

- **Integrations and endpoints.** Describe each service once: the **Blog API** at `/blog` has an endpoint **Get post** `GET /blog/posts/{id}` whose key is the path variable `id`. After that, a mock is "id 42 answers 200 with this body", made in a few clicks.
- **Simple and Advanced mode.** Simple mode builds the stub from the endpoint (key value, status preset, body prefilled from the endpoint's example, slow responses, faults). **Mock a URL directly** does the same for a method and URL without an integration. **Advanced mode** edits the full stub JSON.
- **Test a mock** from the editor, or **Try it** on an endpoint, and see which mock answered. **Copy as curl** for any mock or logged request.
- **Proxy** (forward to a real service), **webhooks** (call back after responding) and **scenarios** (pending, then shipped, then delivered), with a step-by-step scenario builder and a live state view.
- **Request log** that updates live and stamps unmatched requests **No match**, with the closest mocks and the fields that differed.
- **Record real traffic**, then accept the recorded answers you want from a review list (or turn logged requests into mocks). `RECORDING_ALLOWED=false` turns it off.
- **Import and export**: bundles, WireMock mappings, files, folders, zips and **Postman collections** (each request becomes an endpoint, each saved example a mock). Baseline mocks can be seeded on every start.
- **History and restore** for every mock, conflict detection when two people edit the same one, and an **audit log**.
- **Durable**: mocks live in the UI's store (one SQLite file, or Redis) and are put back into WireMock after it restarts. Or run **WireMock-only** and store nothing.
- **A built-in guide** (Help → Guide, or press `?`) and a **How this works** button on every page.
- **A REST API** with HTTP Basic auth for scripts and CI.

## Documentation

- **[Guide](docs/guide/getting-started.md)**: one page per feature, from your first mock to scenarios, recording and the API. The same pages are in the app under Help → Guide. Index: [docs/USAGE.md](docs/USAGE.md).
- **[Installing](docs/INSTALL.md)**: Compose with or without Redis, from source, WireMock-only mode, Kubernetes, backups, upgrades and troubleshooting.
- **[Architecture](#architecture)** and **[Configuration reference](#configuration-reference)**: below.

## A look around

| | |
| --- | --- |
| ![Integrations](docs/screenshots/integrations-dark.png) **Integrations** explain integration → endpoint → mock at a glance. | ![An integration](docs/screenshots/integration-dark.png) **An integration** and its endpoints, with Try it. |
| ![Endpoint form](docs/screenshots/endpoint-dark.png) **An endpoint**: method, path, where the key is, examples. | ![New mock picker](docs/screenshots/new-mock-picker-dark.png) **New mock** starts from an endpoint. |
| ![No integrations yet](docs/screenshots/new-mock-empty-dark.png) **A fresh install** offers three ways to start. | ![Simple editor](docs/screenshots/editor-dark.png) **Simple mode**: key value, status and body. |
| ![Advanced editor](docs/screenshots/advanced-dark.png) **Advanced mode**: the full stub JSON. | ![Mock a URL directly](docs/screenshots/quick-mock-dark.png) **Mock a URL directly**, no integration needed. |
| ![Test panel](docs/screenshots/test-panel-dark.png) **Test a mock** and see which mock answered. | ![Proxy and webhook](docs/screenshots/proxy-webhook-dark.png) **Proxy** to a real service and **call back** afterwards. |
| ![Body from a file](docs/screenshots/body-file-dark.png) **A response body from a file**, binary included. | ![Request log](docs/screenshots/requests-dark.png) **The request log**, live. |
| ![Near misses](docs/screenshots/near-miss-dark.png) **Why a request matched nothing**, field by field. | ![Scenarios](docs/screenshots/scenarios-dark.png) **Scenarios** with their live state. |
| ![Scenario builder](docs/screenshots/scenario-builder-dark.png) **The scenario builder**. | ![Edit a scenario](docs/screenshots/scenario-edit-dark.png) **Edit a scenario** as one unit. |
| ![Recording](docs/screenshots/recording-dark.png) **Record** a real service's answers. | ![Import](docs/screenshots/import-dark.png) **Import** files, folders and zips. |
| ![Postman import](docs/screenshots/postman-import-dark.png) **Import a Postman collection** with a preview. | ![Export](docs/screenshots/export-dark.png) **Export** a bundle or WireMock mappings. |
| ![Users](docs/screenshots/users-dark.png) **Users**. | ![Audit](docs/screenshots/audit-dark.png) **Audit log**. |
| ![Guide](docs/screenshots/guide-dark.png) **The guide**, in the app. | ![Help panel](docs/screenshots/help-panel-dark.png) **How this works** on every page. |

## Architecture

wiremock-ui is one Node.js server (TanStack Start: a React UI and a REST API under `/api`) next to a WireMock 3 server. Your application only ever talks to WireMock; people and scripts talk to wiremock-ui, which manages WireMock through its admin API.

```mermaid
flowchart LR
  tester["Browser<br/>(testers)"] -- "UI + /api<br/>session cookie + CSRF" --> ui
  ci["Scripts / CI"] -- "/api<br/>HTTP Basic" --> ui
  subgraph ui["wiremock-ui server"]
    api["REST handlers<br/>(withAuth)"] --> svc["MockService · CatalogService<br/>ScenarioService · RecordingService"]
    svc --> rec["Reconciler<br/>(sync loop)"]
  end
  svc -- "mocks, history, users,<br/>sessions, catalog, audit" --> store[("Store<br/>SQLite file · Redis · none")]
  svc -- "admin API<br/>/__admin (Basic auth)" --> wm["WireMock 3"]
  rec -- "marker check,<br/>full sync" --> wm
  app["Application under test"] -- "HTTP calls<br/>(stub port)" --> wm
```

### Where things live

- **The store is the source of truth** for mocks (with their history: the last 20 versions, kept 7 days after a delete), integrations and endpoints, users, sessions, the sign-in rate limit, recording review lists and the audit log (30 days). The store is a SQLite file (default, Node's built-in `node:sqlite`, no native build) or Redis (`REDIS_URL`; several UI instances can share it). Both drivers pass the same contract tests.
- **WireMock holds a copy** of every mock as a stub mapping. Each stub carries `metadata.wiremockUi` (owner, integration, endpoint, version, updatedAt, updatedBy, source), so a stub in WireMock always says who made it.
- **Read live from WireMock, never stored:** the request log, near misses (WireMock's own near-miss API, explained field by field), scenario states, and recordings in progress. The request log is WireMock's journal, so keep `--max-request-journal-entries` set (Compose sets 5000).

### Saving a mock

Every change (create, update, delete, restore, import, seed, accepted recording) goes through `MockService`:

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser / API client
  participant S as MockService
  participant ST as Store
  participant W as WireMock
  B->>S: save(mock, expectedVersion)
  S->>S: validate (stub shape, proxy/webhook/scenario fields)
  S->>ST: read current version
  alt version differs
    S-->>B: 409 Conflict (someone else saved first)
  end
  S->>W: import stub (WireMock first)
  alt WireMock refuses or is down
    S-->>B: error, nothing stored
  end
  S->>ST: save(stub, expectedVersion) + history entry
  alt store write fails (or a racing save wins the version check)
    S->>W: roll back: previous stub, or delete the new one
    S-->>B: error / 409
  end
  S->>ST: audit entry (mock.create / mock.update / …)
  S-->>B: saved stub (version + 1)
```

WireMock is written first so that a saved mock is always served; if the store then refuses, the WireMock write is undone. Every stub is written with `persistent: false` (except in WireMock-only mode, which keeps a stub's own `persistent` flag): WireMock's own files never hold a second copy that could disagree with the store.

### Keeping WireMock in sync (the reconciler)

WireMock forgets its stubs when it restarts. The reconciler puts them back:

```mermaid
flowchart TD
  tick(["Every SYNC_INTERVAL_SECONDS"]) --> marker{"Marker stub<br/>still in WireMock?"}
  marker -- yes --> done(["Nothing to do"])
  marker -- "no (WireMock restarted or was reset)" --> full
  safety(["Every 10 minutes<br/>(safety net)"]) --> full
  boot(["At start"]) --> full
  full["Full sync"] --> lock{"Take the sync lock<br/>(shared by all instances)"}
  lock -- "held elsewhere" --> skip(["Skip: the other instance syncs"])
  lock -- taken --> snap["Snapshot the store,<br/>in precedence order"]
  snap --> imp["Import in batches of 500<br/>(deleteAllNotInImport = false)"]
  imp --> clean{"Adoption pending?"}
  clean -- no --> del["Delete WireMock stubs the store does not know<br/>(not a recording proxy, not saved meanwhile)"]
  clean -- yes --> keep["Delete nothing"]
  del --> catch
  keep --> catch["Catch up: re-import mocks saved during the sync,<br/>delete ones deleted during it"]
  catch --> mark["Put the marker stub back"]
  mark --> verify{"WireMock has at least<br/>store count + 1 stubs?"}
  verify -- yes --> ok(["lastSyncAt updated<br/>(audit sync entry at start and after a restart)"])
  verify -- "no (WireMock changed mid-sync)" --> retry(["Remove the marker, so the next tick syncs again"])
```

- **Precedence.** When several mocks match one request with the same priority, WireMock answers with the one added last. The reconciler adds stubs in this order: baseline mocks first, then people's own mocks, each oldest-updated first, so **a person's mock beats a baseline mock and the newest wins**. Within one import call WireMock prefers the earlier entry, so each batch is sent reversed. After an import or seed adds baseline mocks, people's mocks are re-added on top.
- **Sync lock.** A full sync and an adoption hold the store lock `sync:lock` (60 s TTL), so with Redis and several UI instances only one of them syncs at a time.
- **Health.** `GET /healthz` reports `lastSyncAt` and `lastSyncError`.

### Adopting stubs WireMock already has

Pointing a fresh UI at a WireMock that already serves stubs does not wipe them. At start, if the store has no mocks and WireMock has stubs, the UI first records a durable **adoption-pending** flag in the store, then (after the seed, so integration prefixes are known) stores every live stub with its own id, owner `wiremock` (or the owner its metadata names), source `adopt`, integration guessed from the URL prefix. While the flag is set, no full sync deletes anything from WireMock; a start that stops part-way leaves the flag for the next one. Adoption runs under the sync lock and clears the flag when it is done; from then on the store is the source of truth.

### WireMock-only mode (`STORE_DRIVER=none`)

For looking at and editing a WireMock's own stubs without storing anything. WireMock is the mock store: lists and reads go live to `GET /__admin/mappings`, a save imports one stub after checking the live stub's version, a delete is an admin DELETE. There is no reconciler, no marker stub, no sync and no prune: the UI never adds or deletes stubs on its own. Accounts (only `ADMIN_USER`), sessions, integrations, recordings and the audit log (last 500 entries) live in memory and are lost on restart; there is no history. The UI hides Users management, History/Restore and the My/All toggle. See [Storage and WireMock-only mode](docs/guide/storage.md).

### Sign-in, sessions and audit

- **Browser sessions**: an `HttpOnly`, `SameSite=Lax` cookie valid for 12 hours, `Secure` when `PUBLIC_UI_URL` is `https`, when the request itself came over `https`, or (with `TRUST_PROXY=true`) when the proxy says so in `X-Forwarded-Proto: https`. Every write made with a session needs the session's CSRF token in the `X-CSRF-Token` header (the UI sends it).
- **Scripts**: HTTP Basic auth with a user's name and password on any `/api` call; no CSRF token needed.
- **Rate limit**: 10 failed sign-ins in 15 minutes from one IP blocks that IP until the window ends (`TRUST_PROXY` decides where the IP comes from).
- **No roles**: everyone who can sign in can do everything. Passwords are bcrypt hashes.
- **Audit log**: every change (mocks, integrations, users, imports, syncs, adoptions, recordings) with who, what and when, on the Audit page and `GET /api/audit`.
- **WireMock's admin API** must have basic auth: the UI refuses to start against an open one.

### Code map

| Path | What is there |
| --- | --- |
| `src/server/runtime.ts` | Boot: config, WireMock readiness, stores, services, seed, adoption, reconciler. |
| `src/server/config.ts` | Every environment variable (see below). |
| `src/server/mocks/service.ts` | The save path: validation, version check, WireMock first, rollback. |
| `src/server/sync/reconciler.ts`, `sync/adopt.ts` | Marker check, full sync, precedence, adoption. |
| `src/server/store/` | Store drivers: `sqlite/`, `redis.ts`, `wiremock.ts` (WireMock-only), `memory.ts`. |
| `src/server/wiremock/client.ts` | The WireMock admin API client. |
| `src/server/http/handlers/` | Framework-free REST handlers; `src/routes/api/` are thin route files. |
| `src/ui/`, `src/routes/_app/` | The React UI. |
| `docs/guide/` | The user guide, shown in the app too. Links between its pages that point at app pages (`/mocks`, `/scenarios`…) work in the app, not on GitHub. |

## Configuration reference

### Environment variables

Everything is set through environment variables. Empty values count as unset. Booleans accept `true`, `false`, `1` or `0`. "Modes" says which store driver a variable matters for (`all`, `sqlite`, `redis`, `none`).

| Variable | Default | Allowed values | Required | Modes | Example | What it does |
| --- | --- | --- | --- | --- | --- | --- |
| `ADMIN_USER` | none | 2–32 characters: a-z, 0-9, `.`, `_`, `-` (lower-cased); not `baseline`, `system` or `wiremock` | **required** | all | `admin` | Username of the first account, created on the first start when there are no accounts yet. Changing it later does nothing (except in `none` mode, where it is the only account). |
| `ADMIN_PASSWORD` | none | at least 8 characters, at most 72 bytes (UTF-8) | **required** | all | `choose-a-password` | Password of that first account. Changing it later does nothing outside `none` mode; see [Resetting a password](docs/INSTALL.md#resetting-a-password). |
| `SESSION_SECRET` | none | any string; use 32+ random characters | **required** | all | `$(openssl rand -hex 32)` | Secret for browser sessions. |
| `WIREMOCK_URL` | `http://localhost:8080` | URL | optional | all | `http://wiremock:8080` | Where the UI reaches WireMock (admin API and the test relay). Compose sets it. |
| `WIREMOCK_PUBLIC_URL` | `WIREMOCK_URL` | `http://` or `https://` URL | optional | all | `http://localhost:8080` | Where applications and testers reach WireMock's stub port. Only used in curl commands and docs; the UI never calls it. |
| `WIREMOCK_ADMIN_USER` | none | any name | optional, set with the password | all | `wmadmin` | WireMock admin API username. The UI refuses to start if WireMock's admin API is open, so in practice it is needed. |
| `WIREMOCK_ADMIN_PASSWORD` | none | any string | optional, set with the user | all | `choose-a-wiremock-password` | WireMock admin API password. Compose passes both to WireMock's `--admin-api-basic-auth`. |
| `STORE_DRIVER` | `redis` when `REDIS_URL` is set, else `sqlite` | `sqlite`, `redis`, `none` | optional | all | `none` | Where data is kept. `none` (WireMock-only mode) is never picked for you. |
| `REDIS_URL` | none | `redis://` URL | required for `redis` | redis | `redis://redis:6379` | Redis connection URL. |
| `SQLITE_PATH` | `./data/wiremock-ui.db` (`/data/wiremock-ui.db` in the image) | file path | optional | sqlite | `/data/wiremock-ui.db` | The SQLite file; its folder is created on start. One UI instance per file. |
| `SYNC_INTERVAL_SECONDS` | `5` | positive number | optional | sqlite, redis | `10` | How often the reconciler checks the marker stub and re-syncs a WireMock that lost its stubs. A full sync also runs every 10 minutes. |
| `BOOT_TIMEOUT_SECONDS` | `60` | positive integer | optional | all | `120` | How long the start waits for WireMock and the store before giving up. |
| `TRUST_PROXY` | `false` | boolean | optional | all | `true` | Behind a reverse proxy: take the client IP for the sign-in rate limit from `X-Forwarded-For` (rightmost hop). |
| `PUBLIC_UI_URL` | none | URL | optional | all | `https://mocks.example.com` | The address people use to reach the UI. An `https` URL makes session cookies `Secure` (they are also `Secure` on any `https` request, see Security). |
| `SEED_PATH` | none | bundle file or folder of `*.json` | optional | all | `examples/seed.json` | Imported on every start as baseline mocks (and integrations). See [Import and export](docs/guide/import-export.md). |
| `SEED_PRUNE` | `false` | boolean | optional | sqlite, redis | `true` | With `SEED_PATH`: delete baseline mocks that are no longer in the seed. People's own mocks are never touched. Ignored in `none` mode. |
| `RECORDING_ALLOWED` | `true` | boolean | optional | all | `false` | `false` turns recording and "create mocks from the request log" off: the Recording page is hidden and the API answers 403. Recording, like proxy mocks, lets signed-in users make WireMock connect to any address it can reach. |
| `PORT` | `3000` | port number | optional | all | `3400` | Port the UI listens on. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` | optional | all | `warn` | Log level. Logs are JSON lines on stdout. |

A test (`tests/server/config-docs.test.ts`) checks this table against the variables the server reads.

### Docker and Compose

| | |
| --- | --- |
| **Images** | `ghcr.io/abublihi/wiremock-ui`, published by CI for version tags, for `linux/amd64` and `linux/arm64`. Two variants from one `Dockerfile`: |
| **UI only** | Tags `1.2.3`, `1.2`, `latest`, `sha-…`. Node 22 Alpine, runs as `node`, listens on `PORT` (3000), `VOLUME /data`, `SQLITE_PATH=/data/wiremock-ui.db`; point it at your WireMock with `WIREMOCK_URL`. Build: `docker build -t wiremock-ui .` |
| **Standalone** (UI and WireMock) | Tags `1.2.3-standalone`, `1.2-standalone`, `latest-standalone`, `sha-…-standalone`. WireMock's image plus Node 22; runs as `wmui` (uid 10001); UI on `PORT` (3000), WireMock on `WIREMOCK_PORT` (8080); everything in `VOLUME /data` (SQLite, WireMock's files in `/data/wiremock`, the session secret). Settings: [Installing → One container](docs/INSTALL.md#1-one-container-ui-and-wiremock-together). Build: `docker build --target standalone -t wiremock-ui:standalone .` |
| **`compose.sqlite.yaml`** | WireMock + UI, data on the `ui-data` volume (`/data`). No Redis. |
| **`compose.yaml`** | WireMock + Redis (append-only, `redis-data` volume) + UI, which gets `REDIS_URL=redis://redis:6379`. |
| **WireMock** | `wiremock/wiremock:3.13.1` with `--admin-api-basic-auth $WIREMOCK_ADMIN_USER:$WIREMOCK_ADMIN_PASSWORD` and `--max-request-journal-entries 5000`. |
| **`UI_PORT`** (Compose only) | Host port for the UI, default `3000`. |
| **`WIREMOCK_PORT`** (Compose only) | Host port for WireMock, default `8080`. |
| **Health** | `GET /healthz`, no auth: `{"ui":"ok","store":"ok","wiremock":"ok","lastSyncAt":"…","lastSyncError":null}`, 200 when the store and WireMock answer within 2 s, else 503. The image's `HEALTHCHECK` calls it every 10 s. |

Compose reads everything else from `.env` (`env_file`). The image contains the example seed at `/app/examples/seed.json`; for your own seed, mount a folder (for example `./seed:/seed:ro`) and set `SEED_PATH=/seed`.

### In the browser

These are remembered per browser, not on the server:

| Setting | Where | Default | Stored as |
| --- | --- | --- | --- |
| Theme | Moon/sun button in the top bar | dark | cookie `wmui_theme` = `dark`, `light` or `system` (so the first page render is already right) |
| Mocks per page | Mocks list footer | 50 (25, 50 or 100) | `localStorage` `wmui.mocks.pageSize` |
| "How it fits together" explainer | Integrations page | shown | `localStorage` `wmui.catalogExplainer.dismissed` |
| Getting-started checklist | Mocks page | shown | `localStorage` `wmui.gettingStarted.dismissed` (and `wmui.gettingStarted.requestLogSeen`) |
| WireMock-only notice | Integrations page in `none` mode | shown | `localStorage` `wmui.catalogMemoryNotice.dismissed` |

## Development

```sh
npm ci --ignore-scripts
npm run dev                 # needs WireMock reachable per .env; Redis only if REDIS_URL is set
                            # on Node 22.12: NODE_OPTIONS=--experimental-sqlite npm run dev
npm test                    # needs Docker: store tests run against Redis and SQLite
npm run test:e2e            # builds, then runs the Playwright specs (needs Docker; npx playwright install chromium once)
./scripts/e2e-restart.sh    # Compose check that stubs survive a WireMock restart (with Redis)
./scripts/e2e-sqlite.sh     # the same without Redis, on the SQLite volume
./scripts/e2e-none.sh       # WireMock-only mode against a WireMock with existing stubs
npm run typecheck
npm run build && npm start
```

`npm run test:e2e` starts its own stack: a WireMock container with admin auth (through Testcontainers) and the built app on a temporary SQLite file at http://127.0.0.1:3417 (`E2E_UI_PORT` changes the port), seeded from `tests/fixtures/e2e-seed/` (the Blog API). The restart scripts use host ports 8080 and 3000; set `WIREMOCK_PORT` and `UI_PORT` to use others.

CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) type-checks, builds, runs the unit and container tests (Redis, SQLite and WireMock-only) and the end-to-end tests on every push and pull request, and publishes the Docker image for `v*` tags.

## Licence

MIT. See [LICENSE](LICENSE).
