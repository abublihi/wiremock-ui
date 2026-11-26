---
title: Tags and several responses
order: 4
routes:
summary: Group mocks with tags, and let one mock answer differently by a value in the request.
---

# Tags and several responses

## What it is

**Tags** are free-form labels on a mock: a system (`blog`, `orders`), a team, a sprint (`sprint-42`). A mock can have several. The Mocks list, the request log and export can all be narrowed to one tag.

**A mock with several responses** answers one request differently by values in it (up to 4: a URL variable, a header, …). **Get post** `GET /blog/posts/{id}` answers `id` `42` with a post, `id` `404` with `404 Not found`, and **any other id** with a default post. It is one mock in the list, with a response per value.

## What it does in WireMock

Tags are stored in the stub's `metadata.wiremockUi.tags`; WireMock ignores them, so they never change what matches.

WireMock has no "several responses" of its own. The UI saves one stub per response. Each one matches the request plus its values (an `equalTo` on the path variable, query parameter, header, JSON path, XPath or form field). A response with a value left at *any* sits one priority number lower per such value, and **Every other request** has no value matcher and sits 5 numbers lower (10 by default, or the mock's **Priority** + 5), so the most specific response always wins. The stubs share `metadata.wiremockUi.group`, which is how the UI shows them as one mock.

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
      "group": { "id": "…", "by": [{ "location": "path", "expression": "id" }], "values": ["42"], "order": 0 }
    }
  }
}
```

## How to

**Tag a mock.** In the editor, above the **Simple** and **Advanced** tabs, type a tag in **Tags** and press Enter (or a comma); × removes it. Tags are stored in lower case with spaces as `-` (`Blog API` → `blog-api`). They use `a-z`, `0-9`, `.`, `_` and `-`, start with a letter or digit, and are at most 40 characters; a mock has at most 20.

**Filter by tag.** On the [Mocks](/mocks) page, **Any tag** narrows the list to one tag. In the [request log](/requests), **Answered by a mock tagged** shows the requests a mock with that tag answered. **Export** on the Mocks list exports the mocks of the tag shown.

**Add a response for some requests.** [New mock →](/mocks/new) (or open a mock): **Method** `GET`, **URL match** **Path template**, **URL** `/blog/posts/{id}`, and the response. Then:

1. Under the response, click **Add a response for some requests**. A **Choose the response by** box opens in the request part, with a first condition: the URL's last variable (`id`), or a query parameter to name.
2. Change it if needed: **URL variable**, **Query parameter**, **Header**, **JSON body field** (`$.userId`), **XML body field** (`/post/userId`) or **Form field**. **Add a condition** adds another (up to 4), for example `id` and the header `X-Tenant`.
3. The new response is a card: **When id =** `404` → `404`. Click the arrow to open it; it has the same fields as the main response (status, headers, body or file, forwarding, delay, fault, call back). Add one card per value.
4. A value left empty means **any** value: **When id =** *any* **and X-Tenant =** `acme` answers every post for that tenant. When several cards fit a request, the one with more values filled in answers.
5. The main response is now **Every other request**: **This response** (it answers every request no card is for) or **No answer** (this mock does not answer; WireMock tries your other mocks, then answers 404).
6. **Save mock**.

The method, URL, priority and tags are shared: change them once and every response follows. × on a card removes that response; remove the last card and the mock is a plain mock again. A mock in a scenario has one response: turn the scenario off to add more.

**Test a response.** Each saved card (and **Every other request**) has a **Test** button: it opens the test panel with a request that card answers, its values filled in. Save first: Test sends a request to what WireMock serves.

**Edit the JSON.** In **Advanced**, a mock with several responses shows a **Response** picker above the JSON: each response is its own WireMock stub, and **Save** saves the one shown.

**In the list** the mock is one row, **3 responses (by id)**, that expands to a row per response. **Delete** in its menu removes every response; each one can be restored from its history for 7 days.

**From the request log.** When a request has no match and the closest mock answers by a value, its near miss offers **Add a response for 43**: it opens that mock with a new card for `43`.

## Tips and limits

- **A URL variable** needs a path template (`/blog/posts/{id}`) with that variable in it.
- At most 4 conditions; two cards cannot have the same values, and a card needs at least one value.
- A mock with responses the form cannot show (a scenario step, or a stub changed by hand) opens in **Advanced**, one stub at a time.
- Importing stubs that differ only by one part of the URL offers to combine them into one mock with several responses (see [Import and export](import-export.md)).
- Coming from an older version with integrations? See the end of [Concepts](concepts.md).
