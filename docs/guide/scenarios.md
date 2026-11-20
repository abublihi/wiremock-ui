---
title: Scenarios and the builder
order: 7
routes: /scenarios
summary: The same request answered differently on later calls, like an order going pending, shipped, delivered.
---

# Scenarios and the builder

## What it is

Some flows need the same request to get a different answer each time: your app polls `GET /orders/1001` and should see `pending`, then `shipped`, then `delivered`. That is a **scenario**: several mocks for the same request that answer in turn as the scenario moves from **state** to state.

## What it does in WireMock

WireMock has no scenario object: a scenario exists because several stubs share a `scenarioName`. Each stub says "I answer only while the scenario is in state X" (`requiredScenarioState`) and, optionally, "then move it to state Y" (`newScenarioState`). Every scenario starts in `Started`. WireMock keeps the current state in memory; a WireMock restart puts every scenario back to `Started`.

The first step of the Orders example:

```stub
{
  "name": "order-status — Started",
  "scenarioName": "order-status",
  "requiredScenarioState": "Started",
  "newScenarioState": "shipped",
  "request": { "method": "GET", "urlPath": "/orders/1001" },
  "response": { "status": 200, "jsonBody": { "orderId": "1001", "status": "pending" } }
}
```

## How to

**Build a scenario.** [Open Scenarios →](/scenarios) → **New scenario**. One page holds the whole scenario:

1. **Scenario name**: `order-status` (letters, digits and `- _ .`, so the page can move and reset it).
2. **Request**: every step answers the same request. Pick an **Integration endpoint** (for example **Orders API → Get order**, key `1001`), or **Method and URL** (`GET` `/orders/1001`).
3. **Steps**, in the order calls get them. Each step has a position and its **state** ("1 · Started", "2 · shipped", "3 · delivered") and an **answer** (status, headers, body, optional delay):
   - step 1 (`Started`) answers `{"status":"pending"}`;
   - step 2 (`shipped`) answers `{"status":"shipped"}`;
   - step 3 (`delivered`) answers `{"status":"delivered"}`.
   **Then move to** defaults to the next step's state; the last step stays.
4. **Create scenario**. One mock per step is saved, named `order-status — Started` and so on. It is all or nothing: if one step is refused, the ones already saved are removed again and the page says which step failed and why.
5. Open any of its mocks, **Test**, and **Send** three times: `pending`, `shipped`, `delivered`.

**Reordering steps.** The arrow buttons move a step's **answer** up or down; the states stay with the positions. Step 1 always answers in `Started`, so moving an answer to the top makes it the first answer. The two cards that swapped flash, and the page says what moved (`Answer 200 · {"status":"shipped"} is now first (answers in Started)`).

**Edit or delete.** **Edit scenario** on a scenario's card (or in the Mocks list, or **Edit the whole scenario** in the editor of one of its mocks) opens the same page over its mocks: rename, change answers, add, remove or reorder steps. **Save scenario** writes only the differences, all or nothing. **Delete scenario** removes its mocks after you confirm.

**Watch and control.** The Scenarios page draws each scenario as a small state machine with WireMock's **live state** (refreshed every 2 seconds). **Set as current** moves a scenario to a state; **Reset** puts one back to `Started`; **Reset all** resets every scenario. Each card (and the edit page) says which request the scenario answers ("Answers GET /payments/p-9"): **Copy as curl** copies a command that calls it, **Try** sends it from the app so you can watch the state move.

**Find one.** **Search scenarios** looks at scenario names, state names, and the names and paths of their mocks (case does not matter). The page shows 20 scenarios at a time; the search and the page are in the URL, so a link or the browser's back button brings you to the same view. **Reset all** still resets every scenario, not only the ones shown.

## Tips and limits

- A step is one mock because WireMock answers one response per stub; the UI lets you edit them as one, and the Mocks list folds them into one row.
- **Add a mock to this scenario** on a card adds a step after the last one in the mock editor (and moves the old last step on to it).
- Any mock can join a scenario by hand: **Answer differently on later calls** in the editor.
- Mocks the builder cannot show as a step (a proxy, a webhook, a fault, a file body…) are listed under **Kept as is** and left untouched.
- WireMock cannot set the state of a scenario whose name has spaces or symbols; only **Reset all** reaches those.
