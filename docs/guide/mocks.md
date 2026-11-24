---
title: Mocks and the editor
order: 3
routes: /mocks
summary: Make, edit, test and clean up mocks, on the URL form or as raw stub JSON.
---

# Mocks and the editor

## What it is

A **mock** is one answer WireMock gives: a request it matches and the response it sends. The **Mocks** page lists them, newest change first. The editor has two modes:

- **Simple:** a form. A method, a URL and the answer: status, body, headers. Also forwarding, call-backs, delays, broken connections, scenarios, and several responses chosen by a value in the request.
- **Advanced:** the raw WireMock stub JSON, for anything WireMock supports.

## What it does in WireMock

Saving a mock checks it, pushes it into WireMock, then stores it; WireMock refuses an invalid stub, so a broken mock is never saved. **Preview** shows the exact stub that will be saved. A Simple mock for `GET` `/blog/posts/404`, **Not found**:

```stub
{
  "name": "GET /blog/posts/404",
  "request": {
    "method": "GET",
    "urlPath": "/blog/posts/404"
  },
  "response": {
    "status": 404,
    "headers": { "Content-Type": "application/json" },
    "jsonBody": { "error": "post not found" }
  }
}
```

## How to

**A mock for a URL.** [New mock →](/mocks/new) opens the URL form:

1. **Method** (`ANY` matches every method) and **URL**, read as **URL match**:
   - **Exact path**: the path must equal the text. `/blog/posts` matches only `/blog/posts`, with any query string.
   - **Path template**: `{name}` marks a segment that changes. `/blog/posts/{id}` matches `/blog/posts/42` and `/blog/posts/abc`.
   - **Regex**: a regular expression over the path (Java dialect). `/blog/posts/[0-9]+` matches `/blog/posts/42` but not `/blog/posts/abc`.

   Pasting a full URL keeps only the path; its query string moves to **Query parameters**.
2. Optional: **Query parameters** the request must carry, **Request body must contain** (a JSON object matches as JSON, extra fields allowed; anything else as text), and a **Priority** (lowest wins; empty uses WireMock's default, 5).
3. **Response status:** **Success** (200), **Not found** (404), **Validation error** (400), **Server error** (500), **Timeout** (waits 30 s, then 504) or **Custom**. Then the **Response body** and **Response headers**.
4. Optional: a **Slow response** (1 to 120 seconds), **Break the connection** (empty response, garbled chunk, random data, connection reset) or a **Name**.
5. **Save mock.**

Good for one-offs, and for catch-alls such as `ANY` `/api/.*` with priority 10 so more specific mocks win.

**Several responses by value.** **Add a response for another value** turns the mock into one mock with a response per value (`id` `42`, `id` `404`, any other `id`). See [Tags and several responses](tags.md).

**Advanced.** Open a mock and switch to **Advanced**, or **New mock** → **Start from blank JSON** (**Use the form** goes back). The **Server fields** box shows what the UI manages for you (id, owner, version, who changed it last). When a mock uses options Simple mode cannot show, Simple mode says so and links to Advanced.

**Body from a file.** **Upload body from file** (next to **Response body**) reads a file in your browser, up to 5 MB. A text file fills the body; anything else (an image, a PDF) becomes a binary body that WireMock sends byte for byte.

**History and conflicts.** **History** on an open mock lists its last 20 versions; pick one, then **Restore this version**. If someone saved the mock while you were editing, your save is refused ("Someone changed this mock since you opened it"): **Copy my JSON** keeps your draft, **Reload** shows theirs.

**Tags.** Above the Simple and Advanced tabs, type a tag and press Enter (or a comma); × removes it. The list shows them under each mock's name, and **Any tag** filters by one. See [Tags and several responses](tags.md).

**The list.** **All mocks / My mocks** switches between everyone's (baseline included, the default) and yours. The row menu (**…**) has **Open**, **Duplicate to my mocks** and **Delete** (undo from the toast). **Reset my mocks** deletes every mock you own, for a clean start. A scenario's mocks fold into one row, **Scenario: name · N mocks**; a mock with several responses is one row, **3 responses (by id)**.

## Tips and limits

- The list shows 50 rows a page (**Per page**: 25, 50 or 100, remembered in this browser); the page number is in the address, so links and Back keep it.
- WireMock's `bodyFileName` (a file in WireMock's own folder) is refused: put the body inline or use **Upload body from file**.
- Deleted a mock by mistake? **Undo** in the toast brings it back. Its saved versions are kept for 7 days after that (not in WireMock-only mode, which keeps no history).
- More: [Testing and Copy as curl](testing.md), [Proxy](proxy.md), [Webhooks](webhooks.md), [Scenarios](scenarios.md).
