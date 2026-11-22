---
title: Mocks and the editor
order: 3
routes: /mocks
summary: Make, edit, test and clean up mocks, in Simple or Advanced mode, or straight from a URL.
---

# Mocks and the editor

## What it is

A **mock** is one answer WireMock gives: a request it matches and the response it sends. The **Mocks** page lists them, newest change first. The editor has two modes:

- **Simple:** a form. Pick an endpoint, type the key value, pick a status. Also forwarding, call-backs, delays, broken connections and scenarios.
- **Advanced:** the raw WireMock stub JSON, for anything WireMock supports.

## What it does in WireMock

Saving a mock checks it, pushes it into WireMock, then stores it; WireMock refuses an invalid stub, so a broken mock is never saved. **Preview** shows the exact stub that will be saved. A Simple key mock for **Blog API → Get post**, `id` `404`, **Not found**:

```stub
{
  "name": "Get post — 404",
  "priority": 5,
  "request": {
    "method": "GET",
    "urlPathTemplate": "/blog/posts/{id}",
    "pathParameters": { "id": { "equalTo": "404" } }
  },
  "response": {
    "status": 404,
    "headers": { "Content-Type": "application/json" },
    "jsonBody": { "error": "post not found" }
  }
}
```

## How to

**A key mock** (answers one specific request). [New mock →](/mocks/new), search `get post`, pick the endpoint, then:

1. **Value of path parameter id:** `42`.
2. **Response status:** **Success** (200). The body is prefilled from the endpoint's example; edit it as you like. Other presets: **Not found** (404), **Validation error** (400), **Server error** (500), **Timeout** (waits 30 s, then 504) and **Custom**. An endpoint with allowed statuses only offers those.
3. Optional: a **Slow response** (1 to 120 seconds), **Break the connection** (empty response, garbled chunk, random data, connection reset) or a **Name**.
4. **Save mock.**

**A default mock** answers every request no key mock matches: turn on **Default answer (when no key matches)**, pick for example **Not found**, save.

**Mock a URL directly** (no integration needed): on **New mock**, choose **Mock a URL directly** and give a method, a URL (an exact path, a path template like `/orders/{orderId}`, or a regex), optional query parameters or body to match, and the response. Good for one-offs; it saves a normal mock that opens in the same quick form.

**Advanced.** Open a mock and switch to **Advanced**, or **New mock** → **Start from blank JSON**. The **Server fields** box shows what the UI manages for you (id, owner, version, who changed it last). When a mock uses options Simple mode cannot show, Simple mode says so and links to Advanced.

**Body from a file.** **Upload body from file** (next to **Response body**) reads a file in your browser, up to 5 MB. A text file fills the body; anything else (an image, a PDF) becomes a binary body that WireMock sends byte for byte.

**History and conflicts.** **History** on an open mock lists its last 20 versions; pick one, then **Restore this version**. If someone saved the mock while you were editing, your save is refused ("Someone changed this mock since you opened it"): **Copy my JSON** keeps your draft, **Reload** shows theirs.

**The list.** **All mocks / My mocks** switches between everyone's (baseline included, the default) and yours. The row menu (**…**) has **Open**, **Duplicate to my mocks** and **Delete** (undo from the toast). **Reset my mocks** deletes every mock you own, for a clean start. A scenario's mocks fold into one row, **Scenario: name · N mocks**.

## Tips and limits

- The list shows 50 rows a page (**Per page**: 25, 50 or 100, remembered in this browser); the page number is in the address, so links and Back keep it.
- The endpoint picker shows up to 50 endpoints; type to narrow. Integrations without endpoints show "No endpoints yet".
- WireMock's `bodyFileName` (a file in WireMock's own folder) is refused: put the body inline or use **Upload body from file**.
- Deleted a mock by mistake? **Undo** in the toast brings it back. Its saved versions are kept for 7 days after that (not in WireMock-only mode, which keeps no history).
- More: [Testing and Copy as curl](testing.md), [Proxy](proxy.md), [Webhooks](webhooks.md), [Scenarios](scenarios.md).
