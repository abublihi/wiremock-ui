# Installing wiremock-ui

wiremock-ui runs next to a WireMock 3 server. The UI keeps every mock in its own store and pushes it into WireMock, so mocks survive a WireMock restart. This page covers running it, configuring it and keeping it healthy. For how to use it day to day, see [USAGE.md](USAGE.md).

> **Test environments only.** Never put real personal data in a mock, a request or a stored value.

## Requirements

- **Docker** with Docker Compose v2 (`docker compose`). That is all you need for the two Compose setups below.
- **To run from source:** Node.js 22.12 or later, plus Docker (or any other way) to run WireMock 3.13.
- **Redis is optional.** Without `REDIS_URL` the UI stores everything in one SQLite file. Use Redis only if you want to run several UI instances against the same data.

## Ways to run it

### 1. Docker Compose without Redis (recommended quick start)

UI + WireMock; the UI keeps its data in a SQLite file on the `ui-data` volume.

```sh
git clone <this repository> wiremock-ui && cd wiremock-ui
cp .env.example .env     # set the passwords and SESSION_SECRET (see the table below)
docker compose -f compose.sqlite.yaml up -d --build
```

Open http://localhost:3000 and sign in with `ADMIN_USER` / `ADMIN_PASSWORD` from `.env`. WireMock answers your application on http://localhost:8080.

Check that everything is up:

```sh
curl http://localhost:3000/healthz
# {"ui":"ok","store":"ok","wiremock":"ok","lastSyncAt":"…","lastSyncError":null}
```

Stop it with `docker compose -f compose.sqlite.yaml down` (add `-v` to also delete the data volume).

### 2. Docker Compose with Redis

The same, plus a Redis container with append-only persistence (`redis-data` volume):

```sh
cp .env.example .env
docker compose up -d --build
```

Compose sets `WIREMOCK_URL` and `REDIS_URL` for the UI; everything else comes from `.env`.

### 3. From source

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

