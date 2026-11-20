---
title: Getting started
order: 1
routes:
summary: From nothing to a mock your app calls, in five minutes, with the Blog API example.
---

# Getting started

## What it is

wiremock-ui is a web console for [WireMock](https://wiremock.org), a server that pretends to be the services your application calls. You describe those services once, make **mocks** (the answers WireMock gives), point your application at WireMock instead of the real service, and watch what it received.

> **Test environments only.** Never put real personal data in a mock. Everyone who signs in sees every mock.

## What it does in WireMock

Every mock you save becomes one WireMock **stub mapping**: a request pattern ("GET /blog/posts/42") and a response ("200 with this JSON"). wiremock-ui keeps its own copy of every mock and puts it back into WireMock if WireMock restarts (see [Sync with WireMock](sync.md)). Your application only ever talks to WireMock; it never talks to wiremock-ui.

## How to

The example is a small blog service your application calls: **Blog API**, with a call **Get post** `GET /blog/posts/{id}`.

1. **Point your app at WireMock.** Change the base URL of the blog service in your app's test settings to WireMock's address (the one in the curl commands the UI shows, `http://localhost:8080` by default), keeping the path. Your app then calls `http://localhost:8080/blog/posts/42`.
2. **Add the integration.** [Open Integrations →](/integrations) and choose **Add integration**: **Key** `blog`, **Name** `Blog API`, **URL prefix** `/blog`.
3. **Add the endpoint.** Open **Blog API** and choose **Add endpoint**: **Name** `Get post`, **Endpoint ID** `get-post`, **Method** `GET`, **Path** `/posts/{id}` with **Path type** `Template`, **Content type** `JSON`. Under the key, pick **Path variable** and type `id`. Add an example response for `200`, for example `{"id": 42, "userId": 7, "title": "Hello"}`. **Save endpoint**.
4. **Create a mock.** Choose **New mock from this endpoint** in the toast (or [New mock →](/mocks/new) and pick **Blog API → Get post**). Type `42` as the value of `id`, leave **Success** (200), and **Save mock**.
5. **Try it.** In the mock's header choose **Test**, then **Send**. The panel shows `200`, the body, and the stamp **Matched this mock**. Or copy the request with **Copy as curl** and run it in a terminal.
6. **Read the request log.** [Open the request log →](/requests). Your request is at the top with the mock that answered it. Call `/blog/posts/43` and it shows the amber **No match** stamp: click it to see why (see [Request log and near misses](request-log.md)).

The **Getting started** checklist on the [Mocks](/mocks) page follows these steps and ticks each one as it happens. Hide it with **×**; the button under this section shows it again.

## Tips and limits

- No time for an integration? On **New mock**, **Mock a URL directly** takes a method, a URL and the answer. See [Mocks and the editor](mocks.md).
- Press **?** on any page to open this guide; **How this works** in the top bar opens the part of it for the page you are on.
- Already have WireMock stubs? Point the UI at that WireMock: on its first start it adopts them (see [Sync with WireMock](sync.md)), or run it with no storage at all (see [Storage and WireMock-only mode](storage.md)).
