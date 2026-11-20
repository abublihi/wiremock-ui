---
title: Request log and near misses
order: 6
routes: /requests
summary: Everything WireMock received, which mock answered, and why a request matched nothing.
---

# Request log and near misses

## What it is

The **Request log** lists the requests WireMock received, newest first, with the mock that answered each one. A request no mock matched gets the amber **No match** stamp. The sidebar shows how many requests matched nothing in the last 15 minutes.

## What it does in WireMock

It reads WireMock's **request journal** (kept in WireMock's memory, not by the UI). For an unmatched request it asks WireMock for **near misses**: the stubs that came closest, with what each expected and what the request had.

## How to

**Why didn't my mock match?**

1. [Open the request log →](/requests) and find the request with the **No match** stamp (filter by **No match** if the log is busy).
2. Click the stamp (or the row). The drawer lists the near misses, each with a row per field it checks. The mismatched row is highlighted.
3. Read the highlighted row. Example: your app asked for `GET /blog/posts/43`, but the only mock is `Get post — 42`; its `pathParam.id` row expects `equalTo 42` and the request had `43`. Make a mock for `43`, or a default mock.
4. **Create mock from this request** starts a new mock with the request's method, path and JSON body. **Resend** opens the test panel with it.

Other tools on the page:

- Filters: result, integration, status, time range, or text in the URL or body.
- **Count calls**: how often WireMock received a method and URL path ("was it called exactly once?").
- **Pause live**: stop the 2-second refresh. **Clear log**: empty WireMock's log for everyone (mocks are not touched).
- **Create mocks from these**: turn the requests the filter shows into a review list (see [Recording and snapshots](recording.md)).

## Tips and limits

- Rows marked **Not checked** use matchers the UI cannot evaluate itself; WireMock still applies them.
- The log keeps the newest 500 requests in the page; narrow it with filters to see older ones. WireMock itself keeps a limited number (`--max-request-journal-entries`) and forgets them when it restarts.
- Common reasons for **No match**: a different key value, a missing or different `Content-Type`, a path with or without a trailing `/`, a query parameter the mock requires, or the wrong method. See [Troubleshooting](troubleshooting.md).
