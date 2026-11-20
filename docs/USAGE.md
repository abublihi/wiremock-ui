# Using wiremock-ui

The user guide lives in [`docs/guide/`](guide/), one file per feature. The same files are the in-app **Guide** (Help → Guide in the sidebar, or press `?`), and each page's **How this works** button opens its part of it, so the docs and the app never drift. Installation is in [INSTALL.md](INSTALL.md); every setting is in the README's [Configuration reference](../README.md#configuration-reference) and how it works inside in [Architecture](../README.md#architecture). To try the app with these examples already loaded, start it with `SEED_PATH=examples/seed.json` (see [INSTALL](INSTALL.md)).

> **Test environments only.** Never put real personal data in a mock.

| | Section | What it covers |
|---|---|---|
| 1 | [Getting started](guide/getting-started.md) | From nothing to a mock your app calls, in five minutes, with the Blog API example. |
| 2 | [Concepts](guide/concepts.md) | Integration, endpoint, mock, the key, baseline and "my" mocks, and which mock wins. |
| 3 | [Mocks and the editor](guide/mocks.md) | Make, edit, test and clean up mocks, in Simple or Advanced mode, or straight from a URL. |
| 4 | [Integrations and endpoints](guide/integrations.md) | Describe each system your app calls once, so anyone can make a mock for it in a few clicks. |
| 5 | [Testing and Copy as curl](guide/testing.md) | Send a request to WireMock from the UI and see which mock answered, or copy it as a curl command. |
| 6 | [Request log and near misses](guide/request-log.md) | Everything WireMock received, which mock answered, and why a request matched nothing. |
| 7 | [Scenarios and the builder](guide/scenarios.md) | The same request answered differently on later calls, like an order going pending, shipped, delivered. |
| 8 | [Proxy (forward to a real service)](guide/proxy.md) | Let a mock pass the request on to a real service and return its answer unchanged. |
| 9 | [Webhooks (call back after responding)](guide/webhooks.md) | Have WireMock send a request of its own after it answers, like the status callback your app waits for. |
| 10 | [Recording and snapshots](guide/recording.md) | Turn a real service's answers (or requests already in the log) into mocks, after you review them. |
| 11 | [Import and export](guide/import-export.md) | Bring mocks and integrations in from files, folders, zips and Postman; take them out as a bundle or WireMock mappings. |
| 12 | [Users and audit](guide/users-audit.md) | Who can sign in, and who changed what. |
| 13 | [Storage and WireMock-only mode](guide/storage.md) | Where mocks are kept (SQLite, Redis, or nowhere but WireMock) and what changes in each mode. |
| 14 | [Sync with WireMock](guide/sync.md) | How the UI keeps WireMock equal to its store, survives WireMock restarts, and adopts existing stubs. |
| 15 | [Scripts and the API](guide/api.md) | Everything the UI does is a REST call under /api: drive it from CI with HTTP Basic auth. |
| 16 | [Troubleshooting and FAQ](guide/troubleshooting.md) | The usual reasons a mock does not answer, a recording is empty, or a save is refused. |
| 17 | [Glossary](guide/glossary.md) | The WireMock and wiremock-ui words used across the app, in plain English. |

Every section has the same shape: **What it is**, **What it does in WireMock** (with the stub JSON it produces), **How to**, and **Tips and limits**. The examples use a **Blog API** (`/blog/posts`) and an **Orders API** (`/orders/{orderId}`, an order going pending → shipped → delivered).
