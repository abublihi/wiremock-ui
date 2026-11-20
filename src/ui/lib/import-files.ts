import { unzipSync } from 'fflate'
import { byPath, emptyBundle, mergeInto, parseBundle, type Bundle } from '@/server/bundle/shape'
import type { MessageKey } from '@/ui/i18n'

/** The server's import limit (POST /api/import); also the limit for a zip and for what it unpacks to. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_ZIP_ENTRIES = 2000

export type ImportSummary = { integrations: number; endpoints: number; mocks: number; oidcIdentities: number }
/** A message the page translates. */
export type FileMessage = { key: MessageKey; params: Record<string, string | number> }

/** A file's path as the user knows it (folder- or zip-relative) and its text. */
export type SourceFile = { path: string; text: string }

export type FileResult =
  | { path: string; ok: true; bundle: Bundle; summary: ImportSummary }
  | { path: string; ok: false; error: FileMessage }

/** A whole-input problem (a zip over the limits, a file that is not a zip…). */
export class ImportFileError extends Error {
  readonly key: MessageKey
  readonly params: Record<string, string | number>
  constructor(key: MessageKey, params: Record<string, string | number>) {
    super(key)
    this.name = 'ImportFileError'
    this.key = key
    this.params = params
  }
}

const segments = (path: string) => path.split(/[\\/]/)
export const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1)

/** A zip entry name that stays inside the archive: not absolute, no drive letter, no `..` segment. */
export function isSafeEntryPath(name: string): boolean {
  if (name === '' || name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) return false
  return !segments(name).includes('..')
}

/** A .json file not inside a hidden folder and not itself hidden (".DS_Store", "._a.json", ".git/…"). */
export function isFolderJson(path: string): boolean {
  const parts = segments(path)
  return path.toLowerCase().endsWith('.json') && !parts.some((p) => p.startsWith('.'))
}

/** The .json files of a zip, read in memory (nothing is written anywhere), sorted by path. */
export function readZip(bytes: Uint8Array, zipName: string): { files: SourceFile[]; skipped: string[] } {
  if (bytes.length > MAX_IMPORT_BYTES) throw new ImportFileError('import.tooLarge', { name: zipName, size: megabytes(bytes.length) })
  const skipped: string[] = []
  let entries = 0
  let unpacked = 0
  const tooLarge = () => new ImportFileError('import.zipTooLarge', { name: zipName })
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(bytes, {
      filter: (entry) => {
        if (++entries > MAX_ZIP_ENTRIES) throw new ImportFileError('import.zipTooManyEntries', { name: zipName, max: MAX_ZIP_ENTRIES })
        if (entry.name.endsWith('/')) return false
        if (!isSafeEntryPath(entry.name)) {
          skipped.push(entry.name)
          return false
        }
        if (!isFolderJson(entry.name)) return false
        unpacked += entry.originalSize
        if (unpacked > MAX_IMPORT_BYTES) throw tooLarge()
        return true
      },
    })
  } catch (error) {
    if (error instanceof ImportFileError) throw error
    throw new ImportFileError('import.zipUnreadable', { name: zipName })
  }
  // The sizes above come from the archive's own headers; count what was really unpacked too.
  const actual = Object.values(raw).reduce((sum, data) => sum + data.length, 0)
  if (actual > MAX_IMPORT_BYTES) throw tooLarge()
  const decoder = new TextDecoder()
  const files = Object.entries(raw)
    .map(([name, data]) => ({ path: `${zipName}/${name}`, text: decoder.decode(data) }))
    .sort((a, b) => byPath(a.path, b.path))
  return { files, skipped }
}

const summaryOf = (b: Bundle): ImportSummary => ({
  integrations: b.integrations.length,
  endpoints: b.catalog.length,
  mocks: b.mocks.length,
  oidcIdentities: b.oidcIdentities.length,
})

/** Parses one file with the server's own shape rules (a bundle, a WireMock export, a stub or an array of stubs). */
export function parseSourceFile(file: SourceFile): FileResult {
  let json: unknown
  try {
    json = JSON.parse(file.text)
  } catch (error) {
    return { path: file.path, ok: false, error: { key: 'import.invalidJson', params: { name: file.path, message: error instanceof Error ? error.message : '' } } }
  }
  try {
    const bundle = parseBundle(json, file.path)
    return { path: file.path, ok: true, bundle, summary: summaryOf(bundle) }
  } catch (error) {
    return { path: file.path, ok: false, error: { key: 'import.fileShape', params: { message: error instanceof Error ? error.message : String(error) } } }
  }
}