**Pointing it at a WireMock that already has stubs.** On a first start (a store with no mocks yet) the UI adopts every stub WireMock already serves. They keep their ids, show up in the mocks list owned by `wiremock` (or by the owner a stub's wiremock-ui metadata already names), and stay in WireMock exactly as they are. The UI records that adoption is pending before it starts; if that first start stops part-way, the next start finishes the job, and until then no sync deletes anything from WireMock. From then on the UI's store is the source of truth, so stubs added to WireMock behind the UI's back are removed by the next full sync. To only view and edit WireMock's own stubs without a store, see [Run against an existing WireMock (no storage)](#run-against-an-existing-wiremock-no-storage).

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
- **Integrations, the audit log (last 500 entries) and sign-in sessions live in memory** and are gone after a restart (everyone signs in again). `SEED_PATH` still loads integrations on every start; its mocks are written into WireMock. `SEED_PRUNE` is ignored (with a warning in the log) and the Import page offers no prune (the API answers 400): the UI never deletes stubs from your WireMock in bulk.
- **Edits made while WireMock is down fail** (there is no copy to fall back to), and a WireMock restart keeps only what WireMock itself persists: a stub that came from WireMock's `mappings` folder stays persistent when you edit it; mocks you create in the UI are not written to WireMock's files.
- **Two people saving the same mock at the same moment**: the version check catches most conflicts, but two saves within the same instant can both land (the later one wins).

To move to a stored setup later, start the UI with `sqlite` or `redis` against the same WireMock: on that first start it adopts every stub WireMock has (see above).

## Configuration

Everything is set through environment variables. Empty values count as unset.

| Variable | Default | What it does |
| --- | --- | --- |
| `ADMIN_USER` | required | Username of the first account, created on the first start when there are no accounts yet. Changing it later does nothing. |
| `ADMIN_PASSWORD` | required | Password of that first account (8–72 characters). Changing it later does nothing; see [Resetting a password](#resetting-a-password). |
| `SESSION_SECRET` | required | Secret for browser sessions. Use a long random string, for example `openssl rand -hex 32`. |
| `WIREMOCK_URL` | `http://localhost:8080` | Where the UI reaches WireMock. Compose sets it to `http://wiremock:8080`. |
| `WIREMOCK_PUBLIC_URL` | `WIREMOCK_URL` | Where your applications and testers reach WireMock's stub port, for example `http://localhost:8080` when `WIREMOCK_URL` is a Compose-internal name. Only used to show curl commands; the UI never calls it. |
| `WIREMOCK_ADMIN_USER` | (none) | WireMock admin API username. Set it together with the password. |
| `WIREMOCK_ADMIN_PASSWORD` | (none) | WireMock admin API password. Compose passes both to WireMock's `--admin-api-basic-auth`, so they are required there. |
| `STORE_DRIVER` | `redis` when `REDIS_URL` is set, otherwise `sqlite` | `sqlite`, `redis`, or `none` to work on WireMock's own stubs without storing anything (see [Run against an existing WireMock (no storage)](#run-against-an-existing-wiremock-no-storage)). `none` is never picked for you. |
| `REDIS_URL` | (none) | Redis connection URL, for example `redis://redis:6379`. Only needed for `redis`. |
| `SQLITE_PATH` | `./data/wiremock-ui.db` (`/data/wiremock-ui.db` in the image) | The SQLite file. Its folder is created on start. |
| `SYNC_INTERVAL_SECONDS` | `5` | How often the UI checks that WireMock still has every mock (for example after a WireMock restart) and puts back what is missing. |
| `BOOT_TIMEOUT_SECONDS` | `60` | How long the UI waits for WireMock and the store on start before giving up. |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy, so the client IP for the sign-in rate limit comes from `X-Forwarded-For` (the rightmost hop). Leave it off without a proxy. |
| `PUBLIC_UI_URL` | (none) | The address people use to reach the UI, for example `https://mocks.example.com`. An `https` URL makes session cookies `Secure`. |
| `SEED_PATH` | (none) | A bundle file or a folder of `*.json` files to import as baseline mocks on every start. See [USAGE.md](USAGE.md#bundle-files-and-seeding-baseline-mocks). |
| `SEED_PRUNE` | `false` | With `SEED_PATH`: also delete baseline mocks that are no longer in the seed. People's own mocks are never touched. Ignored with `STORE_DRIVER=none`. |
| `RECORDING_ALLOWED` | `true` | `false` turns recording and "create mocks from the request log" off on this environment: the Recording page is hidden and the API answers 403. See [Record real traffic](USAGE.md#record-real-traffic). |
| `PORT` | `3000` | Port the UI listens on. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`. Logs are JSON lines on stdout. |

Compose-only variables (read from `.env` by the compose files):

| Variable | Default | What it does |
| --- | --- | --- |
| `UI_PORT` | `3000` | Host port for the UI. |
| `WIREMOCK_PORT` | `8080` | Host port for WireMock. |

### How the stores compare

Both stores keep the same data and behave the same: accounts and sessions, the sign-in rate limit, mocks with their history (last 20 versions, kept 7 days after a delete), integrations and the 30-day audit log.

- **SQLite** uses Node's built-in `node:sqlite` (no native build) in one file in WAL mode. Keep the file on a volume and run **one** UI instance per file.
- **Redis** lets several UI instances share the data. Run it with persistence (`--appendonly yes`, as `compose.yaml` does).

## Kubernetes

Run the UI and WireMock as two containers in **one pod**:

- WireMock listens on 8080 inside the pod. Do not expose it outside the test network: its admin API shares that port. Start it with `--admin-api-basic-auth <user>:<password>` (from a Secret) and `--max-request-journal-entries 5000`.
- The UI container sets `WIREMOCK_URL=http://localhost:8080`, the same admin credentials, `ADMIN_USER`, `ADMIN_PASSWORD` and `SESSION_SECRET` (Secrets), and exposes port 3000 through a Service/Ingress.
- With SQLite, mount a PersistentVolumeClaim at `/data` and keep `replicas: 1`. For more replicas, point `REDIS_URL` at a Redis with persistence.
- Behind an Ingress set `TRUST_PROXY=true` and `PUBLIC_UI_URL=https://…`.
- Baseline mocks: put bundle or WireMock mapping files in a ConfigMap, mount it as a folder and set `SEED_PATH` to that folder. ConfigMap symlinks are followed. Add `SEED_PRUNE=true` if removing a file from the ConfigMap should remove its mocks.
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
- If nobody can sign in, delete the accounts; the next start creates the first account again from `ADMIN_USER` / `ADMIN_PASSWORD`. Mocks, integrations and the audit log stay.

  SQLite (Compose):

  ```sh
  docker compose -f compose.sqlite.yaml exec ui node --experimental-sqlite --disable-warning=ExperimentalWarning \
    -e "new (require('node:sqlite').DatabaseSync)(process.env.SQLITE_PATH).exec('DELETE FROM sessions; DELETE FROM users')"
  docker compose -f compose.sqlite.yaml restart ui
  ```

  Redis (Compose):

  ```sh
  docker compose exec redis sh -c "redis-cli --scan --pattern 'user:*' | xargs -r redis-cli del; \
    redis-cli --scan --pattern 'users:*' | xargs -r redis-cli del; \
    redis-cli --scan --pattern 'session:*' | xargs -r redis-cli del"
  docker compose restart ui
  ```
