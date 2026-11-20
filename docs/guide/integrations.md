---
title: Integrations and endpoints
order: 4
routes: /integrations
summary: Describe each system your app calls once, so anyone can make a mock for it in a few clicks.
---

# Integrations and endpoints

## What it is

An **integration** is one external system your application calls (the Blog API, the Orders API) and the URL prefix its requests use on WireMock (`/blog`, `/orders`). An **endpoint** is one operation of it: a method, a path, where the **key** is, and examples. The Integrations page lists both.

## What it does in WireMock

Nothing on its own: integrations and endpoints live only in wiremock-ui. They decide the request half of every mock built from them: the prefix plus the path becomes `urlPath` (Exact), `urlPathTemplate` (Template) or `urlPathPattern` (Regex), and the key becomes a matcher on the body, query, path variable, header or form field. Their examples prefill new mocks and the test panel.

## How to

**Add an integration.** [Open Integrations →](/integrations) → **Add integration**:

- **Key** `blog`: lowercase letters, digits and dashes; it cannot change later.
- **Name** `Blog API`.
- **URL prefix** `/blog`: put in front of every endpoint path.

**Add an endpoint.** Open the integration → **Add endpoint**. The form is a page of its own; the panel beside it, **How testers will see this**, shows the endpoint's row in the New mock picker and the key field the editor will show, as you type.

1. **Request:** **Name** `Get post`, **Endpoint ID** `get-post`, **Method** `GET`, **Path** `/posts/{id}`, **Path type**, **Content type** `JSON`.
   - `Exact`: the path must equal the text. `/posts` matches only `/blog/posts`.
   - `Template`: `{name}` marks a segment that changes. `/posts/{id}` matches `/blog/posts/42`.
   - `Regex`: a regular expression (Java dialect). `/posts/[0-9]+` matches `/blog/posts/42` but not `/blog/posts/abc`.
2. **Key:** **Where the key is** and the **Key expression**:

   | Where the key is | Expression | Reads `7` from |
   |---|---|---|
   | JSON body (JSONPath) | `$.userId` | `{"userId": 7, "title": "Hello"}` |
   | XML body (XPath) | `/post/userId` | `<post><userId>7</userId></post>` |
   | Query parameter | `userId` | `/blog/posts?userId=7` |
   | Path variable (Template paths) | `id` | `/blog/posts/7` with path `/posts/{id}` |
   | Header | `X-User-Id` | `X-User-Id: 7` |
   | Form field | `userId` | `userId=7&lang=en` |

   **No key** means every mock of the endpoint answers every request to it (only a default answer makes sense).
3. **Examples:** an **example request** (what **Try it** sends), the **allowed statuses** (for example `200` and `404`), and one tab per status with its **example response**. The examples prefill the body of new mocks.
4. **About:** a description and links to the real system's documentation.
5. **Save endpoint.** The toast offers **New mock from this endpoint**.

More Blog API endpoints to practise with: **List posts** `GET /posts` (key: query parameter `userId`) and **Create post** `POST /posts` (JSON body `{"userId": 7, "title": "Hello", "body": "…"}`, key `$.userId`).

**Try it** on an endpoint's row opens the test panel with the endpoint's example request, so you can see which mock (if any) answers it today.

## Tips and limits

- Editing an endpoint (the pencil on its row) uses the same page; its ID cannot change. Leaving the page with unsaved changes asks first.
- An endpoint cannot be deleted while mocks built from it exist, and an integration cannot be deleted while it has mocks.
- The **How it fits together** strip at the top of the page explains integration → endpoint → mock. Hide it with **×**; **How it fits together** in the page header brings it back.
- Regex paths are matched by WireMock in Java's dialect; the UI only checks that the pattern parses.
- In WireMock-only mode integrations are kept in memory and lost on restart; see [Storage and WireMock-only mode](storage.md).
