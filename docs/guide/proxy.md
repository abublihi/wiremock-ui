---
title: Proxy (forward to a real service)
order: 8
routes:
summary: Let a mock pass the request on to a real service and return its answer unchanged.
---

# Proxy (forward to a real service)

## What it is

A mock can **forward** the request to a real service instead of answering itself. Typical use: mock a few requests and forward every other one to a test instance of the real service, with a catch-all proxy mock at a lower priority (a higher number) than your other mocks.

## What it does in WireMock

WireMock's proxy response: `response.proxyBaseUrl` (plus optional headers to add or remove and a path prefix to cut). WireMock sends the request there, from wherever WireMock runs, and returns the real status, headers and body, so the mock has no status or body of its own.

```stub
{
  "name": "ANY /blog/.*",
  "priority": 10,
  "request": { "method": "ANY", "urlPathPattern": "/blog/.*" },
  "response": {
    "proxyBaseUrl": "https://blog.test.example",
    "proxyUrlPrefixToRemove": "/blog",
    "removeProxyRequestHeaders": ["cookie"]
  }
}
```

## How to

1. Open or create a mock in Simple mode, for example [New mock →](/mocks/new) with **Method** `ANY`, **URL match** **Regex**, **URL** `/blog/.*` and **Priority** `10`.
2. **Answer with** → **Forward to a real service**.
3. **Service base URL** `https://blog.test.example`: the request goes there plus its path.
4. **Remove path prefix** `/blog` (optional): cut from the path first, so `/blog/posts` goes to `https://blog.test.example/posts`. The line below shows the route.
5. **Headers to add** and **Headers to remove** (for example `Cookie`), then **Save mock**.

## Tips and limits

- The request leaves from WireMock's machine: `http://localhost:…` means WireMock's own host, not yours.
- The Mocks list marks forwarding mocks **Proxy**.
- Header names to remove are stored in lower case, because WireMock 3.13.1 only removes names listed that way.
- To turn a real service's answers into mocks instead of forwarding every time, use [Recording](recording.md).
