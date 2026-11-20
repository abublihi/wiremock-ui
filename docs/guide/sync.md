---
title: Sync with WireMock
order: 14
routes:
summary: How the UI keeps WireMock equal to its store, survives WireMock restarts, and adopts existing stubs.
---

# Sync with WireMock

## What it is

With a store (SQLite or Redis), wiremock-ui is the source of truth and WireMock is a working copy. **Sync** keeps the two equal, so your mocks survive a WireMock restart without anyone re-creating them.

## What it does in WireMock

- **Saving** a mock pushes that one stub into WireMock first (WireMock checks it), then stores it. If the store write fails, WireMock is rolled back.
- **The marker stub.** The UI keeps a hidden stub in WireMock, `GET /__wiremock-ui/marker`. Every `SYNC_INTERVAL_SECONDS` (5 by default) it checks the marker is still there. When it is gone, WireMock has restarted or been reset.
- **Full sync.** Then, at start-up, and every 10 minutes as a safety net, the UI imports every stored mock into WireMock in batches, deletes stubs WireMock has that the store does not, and puts the marker back last. WireMock is never emptied, so live traffic keeps matching during a sync.
- **Adoption.** The very first time the UI starts with an empty store, it **adopts** the stubs WireMock already serves instead of deleting them: they keep their ids and show up owned by `wiremock`.

```stub
{
  "id": "5e1f0000-0000-4000-8000-00000000c0de",
  "name": "wiremock-ui marker",
  "request": { "method": "GET", "urlPath": "/__wiremock-ui/marker" },
  "response": { "status": 204 }
}
```

## How to

Nothing to do. To check it, `GET /healthz` (no sign-in) shows `lastSyncAt` and `lastSyncError`. The audit log records the first sync after start-up and any sync caused by WireMock losing its mocks, as `sync` by `system`.

## Tips and limits

- After adoption the store is the source of truth: stubs added to WireMock behind the UI's back are removed by the next full sync. Add them through the UI or an import instead.
- The request log and scenario states live only in WireMock's memory and are not synced: a WireMock restart clears the log and resets every scenario to `Started`.
- WireMock-only mode has no sync at all (see [Storage and WireMock-only mode](storage.md)).
