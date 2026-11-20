---
title: Recording and snapshots
order: 10
routes: /recording
summary: Turn a real service's answers (or requests already in the log) into mocks, after you review them.
---

# Recording and snapshots

## What it is

**Recording** puts WireMock between your app and a real service: it forwards every request and remembers the answers. When you stop, you get a **review list** of recorded requests; the ones you accept become normal mocks. A **snapshot** does the same with requests already in the request log.

## What it does in WireMock

WireMock's record API (`/__admin/recordings/start`, `stop`, `snapshot`). While recording, WireMock adds one proxy stub that forwards **every** request to the target. Stopping turns what it saw into stub mappings; the UI keeps them in the review list and removes them from WireMock right away, so nothing answers until you accept it. A recorded request becomes a stub like:

```stub
{
  "name": "GET /api/Products",
  "request": { "method": "GET", "urlPath": "/api/Products", "queryParameters": { "limit": { "equalTo": "3" } } },
  "response": { "status": 200, "headers": { "Content-Type": "application/json" }, "jsonBody": [ { "id": 1 } ] }
}
```

## How to

1. [Open Recording →](/recording). Enter the **Target URL**, the real service's base URL (`https://api.test.example`; `http` or `https`, not WireMock itself and not this app).
2. Optionally narrow which requests become mocks: a **Method**, and **Paths to record**. Use `*` for anything: `/api/*` or `/api/Products*`. The query string is not part of the path, so `/api/Products?limit=3` records `/api/Products` (the page says it left `?limit=3` out). A regular expression such as `/api/.*` is recognised and sent as is; **Read as** overrides the guess. The line under the field shows what will be matched.
3. **Start recording**. Every page shows a banner, "Recording traffic to …", with **Stop**.
4. Point your app (or curl) at **WireMock**, not at the real service, and use it as usual.
5. **Stop** opens the review list: one row per request with its method, URL, status, size and recorded answer. Rows an existing mock already answers are marked **Duplicate of …**. Name rows, link them to an integration and endpoint if you like, then **Accept N selected** (as your mocks, or as baseline). **Discard** drops rows.

**From the request log.** The **From the request log** tab, or **Create mocks from these** on the Request log, makes a review list from requests WireMock already logged, including ones a mock answered.

### Nothing was recorded?

The message after **Stop** says which of these it was:

- **"N requests went through the recording but none matched your filters."** Your **Method** or **Paths to record** left them out. Common cause: a pattern with a query string (`/api/Products?limit=3` as a regex) or `/api/*` read as a regex. Clear the filters, or use `/api/*` with **Read as** set to **Auto** or **Wildcard**, and record again.
- **"No requests reached WireMock while recording."** Your app (or curl) still called the real service. Point it at WireMock's address, the one shown on the Recording page, and record again.

## Tips and limits

- Nothing is a mock until you accept it. An unaccepted review list is deleted after **24 hours**; a list holds at most 1000 rows or 20 MB, and a body over 1 MB is marked **Too large to review**.
- While recording, only mocks with priority 1–4, and mocks with the default priority saved after the recording started, still answer themselves; everything else is forwarded.
- **Real data:** recorded bodies and headers come from the real service. Open each row's answer and leave out anything sensitive before accepting; accepted mocks are visible to everyone.
- `RECORDING_ALLOWED=false` turns recording off on an environment (the page disappears).