/** The parsed files merged into one bundle in path order, and its size as the request body. */
export function mergeResults(results: FileResult[]): { bundle: Bundle; summary: ImportSummary; bytes: number } {
  const bundle = emptyBundle()
  for (const r of [...results].sort((a, b) => byPath(a.path, b.path))) if (r.ok) mergeInto(bundle, r.bundle)
  return { bundle, summary: summaryOf(bundle), bytes: new TextEncoder().encode(JSON.stringify(bundle)).length }
}

/* ---------- Reading what the user picked or dropped (browser only) ---------- */

/** A picked or dropped file with the path to show (folder-relative when it came from a folder). */
export type PickedFile = { path: string; file: File }

const pathOf = (file: File) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name

/** Files from an <input type="file" multiple> or <input webkitdirectory>. */
export function pickedFromInput(list: FileList | File[]): PickedFile[] {
  return Array.from(list).map((file) => ({ path: pathOf(file), file }))
}

type Entry = FileSystemEntry
const isDir = (e: Entry): e is FileSystemDirectoryEntry => e.isDirectory
const isFile = (e: Entry): e is FileSystemFileEntry => e.isFile

async function walk(entry: Entry, out: PickedFile[]): Promise<void> {
  // Hidden files and folders are skipped as a whole (".git", ".DS_Store").
  if (entry.name.startsWith('.')) return
  if (isFile(entry)) {
    const file = await new Promise<File>((resolve, reject) => entry.file(resolve, reject))
    out.push({ path: entry.fullPath.replace(/^\//, ''), file })
  } else if (isDir(entry)) {
    const reader = entry.createReader()
    // readEntries returns at most ~100 entries per call: read until it returns none.
    for (;;) {
      const batch = await new Promise<Entry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (batch.length === 0) break
      for (const child of batch) await walk(child, out)
    }
  }
}

/** Files from a drop: plain files, and every file inside dropped folders (recursively). */
export async function pickedFromDrop(data: DataTransfer): Promise<{ picked: PickedFile[]; fromFolder: Set<string> }> {
  const entries = Array.from(data.items ?? [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null)
  // Without the entries API (or in tests), fall back to the plain file list.
  if (entries.length === 0 || entries.some((e) => e === null)) return { picked: pickedFromInput(data.files), fromFolder: new Set() }
  const picked: PickedFile[] = []
  const fromFolder = new Set<string>()
  for (const entry of entries as Entry[]) {
    const before = picked.length
    if (isDir(entry)) {
      await walk(entry, picked)
      for (const p of picked.slice(before)) fromFolder.add(p.path)
    } else await walk(entry, picked)
  }
  return { picked, fromFolder }
}

const readBytes = async (file: File) => new Uint8Array(await file.arrayBuffer())

/**
 * Turns picked files into parsed results. Loose files must be .json or .zip; inside folders only .json files count
 * (others are ignored). Every file is checked against the 10 MB limit before it is read.
 */
export async function loadPicked(
  picked: PickedFile[],
  opts: { folder: (p: PickedFile) => boolean },
): Promise<{ results: FileResult[]; skipped: string[] }> {
  const results: FileResult[] = []
  const skipped: string[] = []
  const tooLarge = (p: PickedFile): FileResult => ({
    path: p.path,
    ok: false,
    error: { key: 'import.tooLarge', params: { name: p.path, size: megabytes(p.file.size) } },
  })
  for (const p of picked) {
    const lower = p.path.toLowerCase()
    if (opts.folder(p)) {
      if (!isFolderJson(p.path)) continue
    } else if (!lower.endsWith('.json') && !lower.endsWith('.zip')) {
      results.push({ path: p.path, ok: false, error: { key: 'import.notJson', params: { name: p.path } } })
      continue
    }
    if (p.file.size > MAX_IMPORT_BYTES) {
      results.push(tooLarge(p))
      continue
    }
    if (lower.endsWith('.zip') && !opts.folder(p)) {
      try {
        const zip = readZip(await readBytes(p.file), p.path)
        skipped.push(...zip.skipped.map((s) => `${p.path}/${s}`))
        if (zip.files.length === 0) results.push({ path: p.path, ok: false, error: { key: 'import.zipEmpty', params: { name: p.path } } })
        results.push(...zip.files.map(parseSourceFile))
      } catch (error) {
        if (!(error instanceof ImportFileError)) throw error
        results.push({ path: p.path, ok: false, error: { key: error.key, params: error.params } })
      }
      continue
    }
    let text: string
    try {
      text = await p.file.text()
    } catch {
      results.push({ path: p.path, ok: false, error: { key: 'import.readFailed', params: { name: p.path } } })
      continue
    }
    results.push(parseSourceFile({ path: p.path, text }))
  }
  results.sort((a, b) => byPath(a.path, b.path))
  return { results, skipped }
}
