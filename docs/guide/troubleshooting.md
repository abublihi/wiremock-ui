---
title: Troubleshooting and FAQ
order: 16
routes:
summary: The usual reasons a mock does not answer, a recording is empty, or a save is refused.
---

# Troubleshooting and FAQ

## What it is

Answers to the questions people ask most, each with the fix.

## What it does in WireMock

Most of these come down to how WireMock matches: a request must match **every** part of a stub (method, path, query, headers, body); the lowest priority number wins; a stub with a scenario only answers in its state.

## How to

**My app gets 404 and the log says No match.** Click the **No match** stamp in the [request log](/requests) and read the highlighted near-miss row. Usual causes: a value no response of the mock is for (add one, or turn on **Every other request**; see [Tags and several responses](tags.md)), a `Content-Type` the mock does not expect, a trailing `/`, a query parameter the mock requires, or the wrong method. See [Request log and near misses](request-log.md).

**My app never shows up in the request log.** It is not calling WireMock. Check the base URL in your app's settings: it must be WireMock's address (the one in **Copy as curl**), not the real service and not the UI's address.

**Another mock answered (Matched another mock).** Two mocks match the same request. The lower priority number wins (WireMock's default is 5; **Every other request** is 5 lower than the rest of its mock); with equal priorities a person's mock beats a baseline mock and the newest wins. Make the request more specific, or delete the other mock. See [Concepts](concepts.md).

**A scenario keeps giving the same answer.** It is stuck in a state no next step leaves, or the scenario moved on already. Open [Scenarios](/scenarios), check the live state, and **Reset** it to `Started`.

**Recording stopped with nothing to review.** The message says which: requests went through but your filters (method, paths to record) left them out, or no request reached WireMock while recording. See "Nothing was recorded?" in [Recording and snapshots](recording.md).

**"Someone changed this mock since you opened it".** Another person saved it first. **Copy my JSON** keeps your draft; **Reload** shows theirs; apply your change again.

**My mock disappeared after someone restarted WireMock.** It comes back within `SYNC_INTERVAL_SECONDS` (5 by default) when the UI has a store. In WireMock-only mode the UI keeps nothing, so stubs WireMock did not have in its own files are gone. See [Sync with WireMock](sync.md).

**A stub I added straight to WireMock vanished.** With a store, the UI is the source of truth; the next full sync removes stubs it does not know. Add it through the UI or an import.

**A webhook never arrives.** It is sent from WireMock's machine: `localhost` there is WireMock's host. Use an address WireMock can reach, and `originalRequest` (not `request`) in templates. See [Webhooks](webhooks.md).

**Sign-in says "Too many sign-in attempts".** 10 failed attempts in 15 minutes from one network block sign-in for the rest of that window.

## Tips and limits

- `GET /healthz` (no sign-in) shows whether the UI, the store and WireMock are reachable and when the last sync ran.
- Start-up errors (WireMock unreachable, admin credentials) are covered in `docs/INSTALL.md` under Troubleshooting.
