# wiremock-ui

A web console for [WireMock](https://wiremock.org) built for testers. Describe the systems your application calls as integrations, create mocks in a few clicks (or as raw stub JSON), point your application at WireMock, and see every request it received, with a plain explanation of why a request matched no mock.

![The mocks list](docs/screenshots/mocks-dark.png)

- **Integrations**: the systems your application calls. Each **integration** (NIC at `/nic`) has **endpoints** (`POST /nic/citizens/fetch`, key `$.idNo`), and each **mock** answers one key value. The Integrations page explains this in one glance.
- **Simple mode** builds a mock from an integration endpoint: a key value, a status preset and a body prefilled from the endpoint's example. **Mock a URL directly** does the same for a method and URL without an integration. **Advanced mode** edits the full stub JSON.
- **Test a mock** from the editor (or **Try it** on an endpoint) and see which mock answered; **Copy as curl** for any mock or logged request.
- **Forward to a real service** (proxy), **call back after responding** (webhooks) and **scenarios** ("pending" first, "approved" after), built step by step on one page, with a live state view.
- **Request log** updates live and stamps unmatched requests **No match**, with the closest mocks and the fields that differed.
- **History and restore** for every mock, conflict detection when two people edit the same one, an **audit log** of every change.
- **Import** bundles or WireMock exports, and seed baseline mocks on start.
- **Import a Postman collection** (v2.0/v2.1): each request becomes an endpoint and each saved example a mock, with a preview to pick the default answer and settle key clashes.
- **Durable:** mocks live in the UI's store (a SQLite file, or Redis) and are put back into WireMock after it restarts.
- A REST API with Basic auth for scripts and CI.

> **Test environments only. No real personal data.** Mocks, request payloads and stored values are not protected like production data. WireMock serves stubs and its admin API on the same port: the UI always runs it with admin auth, but do not expose WireMock's port beyond the test network.

## Quick start

Needs Docker. No Redis required.

```sh
git clone <this repository> wiremock-ui && cd wiremock-ui
cp .env.example .env          # set the passwords and SESSION_SECRET
docker compose -f compose.sqlite.yaml up -d --build
# open http://localhost:3000, sign in with ADMIN_USER / ADMIN_PASSWORD; WireMock is on :8080
```

Other ways to run it: with Redis, from source, or **against a WireMock you already have, storing nothing** (`STORE_DRIVER=none`, view and edit WireMock's own stubs): see [Installing](docs/INSTALL.md#run-against-an-existing-wiremock-no-storage).

## Documentation

- [Installing](docs/INSTALL.md): the ways to run it (Compose without Redis, Compose with Redis, from source, or against an existing WireMock with no storage), every setting, Kubernetes, backups, upgrades and troubleshooting.
- [Using it](docs/USAGE.md): the concepts (integration → endpoint → mock), a walkthrough from integrations to the request log, testing and curl, proxies, webhooks, scenarios, WireMock-only mode, Advanced mode and history, users and audit, import from files and Postman collections, export, seeding, and the API for scripts and CI.

## Development

```sh
npm ci --ignore-scripts
npm run dev                 # needs WireMock reachable per .env; Redis only if REDIS_URL is set
                            # on Node 22.12 run it as NODE_OPTIONS=--experimental-sqlite npm run dev (see docs/INSTALL.md)
npm test                    # needs Docker: store tests run against Redis and SQLite
npm run test:e2e            # builds, then runs the Playwright specs (needs Docker; npx playwright install chromium once)
./scripts/e2e-restart.sh    # Compose check that stubs survive a WireMock restart (with Redis)
./scripts/e2e-sqlite.sh     # the same without Redis, on the SQLite volume
npm run typecheck
npm run build && npm start
```

`npm run test:e2e` starts its own stack: a WireMock container with admin auth (through Testcontainers) and the built app on a temporary SQLite file at http://127.0.0.1:3417 (`E2E_UI_PORT` changes the port), seeded from `tests/fixtures/e2e-seed/`. It covers the tester's flow from integrations to the near-miss explanation, two people editing each other's mocks, the test panel and a curl command run in a shell, Try it, a scenario (and one made with the scenario builder and run step by step in the test panel), a proxy mock, adding an endpoint on its page, a fresh install going from New mock to an integration, an endpoint and a mock, and an axe-core accessibility pass in light and dark themes.

The restart scripts use host ports 8080 and 3000; set `WIREMOCK_PORT` and `UI_PORT` to use others.

## Licence

MIT. See [LICENSE](LICENSE).
