---
title: Testing and Copy as curl
order: 5
routes:
summary: Send a request to WireMock from the UI and see which mock answered, or copy it as a curl command.
---

# Testing and Copy as curl

## What it is

The **test panel** sends one request to WireMock and shows what came back, so you can check a mock without your application. **Copy as curl** gives you the same request as a shell command.

## What it does in WireMock

The request goes from the UI's server to WireMock's stub port (never to the admin API, never to another host), exactly as your app would send it. WireMock answers with a `Matched-Stub-Id` header naming the stub that answered; the panel turns it into a stamp. The request also lands in WireMock's request journal, so it shows up in the [request log](request-log.md).

## How to

1. Open a saved mock and choose **Test** in its header. The panel is filled with a request that mock should match: its method, a concrete path (template variables filled with the key value or the endpoint's example), the key where the endpoint looks for it, and the endpoint's example body.
2. Edit anything, then **Send**.
3. Read the status, the time it took, the headers, the body, and the stamp:
   - **Matched this mock**: the saved version answered.
   - **Matched another mock:** followed by its name: another mock won (a link opens it). See "Which mock wins" in [Concepts](concepts.md).
   - **No match**: nothing matched; **See unmatched requests** opens the request log.

Other ways in: **Try it** on an endpoint's row (with the endpoint's example request), and **Resend** in the request log (with a logged request).

**Copy as curl** (in the test panel, the editor header, a mock's row menu and the request-log drawer) copies a command such as:

```sh
curl -X GET 'http://localhost:8080/blog/posts/42'
```

It uses `WIREMOCK_PUBLIC_URL`, the address your machines use to reach WireMock, and pastes into any POSIX shell as is (quotes, new lines and `$` included).

## Tips and limits

- Send twice to watch a [scenario](scenarios.md) move: the first call gets the first answer, the second the next.
- For a mock with a regex path the UI cannot fill in, the curl keeps the pattern in the path for you to edit.
- Paths must start with `/`; `/__admin`, absolute URLs and `..` are refused. Bodies are limited to 1 MB each way; the relay waits 30 seconds.
