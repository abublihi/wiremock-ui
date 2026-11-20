---
title: Storage and WireMock-only mode
order: 13
routes:
summary: Where mocks are kept (SQLite, Redis, or nowhere but WireMock) and what changes in each mode.
---

# Storage and WireMock-only mode

## What it is

wiremock-ui keeps the real copy of every mock, integration, account, history entry and audit entry in a **store**. There are three choices, set with `STORE_DRIVER`:

| Store | When | Good for |
|---|---|---|
| **SQLite** | the default when `REDIS_URL` is not set | one UI instance, a file on a volume |
| **Redis** | the default when `REDIS_URL` is set | several UI instances sharing the data |
| **None** (WireMock-only mode) | only when `STORE_DRIVER=none` is set | looking at and editing the stubs a WireMock already has |

## What it does in WireMock

With SQLite or Redis, WireMock holds a working copy the UI can rebuild at any time; the UI puts mocks back after a WireMock restart (see [Sync with WireMock](sync.md)). In WireMock-only mode **WireMock is the store**: the mock list is WireMock's own stubs, read live, and your edits go straight into it. Stubs made outside the UI show up owned by `wiremock` and can be edited like any other.

## How to

Check which mode you are in: in WireMock-only mode the Users page is gone, the Mocks page has no **My mocks / All mocks** switch, and the Integrations page says integration changes are kept in memory.

In WireMock-only mode:

- there is one account (`ADMIN_USER`), no **Users** management, no **History** or restore, no **Reset my mocks**;
- integrations live in memory and are lost on restart: put them in a `SEED_PATH` file, or export a bundle to keep them;
- the request log, test panel, curl, proxies, webhooks, scenarios, recording, import and export work as usual; pruning baseline mocks on import is not offered;
- nothing is synced: the UI never deletes or re-adds stubs behind your back.

## Tips and limits

- To move from WireMock-only mode to a stored setup, start the UI with SQLite or Redis against the same WireMock: on that first start it adopts every stub WireMock has.
- SQLite: keep the file on a volume and run **one** UI instance per file. Redis: run it with persistence.
- Installation: `docs/INSTALL.md` in the repository; every setting: the Configuration reference in the repository's `README.md`.
