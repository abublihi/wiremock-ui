# Installing wiremock-ui

wiremock-ui runs next to a WireMock 3 server. The UI keeps every mock in its own store and pushes it into WireMock, so mocks survive a WireMock restart. This page covers running it, configuring it and keeping it healthy. For how to use it day to day, see the [guide](guide/getting-started.md) (also in the app under Help → Guide).

> **Test environments only.** Never put real personal data in a mock, a request or a stored value.

## Requirements

- **Docker.** The one-container image needs nothing else; the two Compose setups need Docker Compose v2 (`docker compose`).
- **To run from source:** Node.js 22.12 or later, plus Docker (or any other way) to run WireMock 3.13.
- **Redis is optional.** Without `REDIS_URL` the UI stores everything in one SQLite file. Use Redis only if you want to run several UI instances against the same data.

## Ways to run it

### 1. One container (UI and WireMock together)

The quickest start: the `-standalone` image runs WireMock and the UI in one container, with everything (SQLite data, WireMock's own files, the session secret) in `/data`. Published for `linux/amd64` and `linux/arm64` with every release.

```sh
docker run -d --name wiremock-ui -p 3000:3000 -p 8080:8080 -v wiremock-ui:/data \
  -e ADMIN_USER=admin -e ADMIN_PASSWORD=choose-a-password \
  ghcr.io/abublihi/wiremock-ui:latest-standalone
```

Open http://localhost:3000 and sign in; WireMock answers your application on http://localhost:8080. Pin a version (`1.2.3-standalone`) for anything you keep. To build it yourself: `docker build --target standalone -t wiremock-ui:standalone .`

Without `ADMIN_USER` / `ADMIN_PASSWORD`, create the first account from a terminal instead: `docker exec -it wiremock-ui wiremock-ui create-admin` (see [The wiremock-ui command](#the-wiremock-ui-command)). Every other setting in the [Configuration reference](../README.md#environment-variables) works too, except `WIREMOCK_URL` (the UI always uses the WireMock inside the container). Settings for this image only:

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `3000` | Port the UI listens on inside the container. |
| `WIREMOCK_PORT` | `8080` | Port WireMock listens on inside the container (stubs and `/__admin`). |
| `WIREMOCK_PUBLIC_URL` | `http://localhost:<WIREMOCK_PORT>` | Where your applications and testers reach WireMock; used in the curl commands the UI shows. Set it when the host port or host name differs, for example `http://localhost:9090` with `-p 9090:8080`. |
| `WIREMOCK_ADMIN_USER`, `WIREMOCK_ADMIN_PASSWORD` | `wiremock-ui` and a random password made at every start | Basic auth on WireMock's admin API. Only the UI needs it; set both to call `/__admin` from your own scripts. |
| `SESSION_SECRET` | made once, kept in `/data/.session-secret` | Signs sign-in cookies. Set it only to share it between containers. |
| `WIREMOCK_OPTIONS` | none | Extra WireMock options, for example `--global-response-templating` or `--verbose`. |
| `WIREMOCK_JOURNAL_ENTRIES` | `5000` | How many requests WireMock keeps for the request log. |
| `JAVA_OPTS` | none | Options for WireMock's Java, for example `-Xmx512m`. |

**Ports.** To use other host ports, change only the left side of `-p` (`-p 9000:3000 -p 9090:8080`) and set `WIREMOCK_PUBLIC_URL=http://localhost:9090`. `PORT` and `WIREMOCK_PORT` change the ports inside the container, which matters with `--network host` or on platforms that pick the port.

**Stopping.** `docker stop wiremock-ui` stops both processes cleanly. If either WireMock or the UI stops on its own, the container stops too, so a restart policy (`--restart unless-stopped`) brings both back.

**Redis** still works: add `-e REDIS_URL=redis://…` to use it instead of SQLite.

### 2. Docker Compose without Redis

UI + WireMock; the UI keeps its data in a SQLite file on the `ui-data` volume.

```sh
git clone https://github.com/abublihi/wiremock-ui.git && cd wiremock-ui
cp .env.example .env     # set the passwords and SESSION_SECRET (see the Configuration reference)
docker compose -f compose.sqlite.yaml up -d --build
```

Open http://localhost:3000 and sign in with `ADMIN_USER` / `ADMIN_PASSWORD` from `.env`. WireMock answers your application on http://localhost:8080.

Check that everything is up:

```sh
curl http://localhost:3000/healthz
# {"ui":"ok","store":"ok","wiremock":"ok","lastSyncAt":"…","lastSyncError":null}
```

**Try it with example data.** Add `SEED_PATH=/app/examples/seed.json` to `.env` and run the `up` command again: the UI loads the Blog API and Orders API from [`examples/seed.json`](../examples/seed.json), with a few mocks and an order scenario (`curl http://localhost:8080/blog/posts/42`). From source, use `SEED_PATH=examples/seed.json`. Seeded mocks are baseline mocks: anyone can edit them, and every start puts them back as the seed has them.

Stop it with `docker compose -f compose.sqlite.yaml down` (add `-v` to also delete the data volume).

### 3. Docker Compose with Redis

The same, plus a Redis container with append-only persistence (`redis-data` volume):

```sh
cp .env.example .env
docker compose up -d --build
```

Compose sets `WIREMOCK_URL` and `REDIS_URL` for the UI; everything else comes from `.env`.

### 4. From source

Start WireMock with admin authentication (the UI refuses to start against an open admin API):

```sh
docker run -d --name wiremock -p 8080:8080 wiremock/wiremock:3.13.1 \
  --admin-api-basic-auth wmadmin:choose-a-wiremock-password \
  --max-request-journal-entries 5000
```

Then build and start the UI:

```sh
npm ci --ignore-scripts
npm run build
cp .env.example .env          # set the values; WIREMOCK_ADMIN_USER/PASSWORD must match the WireMock flag above
set -a; . ./.env; set +a      # export the variables into this shell
npm start                     # http://localhost:3000 (PORT changes it)
```

`npm start` passes `--experimental-sqlite`, which Node 22.12 needs for the built-in SQLite module. The SQLite file goes to `./data/wiremock-ui.db` unless `SQLITE_PATH` says otherwise.

For development (`npm run dev`, hot reload on port 3000) on Node 22.12, set `NODE_OPTIONS=--experimental-sqlite` first.

**Pointing it at a WireMock that already has stubs.** On a first start (a store with no mocks yet) the UI adopts every stub WireMock already serves. They keep their ids, show up in the mocks list owned by `wiremock` (or by the owner a stub's wiremock-ui metadata already names), and stay in WireMock exactly as they are. The UI records that adoption is pending before it starts; if that first start stops part-way, the next start (or the next full sync) finishes the job, and until then no sync deletes anything from WireMock. The first time you edit an adopted stub in the UI it is saved like any other mock: with `persistent: false` (a stub that came from WireMock's `mappings` folder is then no longer written to WireMock's files) and with the UI's own metadata replacing any it had. From then on the UI's store is the source of truth, so stubs added to WireMock behind the UI's back are removed by the next full sync. To only view and edit WireMock's own stubs without a store, see [Run against an existing WireMock (no storage)](#run-against-an-existing-wiremock-no-storage).

### Run against an existing WireMock (no storage)

If you only want to look at and edit the stubs a WireMock already has, start the UI with `STORE_DRIVER=none`. WireMock itself is the store: the UI reads its stubs live, writes your edits straight into it and never deletes or adds anything on its own (no sync, no marker stub). Stubs made outside the UI show up owned by `wiremock` and can be edited like any other.

```sh
STORE_DRIVER=none \
WIREMOCK_URL=http://wiremock.test.example:8080 \
WIREMOCK_ADMIN_USER=wmadmin WIREMOCK_ADMIN_PASSWORD=its-admin-password \
ADMIN_USER=admin ADMIN_PASSWORD=choose-a-password SESSION_SECRET=$(openssl rand -hex 32) \
npm start
```

(or set the same variables on the `ui` service of a Compose file and drop the `redis` service and the volume). Sign in with `ADMIN_USER` / `ADMIN_PASSWORD`; scripts can use them with Basic auth.

What you give up, because nothing is stored:

- **One account only**, the `ADMIN_USER` one: the Users page only explains this, and its password is changed by changing `ADMIN_PASSWORD` and restarting.
- **No history**, so no restore and no Undo after a delete.
- **The audit log (last 500 entries) and sign-in sessions live in memory** and are gone after a restart (everyone signs in again). `SEED_PATH` still loads on every start; its mocks are written into WireMock. `SEED_PRUNE` is ignored (with a warning in the log) and the Import page offers no prune (the API answers 400): the UI never deletes stubs from your WireMock in bulk.
- **Edits made while WireMock is down fail** (there is no copy to fall back to), and a WireMock restart keeps only what WireMock itself persists: a stub that came from WireMock's `mappings` folder stays persistent when you edit it; mocks you create in the UI are not written to WireMock's files.
- **Two people saving the same mock at the same moment**: the version check catches most conflicts, but two saves within the same instant can both land (the later one wins).

To move to a stored setup later, start the UI with `sqlite` or `redis` against the same WireMock: on that first start it adopts every stub WireMock has (see above).

## Configuration

Everything is set through environment variables (empty values count as unset). The full list, with defaults, allowed values, which store mode each one applies to and an example, is the **[Configuration reference](../README.md#configuration-reference)** in the README, together with the Docker image, the Compose files and their host ports (`UI_PORT`, `WIREMOCK_PORT`), `/healthz` and the settings each browser remembers. How the pieces fit together is in [Architecture](../README.md#architecture).

### How the stores compare

Both stores keep the same data and behave the same: accounts and sessions, the sign-in rate limit, mocks with their history (last 20 versions, kept 7 days after a delete) and the 30-day audit log.

- **SQLite** uses Node's built-in `node:sqlite` (no native build) in one file in WAL mode. Keep the file on a volume and run **one** UI instance per file.
- **Redis** lets several UI instances share the data. Run it with persistence (`--appendonly yes`, as `compose.yaml` does).

## Kubernetes

Run the UI and WireMock as two containers in **one pod**:

- WireMock listens on 8080 inside the pod. Do not expose it outside the test network: its admin API shares that port. Start it with `--admin-api-basic-auth <user>:<password>` (from a Secret) and `--max-request-journal-entries 5000`.
- The UI container sets `WIREMOCK_URL=http://localhost:8080`, the same admin credentials, `ADMIN_USER`, `ADMIN_PASSWORD` and `SESSION_SECRET` (Secrets), and exposes port 3000 through a Service/Ingress.
- With SQLite, mount a PersistentVolumeClaim at `/data` and keep `replicas: 1`. For more replicas, point `REDIS_URL` at a Redis with persistence.
- Behind an Ingress set `TRUST_PROXY=true` and `PUBLIC_UI_URL=https://…`.
- Baseline mocks: put bundle or WireMock mapping files in a ConfigMap, mount it as a folder and set `SEED_PATH` to that folder. ConfigMap symlinks are followed. Add `SEED_PRUNE=true` if removing a file from the ConfigMap should remove its mocks. With `SEED_PRUNE` on, every restart deletes baseline mocks that are not in the seed, so the Recording page cannot accept recorded mocks as baseline (the API answers 400): accept them as your own mocks, or add them to the seed.
- Probes: `GET /healthz` on port 3000 needs no auth and answers 200 when the store and WireMock are reachable.

## Backups

- **SQLite:** everything lives in the file at `SQLITE_PATH` (`/data/wiremock-ui.db` on the `ui-data` volume with Compose). Copy it while the UI is stopped, or take a consistent online copy:

  ```sh
  docker compose -f compose.sqlite.yaml exec ui node --experimental-sqlite --disable-warning=ExperimentalWarning \
    -e "new (require('node:sqlite').DatabaseSync)(process.env.SQLITE_PATH).exec(\"VACUUM INTO '/data/backup.db'\")"
  docker compose -f compose.sqlite.yaml cp ui:/data/backup.db ./wiremock-ui-backup.db
  ```

  `VACUUM INTO` will not overwrite an existing file; delete the old `/data/backup.db` first. To restore, stop the UI and put the copy back at `SQLITE_PATH`.

- **Redis:** the `redis-data` volume holds the append-only files (`appendonlydir/`) and snapshots (`dump.rdb`). Back up that volume, or run `redis-cli BGSAVE` and copy the fresh `dump.rdb`.

WireMock itself holds no state worth backing up: the UI puts every mock back after a WireMock restart.

## Upgrading

```sh
git pull
docker compose -f compose.sqlite.yaml up -d --build      # or: docker compose up -d --build
```

Data on the volume is kept. From source: `git pull && npm ci --ignore-scripts && npm run build`, then restart `npm start`. Take a backup first.

## Performance

Measured with `scripts/load-test.mjs` on an Apple M1 Pro (10 cores, 16 GB; Docker Desktop VM with 3 CPUs and 9 GB),
Node 26, WireMock 3.13.1 with default JVM settings, on the version before tags replaced integrations. Each run seeds N
mocks in groups of 100 (mocks keyed by query, path, JSON body and header; URL mocks; one 3-step scenario and two ~45 KB
JSON bodies per 100 mocks). A `tag=` filter reads every mock, like `q=`.
API figures are p50 / p95 in ms over 20 calls, one user, no other load.

| | SQLite 1,000 | SQLite 10,000 | SQLite 20,000 | Redis 10,000 | WireMock-only 1,000 |
|---|---:|---:|---:|---:|---:|
| Import the seed (`POST /api/import`) | 1.9 s | 17.6 s | 54.9 s | 43.9 s | 0.3 s ¹ |
| Cold boot until the first sync | 0.7 s | 4.3 s | 14.0 s | 5.2 s | 0.6 s |
| WireMock restart until every stub is back | 4.6 s | 9.5 s | 18.7 s | 8.7 s | n/a |
| `GET /api/mocks?limit=50` (All mocks) | 8 / 8 | 81 / 105 | 149 / 163 | 108 / 117 | 50 / 59 |
| … with `q=` | 7 / 8 | 74 / 80 | 137 / 145 | 115 / 123 | 35 / 40 |
| `GET /api/mocks` (no limit) | 10 / 11 | 109 / 119 | 195 / 214 | 143 / 212 | 35 / 39 |
| `GET /api/scenarios` | 10 / 11 | 92 / 97 | 161 / 294 | 95 / 102 | 36 / 41 |
| `GET /api/export?format=bundle` | 11 / 12 (1.6 MB) | 111 / 126 (16 MB) | 235 / 268 (32 MB) | 192 / 227 | 36 / 43 |
| Save a new mock (`POST /api/mocks`) | 3 / 7 | 4 / 5 | 5 / 8 | 7 / 8 | 4 / 6 |
| Save an edit (`PUT /api/mocks/:id`) | 3 / 3 | 2 / 3 | 2 / 3 | 5 / 10 | 4 / 6 |
| `GET /api/requests?limit=500` | 61 / 106 | 65 / 89 | 55 / 139 | 42 / 67 | 42 / 62 |
| WireMock: matched request | 2 / 5 | 7 / 11 | 12 / 20 | 7 / 12 | 2 / 4 |
| WireMock: unmatched request | 7 / 12 | 49 / 79 | 94 / 141 | 48 / 67 | 7 / 10 |
| UI process RSS (end of run / peak) | 259 / 273 MB | 291 / 626 MB | 262 / 1,009 MB | 214 / 826 MB | 293 / 293 MB |
| WireMock container memory | 0.9 GB | 2.3 GB | 2.4 GB | 2.4 GB | 0.9 GB |

¹ WireMock-only mode: the mocks were loaded straight into WireMock.

In the browser at 20,000 mocks (SQLite): *My mocks* opens in ~0.3 s; *All mocks* in ~0.45 s and each page change takes
~0.5 s; a search shows its result ~0.5 s after typing stops; Scenarios in ~0.7 s; the request log (500 rows) in ~0.7 s.

What this means:

- **Up to ~10,000 mocks** everything answers well under 300 ms. *My mocks* stays at a
  few milliseconds at any size.
- **Past ~10,000**, the views that read every mock (*All mocks*, search, a tag filter, Scenarios, export, scripts calling
  `GET /api/mocks` without `limit`) cost ~7–10 ms per 1,000 mocks and run one at a time on the server's single thread,
  so concurrent users wait for each other: five people opening *All mocks* at once at 20,000 mocks wait up to ~0.9 s.
  The Scenarios page asks again every 2 s while it is open.
- **Imports, boots and re-syncs grow faster than linearly**: each imported mock is a separate WireMock call, and the
  boot sync re-sends every stub. Expect about a minute to import 20,000 mocks (two with Redis) and ~15–20 s before a
  restarted UI or WireMock is serving every mock again.
- **WireMock itself** slows with the number of stubs: it compares a request with every stub, so a matched request
  takes ~12 ms and an unmatched one ~95 ms at 20,000. Give its JVM 2–3 GB of memory for 10,000 mocks or more.

Run it yourself (needs Docker; uses ports 3400–3402 and its own containers, removed at the end):

```sh
node scripts/load-test.mjs --sizes 1000,10000,20000 --driver sqlite,redis,none
node scripts/load-test.mjs --sizes 20000 --serve   # seeds, then keeps running for a look in the browser
```

`--runs` (10) and `--wm-requests` (200) set the sample sizes; the table above used 20 and 500. Every option is described at the
top of the script.

## Troubleshooting

**The UI exits on start with "WireMock admin API answers without auth".** WireMock was started without `--admin-api-basic-auth`. The UI refuses to run against an open admin API. Add the flag (Compose already does) and set the same credentials in `WIREMOCK_ADMIN_USER` / `WIREMOCK_ADMIN_PASSWORD`.

**"WireMock admin API requires credentials" or "WireMock admin credentials rejected".** The UI's `WIREMOCK_ADMIN_USER` / `WIREMOCK_ADMIN_PASSWORD` are missing or do not match WireMock's flag.

**"WireMock unreachable at …".** Check `WIREMOCK_URL` and that WireMock is running. The UI waits `BOOT_TIMEOUT_SECONDS` before it gives up.

**"Invalid configuration: …".** A required variable is missing or has a bad value; the message names it.

**Port already in use** (`Bind for 0.0.0.0:3000 failed: port is already allocated`). Set `UI_PORT` and/or `WIREMOCK_PORT` in `.env` and run `up` again. From source, set `PORT`.

**Sign-in says "Too many sign-in attempts".** After 10 failed attempts in 15 minutes from one IP, every attempt from that IP is refused until the window ends. Behind a proxy, set `TRUST_PROXY=true` so each client gets its own limit.

**A mock is missing from WireMock.** The UI checks every `SYNC_INTERVAL_SECONDS` and puts it back. `GET /healthz` shows `lastSyncError` if syncing fails.

### Resetting a password

- Anyone who can sign in can reset another person's password on the **Users** page (**Reset password**).
- You can change your own from the account menu (**Change password**).
- If nobody can sign in, set a new password from a shell on the server with `wiremock-ui reset-password <username>` (below). Nothing else changes; the account is signed out everywhere.

### The wiremock-ui command

Account commands run from a shell where the UI runs: both images have `wiremock-ui` on the `PATH`. It uses the server's own store settings (`STORE_DRIVER`, `REDIS_URL`, `SQLITE_PATH`), works while the server runs, and needs no restart. It is not available over HTTP: being able to run it on the server is the permission.

```sh
docker exec -it wiremock-ui wiremock-ui create-admin            # asks for a username and a password (typed twice)
docker exec -it wiremock-ui wiremock-ui reset-password admin    # asks for the new password; signs the account out
docker exec wiremock-ui wiremock-ui list-users
```

- **`create-admin`** makes an account: the first one when `ADMIN_USER` / `ADMIN_PASSWORD` are not set, or another one. `--username <name>` skips that question.
- **`reset-password <username>`** sets a new password and signs the account out everywhere. `--enable` also enables a disabled account.
- **`list-users`** lists the accounts and whether each is active.
- **Scripts:** `--password-stdin` reads the password from stdin instead of asking (use `docker exec -i`, without `-t`):
  `printf '%s\n' "$PASSWORD" | docker exec -i wiremock-ui wiremock-ui create-admin --username admin --password-stdin`
- With Compose: `docker compose exec ui wiremock-ui create-admin`. From a source checkout, after `npm run build`: `npm run cli -- create-admin` (reads `.env`).
- Until the first account exists, the sign-in page and the log show the command. In WireMock-only mode (`STORE_DRIVER=none`) accounts live in memory, so the command cannot change them and `ADMIN_USER` / `ADMIN_PASSWORD` are required.
