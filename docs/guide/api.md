---
title: Scripts and the API
order: 15
routes:
summary: Everything the UI does is a REST call under /api: drive it from CI with HTTP Basic auth.
---

# Scripts and the API

## What it is

Everything the UI does goes through a REST API under `/api`. Scripts and CI use HTTP Basic auth with a normal account; no CSRF token is needed. Create a dedicated account for CI on the [Users](/users) page.

## What it does in WireMock

The same as the UI: every write goes through the UI's server, which checks it, pushes it into WireMock and stores it. Do not write to WireMock's admin API directly when a store is used: the next full sync removes stubs the store does not know (see [Sync with WireMock](sync.md)).

## How to

```sh
UI=http://localhost:3000
AUTH=ci-bot:its-password
JSON='Content-Type: application/json'

# An integration and an endpoint. PUT creates or replaces; add If-None-Match: * to only create
curl -u $AUTH -X PUT $UI/api/integrations/blog -H 'If-None-Match: *' -H "$JSON" -d '{"name":"Blog API","prefix":"/blog"}'
curl -u $AUTH -X PUT $UI/api/integrations/blog/endpoints/get-post -H "$JSON" -d '{
  "name": "Get post", "method": "GET", "path": "/posts/{id}", "pathType": "template",
  "lookup": { "location": "path", "expression": "id" },
  "contentType": "json", "allowedStatuses": [200, 404],
  "exampleResponses": { "200": "{\"id\":42,\"title\":\"Hello\"}", "404": "{\"error\":\"post not found\"}" }
}'

# Simple-mode mocks: a key mock and a default mock
curl -u $AUTH -X POST $UI/api/integrations/blog/endpoints/get-post/mocks -H "$JSON" \
  -d '{"keyValue":"42","status":200,"body":"{\"id\":42,\"title\":\"Hello\"}"}'
curl -u $AUTH -X POST $UI/api/integrations/blog/endpoints/get-post/mocks -H "$JSON" \
  -d '{"isDefault":true,"status":404,"body":"{\"error\":\"post not found\"}"}'

# A quick URL mock ("Mock a URL directly"): build the stub (urlType path | template | regex), then save it as below
curl -u $AUTH -X POST $UI/api/mocks/preview -H "$JSON" \
  -d '{"request":{"method":"GET","urlType":"template","url":"/orders/{orderId}"},"status":200,"body":"ok"}'

# Raw WireMock stubs
curl -u $AUTH -X POST $UI/api/mocks -H "$JSON" \
  -d '{"request":{"method":"GET","urlPath":"/hello"},"response":{"status":200,"body":"hi"}}'
curl -u $AUTH "$UI/api/mocks?owner=me"          # yours; no owner = all, owner=baseline = baseline
curl -u $AUTH "$UI/api/mocks?scenario=order-status" # one scenario's mocks; scenario=* every mock in a scenario
curl -u $AUTH "$UI/api/mocks?limit=50&offset=50" # one page: {items,total,totalMocks,baseline,offset,limit}
# update and delete need the current version (from the create or list response)
curl -u $AUTH -X PUT $UI/api/mocks/<id> -H "$JSON" \
  -d '{"version":1,"stub":{"request":{"method":"GET","urlPath":"/hello"},"response":{"status":200,"body":"hello again"}}}'
curl -u $AUTH -X DELETE "$UI/api/mocks/<id>?version=2"

# History, restore and duplicate
curl -u $AUTH $UI/api/mocks/<id>/history
curl -u $AUTH -X POST $UI/api/mocks/<id>/restore -H "$JSON" -d '{"version":1}'
curl -u $AUTH -X POST $UI/api/mocks/<id>/duplicate

# Check what your application sent
curl -u $AUTH "$UI/api/requests?matched=false&limit=20"
curl -u $AUTH $UI/api/requests/<request-id>/near-misses
curl -u $AUTH -X POST $UI/api/requests/count -H "$JSON" \
  -d '{"pattern":{"method":"GET","urlPath":"/blog/posts/42"}}'
# {"count":2}

# Send a test request to WireMock through the UI (stub port only; /__admin and other hosts are refused)
curl -u $AUTH -X POST $UI/api/test-request -H "$JSON" \
  -d '{"method":"GET","path":"/blog/posts/42"}'
# {"status":200,"headers":{…},"body":"…","bodyIsBase64":false,"bodyTruncated":false,"durationMs":12,"matchedStubId":"<mock id>"}

# Scenarios: live state, move one to a state, reset one or all
curl -u $AUTH $UI/api/scenarios
curl -u $AUTH -X PUT $UI/api/scenarios/order-status/state -H "$JSON" -d '{"state":"shipped"}'
curl -u $AUTH -X POST $UI/api/scenarios/reset -H "$JSON" -d '{"name":"order-status"}'   # or {} for all

# Record: start (target and filters), stop (returns the review list), accept rows from it
curl -u $AUTH -X POST $UI/api/recordings/start -H "$JSON" -d '{"targetUrl":"https://api.test.example","urlPathPattern":"/api/*"}'
curl -u $AUTH -X POST $UI/api/recordings/stop      # {"recording":{"id":"<list id>","items":[{"id":"<row id>",…}],…}} or {"recording":null,"empty":{…}}
curl -u $AUTH -X POST $UI/api/recordings/<list id>/accept -H "$JSON" -d '{"items":[{"id":"<row id>","name":"Get user"}]}'
curl -u $AUTH -X POST $UI/api/recordings/snapshot -H "$JSON" -d '{"method":"GET"}'   # from the request log instead

# Clean up after a run
curl -u $AUTH -X POST $UI/api/mocks/reset-mine      # {"deleted":4}
curl -u $AUTH -X DELETE $UI/api/requests            # clear the request log

# Import a bundle (add ?prune=true to remove baseline mocks missing from it)
curl -u $AUTH -X POST $UI/api/import -H "$JSON" --data-binary @bundle.json

# Export: scope=all|integration|mine (integration=<key> with scope=integration), format=bundle|mappings
curl -u $AUTH -OJ "$UI/api/export?scope=all&format=bundle"                       # wiremock-ui-all-<date>.json
curl -u $AUTH -OJ "$UI/api/export?scope=integration&integration=blog&format=mappings"  # a zip of mappings/*.json
```
## Tips and limits

