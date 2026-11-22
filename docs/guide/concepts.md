---
title: Concepts
order: 2
routes:
summary: Integration, endpoint, mock, the key, baseline and "my" mocks, and which mock wins.
---

# Concepts

## What it is

Three words carry the whole UI:

| | What it is | Blog API example |
|---|---|---|
| **Integration** | One external system your application calls, and the URL prefix its requests use on WireMock. | **Blog API**, key `blog`, prefix `/blog` |
| **Endpoint** | One operation of that system: method, path, and **where the key is**. | **Get post**: `GET /blog/posts/{id}`, key = path variable `id` |
| **Mock** | One answer WireMock gives for one **key value** of an endpoint. | `id` `42` → `200 {"id":42,"title":"Hello"}`; `id` `404` → `404` |

**The key** is the value in each request that tells one mock from another. Your app calls `GET /blog/posts/{id}` for every post; only the `id` changes. So the endpoint says "the key is the path variable `id`", and each mock answers one `id`. A **default mock** answers every request whose key no other mock has.

Integrations are a description, written once (often by a developer or lead tester) with example requests and responses. After that anyone makes a mock in a few clicks. Integrations do not answer requests themselves; only mocks do.

## What it does in WireMock

WireMock knows nothing about integrations or endpoints: it only has **stub mappings**. An endpoint is a template the UI fills in; the integration and endpoint are written into the stub's `metadata.wiremockUi` so the UI can show the mock under them again. A key mock matches the key value with an exact matcher; a default mock has no key matcher and a lower priority.

```stub
{
  "name": "Get post — 42",
  "priority": 5,
  "request": {
    "method": "GET",
    "urlPathTemplate": "/blog/posts/{id}",
    "pathParameters": { "id": { "equalTo": "42" } }
  },
  "response": {
    "status": 200,
    "headers": { "Content-Type": "application/json" },
    "jsonBody": { "id": 42, "userId": 7, "title": "Hello" }
  },
  "metadata": { "wiremockUi": { "integration": "blog", "endpoint": "get-post", "owner": "sara", "version": 1 } }
}
```

## How to

Read the rest of the guide in this order: [Integrations and endpoints](integrations.md), [Mocks and the editor](mocks.md), [Testing and Copy as curl](testing.md), [Request log and near misses](request-log.md).

## Tips and limits

**Which mock wins.** When several mocks match one request, WireMock picks:

1. the lowest **priority** number first. Key mocks get priority **5**, default mocks **10**, so a key mock always beats the default. Quick URL mocks and Advanced stubs use WireMock's default unless you set `priority`;
2. among equal priorities, a person's mock beats a **baseline** mock, and the most recently saved one wins.

**My mocks, all mocks, baseline.** Every mock records its owner: the person who made it, or **baseline** for mocks that came from an import or a seed file and belong to nobody. Every signed-in user can still edit and delete any mock (there are no roles). The Mocks page shows **All mocks** by default (everyone's, baseline included); **My mocks** narrows it to yours. **Reset my mocks** deletes only yours.

**Endpoint ID vs key.** The endpoint ID (`get-post`) is just the endpoint's name in URLs and the API; it is not the key.
