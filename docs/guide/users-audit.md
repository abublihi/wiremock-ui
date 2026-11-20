---
title: Users and audit
order: 12
routes: /users, /audit
summary: Who can sign in, and who changed what.
---

# Users and audit

## What it is

**Users** lists the accounts that can sign in. **Audit** lists who changed what: mocks, integrations, users, imports, recordings, cleared request logs and syncs, newest first.

## What it does in WireMock

Nothing: accounts and the audit log belong to wiremock-ui. WireMock's admin API is reached only by the UI's server, with its own credentials (`WIREMOCK_ADMIN_USER` / `WIREMOCK_ADMIN_PASSWORD`); people never need them.

## How to

- **Add a user:** [Open Users →](/users) → **Add user**, with a username and an initial password (8–72 characters). Tell them to change it from the account menu (**Change password**).
- **Reset a password, disable or delete an account:** the row menu on the Users page. The last active account cannot be disabled or deleted; deleting an account keeps its mocks.
- **See who changed something:** [Open Audit →](/audit). **Load more** goes further back.
- **Scripts and CI:** create a dedicated account and use it with HTTP Basic auth (see [Scripts and the API](api.md)).

## Tips and limits

- There are no roles: every signed-in user can do everything. Mocks still record their owner, so **My mocks** stays useful.
- The first account comes from `ADMIN_USER` / `ADMIN_PASSWORD` on the first start.
- After 10 failed sign-ins in 15 minutes from one network, sign-in is blocked for the rest of that window.
- The audit log keeps 30 days (the last 500 entries, in memory, in WireMock-only mode).
- In WireMock-only mode there is one account (`ADMIN_USER`) and no Users page.
