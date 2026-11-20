---
title: Import and export
order: 11
routes: /import
summary: Bring mocks and integrations in from files, folders, zips and Postman; take them out as a bundle or WireMock mappings.
---

# Import and export

## What it is

**Import & export** reads mocks and integrations from files and writes them back out, to move them between environments, keep them in Git, or start from what you already have.

## What it does in WireMock

Imported stubs are WireMock stub mappings as they are (a WireMock `mappings/` folder works unchanged). They are saved like any other mock: checked, pushed into WireMock, stored. Exported **WireMock mappings** are one stub per file, ready for a WireMock `mappings` folder.

```stub
{
  "mappings": [
    { "request": { "method": "GET", "urlPath": "/blog/posts" }, "response": { "status": 200, "jsonBody": [] } }
  ]
}
```

## How to

**Import files.** [Open Import & export →](/import), then:

- **Choose files** (one or more `.json`, or a `.zip`), or **Choose folder** (every `.json` inside, sub-folders included), or drop them on the page.
- The page lists every file with what it holds ("1 integration · 2 endpoints · 3 mocks") or why it can't be used. Remove or fix the ones with an error; **Import** stays off until every file is usable.
- Tick **Remove baseline mocks that aren't in this import** to also prune baseline mocks missing from the files.

A file can be a bundle (`{ "integrations", "catalog", "mocks" }`), a WireMock export (`{ "mappings": [...] }`), one stub, or an array of stubs.

**Import a Postman collection.** Export it from Postman (**Export → Collection v2.1**) and choose the file. The collection becomes one integration, each request an endpoint, each saved example a mock; pick the **Default answer** per endpoint, settle key clashes (**Create new**, **Overwrite** or **Skip**), then import. Auth helpers, scripts, GraphQL and file bodies are left out and listed.

**Export.** **Export** on the Mocks list downloads what the list shows (an integration, your mocks, or everything); the Import & export page exports everything. Formats: **Bundle (.json)**, ready to import here again, or **WireMock mappings (.zip)**.

Before importing an export with **Remove baseline mocks that aren't in this import** ticked, check what it holds: an export of one integration or of your mocks only lists those, so every other baseline mock would be removed. Prune only with a full export (the Import & export page, or **Everything** on the Mocks list).

## Tips and limits

- Imported mocks are **baseline** (owned by nobody) unless the file names an owner. Mocks owned by a person are never changed by an import.
- A mock without an integration is assigned to the integration with the longest prefix its URL starts with.
- Mocks without an `id` get one from their content, so importing the same file twice changes nothing.
- One import is at most 10 MB; a zip at most 2,000 entries.
- `SEED_PATH` imports a bundle file or folder as baseline mocks on every start (see `docs/INSTALL.md`; `examples/seed.json` in the repository is a ready-made one).