A stale `version` on update or delete answers `409` (`changed by someone else`). Other useful endpoints: `GET /api/audit?limit=100` (paged with `cursor`; filter with `actor`, `action` — an action or its group, such as `mock` — and `from` / `to` days in UTC, `2026-11-20`), `GET|POST /api/users`, `GET /healthz` (no auth).

**Browser sessions** (for tools that cannot use Basic auth): `POST /api/session` with `{"username","password"}` sets an HttpOnly `wmui_session` cookie and returns `{ user, csrfToken }`. Send the token as `X-CSRF-Token` on every `POST`, `PUT`, `PATCH` and `DELETE`; `DELETE /api/session` signs out.

```sh
curl -c jar -X POST $UI/api/session -H "$JSON" -d '{"username":"sara","password":"…"}'
# {"user":{…},"csrfToken":"<token>"}
curl -b jar -X POST $UI/api/mocks/reset-mine -H 'X-CSRF-Token: <token>'
```

### Good to know

- **Accounts:** `POST /api/users` takes `username`, `password` and an optional `displayName`. `POST /api/session/password` with `{ "current", "next" }` changes your own password. Resetting your own password through `/api/users` keeps the session you did it from and ends your other sessions.
- **Rate limit:** browser sign-in and Basic auth share one limit of 10 failed attempts per 15 minutes per client IP; after that every attempt from that IP gets `429`, even with the right password, until the window ends. No `WWW-Authenticate` challenge is sent, so browsers never pop up a login dialog.
- **Cookies** are `Secure` when `PUBLIC_UI_URL` is https, or when `TRUST_PROXY` is on and the proxy sends `X-Forwarded-Proto: https`.
- **Create-only integration writes:** `PUT /api/integrations/<key>` and `PUT /api/integrations/<key>/endpoints/<endpoint>` replace what is there. Send `If-None-Match: *` to create only: when the key already exists the answer is `409` (`An integration with this key already exists` / `An endpoint with this key already exists`) and nothing changes. The UI uses this when you add an integration or an endpoint, so two people adding the same key cannot overwrite each other.
- **Integrations:** endpoints with `pathType: regex` are matched by WireMock, so the pattern uses Java's regex dialect; the UI only checks that it parses as a JavaScript regex. An endpoint cannot be deleted while mocks built from it exist, and an integration cannot be deleted while it has mocks (`409`).
- **Imports** over 10 MB get `413`. The API takes one JSON body; merging files, folders and zips happens in the browser.
- **Export** (`GET /api/export`) answers with `Content-Disposition: attachment`: a JSON bundle (`application/json`) or, with `format=mappings`, a zip (`application/zip`) of `mappings/<name>-<id>.json`. `scope` defaults to `all` and `format` to `bundle`; an unknown value, or `scope=integration` without `integration`, is `400`, an unknown integration `404`. Integrations and endpoints come without `updatedAt`/`updatedBy`, so a bundle imports as it is.
- **Binary bodies:** `response.base64Body` must be standard base64 with padding (`400 response.base64Body must be valid base64` otherwise). Simple-mode mocks take `base64Body` (with `headers: { "Content-Type": … }`, else `application/octet-stream`) instead of `body`; both together are `400`.
- **Test requests** (`POST /api/test-request`) go only to `WIREMOCK_URL`'s stub port, without WireMock's admin credentials, and never follow redirects. Paths must start with `/`; absolute URLs, `/__admin`, `.`/`..` segments and encoded slashes are refused (`400`). `Host`, `Content-Length` and hop-by-hop headers are dropped; line breaks or characters beyond Latin-1 in header values are refused. `Accept-Encoding: identity` is sent unless you set it, so the headers shown describe the body. Bodies are limited to 1 MB each way (a longer response comes back cut, with `bodyTruncated: true`); binary responses come back base64 (`bodyIsBase64: true`). The relay waits 30 s.
- **Proxy mocks** (`response.proxyBaseUrl`) need an http(s) base URL; `proxyUrlPrefixToRemove` starts with `/`. `removeProxyRequestHeaders` is stored lower-cased, because WireMock 3.13.1 only removes headers listed that way.
- **Webhooks** (`serveEventListeners: [{ "name": "webhook", "parameters": { method, url, headers, body, delay } }]`) are sent by WireMock, from wherever WireMock runs, after it answers: a URL like `http://localhost:…` means WireMock's own machine. The method is any HTTP method (stored upper-case); the URL must start with `http://` or `https://` (the rest may be a template); `delay` is `{ "type": "fixed", "milliseconds" }`, `{ "type": "uniform", "lower", "upper" }` or `{ "type": "lognormal", "median", "sigma" }`, at most 600000 ms.
- **Scenarios:** `GET /api/scenarios` lists every `scenarioName` used by a mock, its states and WireMock's live state. WireMock 3.13.1 cannot change the state of a scenario whose name contains spaces, `;` or other characters that need URL encoding, or starts with `.` (`settable: false`); only resetting all scenarios reaches those. A WireMock restart puts every scenario back to `Started`.
- **Paging the mock list:** `GET /api/mocks` without `limit` returns a plain array of every matching mock, as before. With `limit` (1–200) and an optional `offset` (default 0) it returns `{ items, total, totalMocks, baseline, offset, limit }`. Paging counts **rows**: a mock is one row, and a scenario (all its matching mocks) is one row placed where its newest mock is. So `total` is the number of rows, `totalMocks` the number of matching mocks, `baseline` how many of those are baseline, and a page holds more than `limit` mocks when it holds a scenario. Rows are filtered first, then sorted newest change first (ties by id). An `offset` past the end gives `items: []`. A bad `limit` or `offset`, or `offset` without `limit`, is `400`.
- **Sync:** the first sync after start-up, and any sync caused by WireMock losing its mocks (a restart or reset), are recorded in the audit log as `sync` by `system`.
- **Recording filters:** `urlPathPattern` is read as a wildcard (`/api/*`; `*` is anything; a `?query` part is left out) unless it uses regex-only syntax (`.*`, `.+`, `\`, a leading `^`, a trailing `$`, `[`, `(`, `|`, `{n}`); `urlPathMode: "wildcard" | "regex"` overrides the guess. A regex with a query string, or one that starts with a plain letter or digit instead of `/`, is refused (`400`) with a suggested fix. When a stop or snapshot records nothing, the answer is `{ "recording": null, "empty": … }`: `{ "reason": "filtered", "requests", "filters" }` when requests went through but the filters left them out, `{ "reason": "noTraffic", "wiremockUrl" }` when none arrived.
