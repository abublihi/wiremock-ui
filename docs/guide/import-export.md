---
title: Import and export
order: 11
routes: /import
summary: Bring mocks in from files, folders, zips and Postman, tagged as you review them; take them out as a bundle or WireMock mappings.
---

# Import and export

## What it is

**Import & export** reads mocks from files and writes them back out, to move them between environments, keep them in Git, or start from what you already have. Before anything is imported you review it: which mocks, which tags, and what each one will do.

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
- The page lists every file with what it holds ("3 mocks") or why it can't be used. Remove or fix the ones with an error; **Import** stays off until every file is usable.
- Tick **Remove baseline mocks that aren't in this import** to also prune baseline mocks missing from the files.

**Review before importing.** The mocks are grouped by a **suggested tag**: the tags they already carry (they keep them), else their old integration (in a bundle from an older version), else the first part of their URL (`/blog/…` → `blog`). For each group, rename the tag or turn it off; untick mocks you don't want; **Add tag to selected** puts one more tag on every ticked mock. Each mock shows what the import will do (**New**, **Updates a mock**, **Unchanged**, or **Skipped** when a person owns it), and the line under the list sums it up. Nothing is written until **Import**.

- With **Remove baseline mocks that aren't in this import** ticked, unticked mocks count as not in the import.
- **Stubs that differ only by one part of the URL** (`/blog/posts/1`, `/blog/posts/2`, maybe a regex `/blog/posts/.*` for the rest) are offered as **One mock, N responses** (the regex becomes **Every other request**; see [Tags and several responses](tags.md)). Pick **Keep N mocks** to import them as they are.

A file can be a bundle (`{ "mocks": [...] }`), a WireMock export (`{ "mappings": [...] }`), one stub, an array of stubs, or a Postman collection.

**Import a Postman collection.** Export it from Postman (**Export → Collection v2.1**) and choose the file. Each saved example becomes a mock: the request's first `2xx` example answers every call to that request, the others only the calls their saved request differs in. The mocks are tagged with the collection's name and the request's top folder (`Blog API` / `Posts` → `blog-api`, `posts`), then reviewed like any other import. Auth helpers, scripts, GraphQL and file bodies are left out and listed.

**Export.** **Export** on the Mocks list downloads what the list shows (the mocks of one tag, your mocks, or everything); the Import & export page exports everything. Formats: **Bundle (.json)**, ready to import here again, or **WireMock mappings (.zip)**. Tags and several responses are kept in each stub's `metadata.wiremockUi`.

Before importing an export with **Remove baseline mocks that aren't in this import** ticked, check what it holds: an export of one tag or of your mocks only lists those, so every other baseline mock would be removed. Prune only with a full export (the Import & export page, or everything on the Mocks list).

## Tips and limits

- Imported mocks are **baseline** (owned by nobody) unless the file names an owner. Mocks owned by a person are never changed by an import.
- Bundles from older versions that still hold `integrations` and `catalog` import as they are; their mocks are migrated to tags and mocks with several responses (see the end of [Concepts](concepts.md)).
- Mocks without an `id` get one from their content, so importing the same file twice changes nothing.
- One import is at most 10 MB; a zip at most 2,000 entries.
- `SEED_PATH` imports a bundle file or folder as baseline mocks on every start (see `docs/INSTALL.md`; `examples/seed.json` in the repository is a ready-made one).
