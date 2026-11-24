---
title: Tags and several responses
order: 4
routes:
summary: Group mocks with tags, and let one mock answer differently by a value in the request.
---

# Tags and several responses

## What it is

**Tags** are free-form labels on a mock: a system (`blog`, `orders`), a team, a sprint (`sprint-42`). A mock can have several. The Mocks list, the request log and export can all be narrowed to one tag.

**A mock with several responses** answers one request differently by one value in it. **Get post** `GET /blog/posts/{id}` answers `id` `42` with a post, `id` `404` with `404 Not found`, and **any other id** with a default post. It is one mock in the list, with a row per value.

## What it does in WireMock

Tags are stored in the stub's `metadata.wiremockUi.tags`; WireMock ignores them, so they never change what matches.

WireMock has no "several responses" of its own. The UI saves one stub per response. Each one matches the request plus the value (an `equalTo` on the path variable, query parameter, header, JSON path, XPath or form field). The **Any other** response has no value matcher and a priority 5 numbers lower (10 by default, or the mock's **Priority** + 5), so a value's own response always wins. The stubs share `metadata.wiremockUi.group`, which is how the UI shows them as one mock.

```stub
{
  "name": "Get post",
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
  "metadata": {
    "wiremockUi": {
      "tags": ["blog"],
      "group": { "id": "…", "by": { "location": "path", "expression": "id" }, "value": "42", "order": 0 }
    }
  }
}
```

## How to

**Tag a mock.** In the editor, above the **Simple** and **Advanced** tabs, type a tag in **Tags** and press Enter (or a comma); × removes it. Tags are stored in lower case with spaces as `-` (`Blog API` → `blog-api`). They use `a-z`, `0-9`, `.`, `_` and `-`, start with a letter or digit, and are at most 40 characters; a mock has at most 20.

**Filter by tag.** On the [Mocks](/mocks) page, **Any tag** narrows the list to one tag. In the [request log](/requests), **Answered by a mock tagged** shows the requests a mock with that tag answered. **Export** on the Mocks list exports the mocks of the tag shown.

**Add responses for other values.** [New mock →](/mocks/new) on the URL form: **Method** `GET`, **URL match** **Path template**, **URL** `/blog/posts/{id}`, and the first response. Then:

1. **Add a response for another value**.
2. **Answer differently by**: **a variable in the URL** (`id`), **a query parameter**, **a header**, **a JSON body field** (`$.userId`), **an XML body field** (`/post/userId`) or **a form field**.
3. Fill one row per value: **When id =** `42` → `200` and the post, **When id =** `404` → `404`.
4. The last row, **Any other id**, is either **This response** (it answers every other value) or **No match** (this mock does not answer; WireMock tries your other mocks, then answers 404).
5. **Try it** under the rows: type a value to see which response answers it.
6. **Save mock**.

The method, URL, priority and tags are shared: change them once and every response follows. × on a row removes that response. When you add responses to a mock that had one, **Back to one response** drops the new rows before you save.

**In the list** the mock is one row, **3 responses (by id)**, that expands to a row per response. **Delete** in its menu removes every response; each one can be restored from its history for 7 days.

**From the request log.** When a request has no match and the closest mock answers by a value, its near miss offers **Add a response for 43**: it opens that mock with a new row for `43`.

## Tips and limits

- A proxied, faulty or file response cannot be the first of several responses; change it first.
- **A variable in the URL** needs a path template (`/blog/posts/{id}`) with that variable in it.
- A mock with responses the form cannot show opens each one in the JSON editor.
- Importing stubs that differ only by one part of the URL offers to combine them into one mock with several responses (see [Import and export](import-export.md)).
- Coming from an older version with integrations? See the end of [Concepts](concepts.md).
