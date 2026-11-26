---
title: Getting started
order: 1
routes:
summary: From nothing to a mock your app calls, in five minutes, with the Blog API example.
---

# Getting started

## What it is

wiremock-ui is a web console for [WireMock](https://wiremock.org), a server that pretends to be the services your application calls. You make **mocks** (the answers WireMock gives), point your application at WireMock instead of the real service, and watch what it received.

> **Test environments only.** Never put real personal data in a mock. Everyone who signs in sees every mock.

## What it does in WireMock

Every mock you save becomes one WireMock **stub mapping**: a request pattern ("GET /blog/posts/42") and a response ("200 with this JSON"). wiremock-ui keeps its own copy of every mock and puts it back into WireMock if WireMock restarts (see [Sync with WireMock](sync.md)). Your application only ever talks to WireMock; it never talks to wiremock-ui.

## How to

The example is a small blog service your application calls, the **Blog API**, with a call **Get post** `GET /blog/posts/{id}`.

1. **Point your app at WireMock.** Change the base URL of the blog service in your app's test settings to WireMock's address (the one in the curl commands the UI shows, `http://localhost:8080` by default), keeping the path. Your app then calls `http://localhost:8080/blog/posts/42`.
2. **Create a mock.** [New mock →](/mocks/new) opens the URL form. **Method** `GET`, **URL match** **Exact path**, **URL** `/blog/posts/42`. Leave **Success** (200) and type the body, for example `{"id": 42, "userId": 7, "title": "Hello"}`. Optionally add the tag `blog` in **Tags**. **Save mock**.
3. **Try it.** In the mock's header choose **Test**, then **Send**. The panel shows `200`, the body, and the stamp **Matched this mock**. Or copy the request with **Copy as curl** and run it in a terminal.
4. **Read the request log.** [Open the request log →](/requests). Your request is at the top with the mock that answered it. Call `/blog/posts/43` and it shows the amber **No match** stamp: click it to see why (see [Request log and near misses](request-log.md)).

The **Getting started** checklist on the [Mocks](/mocks) page follows these steps (**Create a mock**, **Send a test request**, **See it in the request log**) and ticks each one as it happens. Hide it with **×**; the button under this section shows it again.

## Tips and limits

- Every post a different answer? Use **URL match** **Path template** with `/blog/posts/{id}` and **Add a response for some requests**: one mock, one response per `id`. See [Tags and several responses](tags.md).
- Press **?** on any page to open this guide; **How this works** in the top bar opens the part of it for the page you are on.
- Already have WireMock stubs? Point the UI at that WireMock: on its first start it adopts them (see [Sync with WireMock](sync.md)), or run it with no storage at all (see [Storage and WireMock-only mode](storage.md)).
