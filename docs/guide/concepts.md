---
title: Concepts
order: 2
routes:
summary: Mock, tags, several responses, baseline and "my" mocks, and which mock wins.
---

# Concepts

## What it is

A few words carry the whole UI:

| | What it is | Blog API example |
|---|---|---|
| **Mock** | One answer WireMock gives: the request it matches and the response it sends. | `GET /blog/posts/42` → `200 {"id":42,"title":"Hello"}` |
| **Tag** | A label you put on mocks to group them: a system, a team, a sprint. | `blog` on every Blog API mock |
| **Several responses** | One mock that answers differently by values in the request (up to 4), with an optional answer for every other request. | `GET /blog/posts/{id}`: `id` `42` → `200`, `id` `404` → `404`, any other `id` → `200` with a default post |

Most mocks are a method, a URL and an answer, made on the URL form in a few clicks. When your app calls the same URL with a value that changes (a post `id`, an order number), make one mock with several responses instead of many separate mocks. See [Tags and several responses](tags.md).

## What it does in WireMock

WireMock only has **stub mappings**. A mock is one stub; a mock with several responses is one stub per response. The UI writes what it needs into the stub's `metadata.wiremockUi` (owner, version, tags, and the group for several responses) so it can show the mock again; WireMock ignores that metadata.

```stub
{
  "name": "GET /blog/posts/42",
  "request": {
    "method": "GET",
    "urlPath": "/blog/posts/42"
  },
  "response": {
    "status": 200,
    "headers": { "Content-Type": "application/json" },
    "jsonBody": { "id": 42, "userId": 7, "title": "Hello" }
  },
  "metadata": { "wiremockUi": { "tags": ["blog"], "owner": "sara", "version": 1 } }
}
```

## How to

Read the rest of the guide in this order: [Mocks and the editor](mocks.md), [Tags and several responses](tags.md), [Testing and Copy as curl](testing.md), [Request log and near misses](request-log.md).

## Tips and limits

**Which mock wins.** When several mocks match one request, WireMock picks:

1. the lowest **priority** number first. Mocks use WireMock's default (5) unless you set a **Priority** on the URL form. In a mock with several responses, **Every other request** sits 5 lower (10 by default), and a response with a value left at *any* one lower per such value, so the most specific response always wins;
2. among equal priorities, a person's mock beats a **baseline** mock, and the most recently saved one wins.

**My mocks, all mocks, baseline.** Every mock records its owner: the person who made it, or **baseline** for mocks that came from an import or a seed file and belong to nobody. Every signed-in user can still edit and delete any mock (there are no roles). The Mocks page shows **All mocks** by default (everyone's, baseline included); **My mocks** narrows it to yours. **Reset my mocks** deletes only yours.

**Integrations from older versions.** Older versions of wiremock-ui had integrations and endpoints. On start-up, and when you import an older bundle or seed, they are migrated: an integration's key becomes a tag on its mocks, and an endpoint's key mocks and default mock become one mock with several responses (the default mock is **Every other request**). What WireMock matches does not change.
