---
title: Glossary
order: 17
routes:
summary: The WireMock and wiremock-ui words used across the app, in plain English.
---

# Glossary

## What it is

Short definitions of the words the UI and WireMock use. The same definitions appear as tooltips the first time a term shows up on a page.

## What it does in WireMock

| Term | Meaning |
|---|---|
| **Stub** / **stub mapping** / **mapping** | WireMock's word for a mock: a request pattern plus the response to send. wiremock-ui stores one per mock. |
| **Matcher** | One rule in a stub's request pattern, such as `equalTo`, `matches` (regex), `equalToJson` or `matchesJsonPath`. A request must pass every matcher. |
| **Priority** | A number on a stub; when several stubs match, the lowest wins. Key mocks use 5, default mocks 10. |
| **Journal** / **request log** | WireMock's in-memory list of the requests it received. |
| **Near miss** | A stub that almost matched an unmatched request, with the fields that differed. |
| **No match** | WireMock found no stub for a request and answered 404. A catch-all default or proxy mock is a match, so requests it answers are not "no match". |
| **Scenario** | Several stubs sharing a `scenarioName`, answering in turn as the scenario's state changes. |
| **Scenario state** | Where a scenario is now. Every scenario starts in `Started`; a stub can require a state and move the scenario to a new one. |
| **Proxy** | A stub that forwards the request to a real service (`proxyBaseUrl`) and returns its answer. |
| **Webhook** | A request WireMock sends after answering (`serveEventListeners`). |
| **Fault** | A broken answer on purpose: an empty response, garbage, or a reset connection. |
| **Template** | A path with `{name}` segments (`/posts/{id}`), or a response body with `{{…}}` placeholders WireMock fills in. |
| **Admin API** | WireMock's `/__admin` endpoints. Only the UI's server uses them. |

| wiremock-ui term | Meaning |
|---|---|
| **Integration** | One external system your app calls, with its URL prefix (Blog API, `/blog`). |
| **Endpoint** | One operation of an integration (Get post, `GET /blog/posts/{id}`), with where its key is. |
| **Key** | The value in a request that tells one mock of an endpoint from another (the post `id`). |
| **Default mock** | The answer for every key no other mock has (priority 10). |
| **Baseline** | Mocks owned by nobody: they came from an import or a seed. A person's mock beats a baseline mock. |
| **Owner** | Who made a mock ("My mocks"). Everyone can still edit everything. |
| **Several responses** | One mock answering differently by a value in the request (`seq = 1`, `seq = 2`, any other). In WireMock: one stub per value, sharing `metadata.wiremockUi.group`. |
| **Tag** | A free-form label on a mock (`qiwa`, `sprint-42`); a mock can have several. Filter the list by tag; import suggests them. |
| **Review list** | Recorded requests waiting to be accepted as mocks (kept 24 hours). |
| **Marker stub** | The hidden stub the UI uses to notice a WireMock restart. |
| **Adoption** | Taking over the stubs a WireMock already had, on the first start with an empty store. |
| **WireMock-only mode** | Running without a store (`STORE_DRIVER=none`): WireMock's stubs are the list. |

## How to

**Find a section** (top of the side menu) narrows the menu to section titles and headings; it does not search the text. The pages that use these words show them as tooltips.

## Tips and limits

WireMock's own documentation: [wiremock.org/docs](https://wiremock.org/docs/).
