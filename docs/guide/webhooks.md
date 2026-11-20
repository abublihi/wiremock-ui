---
title: Webhooks (call back after responding)
order: 9
routes:
summary: Have WireMock send a request of its own after it answers, like the status callback your app waits for.
---

# Webhooks (call back after responding)

## What it is

A **webhook** makes WireMock call a URL after it has answered a request. Use it when your app expects a callback: "order 1001 shipped" a little after it placed the order.

## What it does in WireMock

A `serveEventListeners` entry named `webhook` on the stub, with the method, URL, headers, body and an optional delay. The body is a WireMock template, so it can copy values from the request that triggered it.

```stub
{
  "name": "POST /orders",
  "request": { "method": "POST", "urlPath": "/orders" },
  "response": { "status": 201, "headers": { "Content-Type": "application/json" }, "jsonBody": { "status": "pending" } },
  "serveEventListeners": [
    {
      "name": "webhook",
      "parameters": {
        "method": "POST",
        "url": "http://my-app.test/hooks/order-status",
        "headers": { "Content-Type": "application/json" },
        "body": "{\"orderId\":\"{{jsonPath originalRequest.body '$.orderId'}}\",\"status\":\"shipped\"}",
        "delay": { "type": "fixed", "milliseconds": 2000 }
      }
    }
  ]
}
```

## How to

1. Open or create a mock in Simple mode (for example **Mock a URL directly**: `POST` `/orders`, status `201`, header `Content-Type: application/json`).
2. Turn on **Call back after responding**.
3. **Method** `POST` and **Callback URL** `http://my-app.test/hooks/order-status` (`http://` or `https://`; the rest may use templates).
4. **Headers** and **Body**, for example `{"orderId":"{{jsonPath originalRequest.body '$.orderId'}}","status":"shipped"}`.
5. **Wait before calling**: none, a fixed number of milliseconds, or a random time between two values. **Save mock**.

## Tips and limits

- Use `originalRequest`, not `request`, in the body: inside a webhook WireMock 3.13.1 names the incoming request `originalRequest`, and `request.body` is empty there.
- The callback is sent from WireMock's machine: `http://localhost:…` means WireMock's own host.
- The longest wait is 600000 ms (10 minutes).
