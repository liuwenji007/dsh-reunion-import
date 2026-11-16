/**
 * Detection and opening of a user-supplied export.
 *
 * Supported inputs, in the order they are tried: a DeepSeek export ZIP, an
 * already extracted export directory, JSON Lines, and one JSON document. The
 * file is inspected by reading a bounded head, never the whole thing.
 *
 * @module dsh-reunion-import/source
 */

import { createReadStream } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { openZip } from './zip.mjs'
import { walkJson } from './json-stream.mjs'
import { hashDirectory, hashFile } from './store.mjs'

/** Read size used to sniff the file format. */
const HEAD_BYTES = 64 * 1024

/** ZIP local-file, empty-archive, and spanned markers. */
const ZIP_MAGICS = [[0x50, 0x4b, 0x03, 0x04], [0x50, 0x4b, 0x05, 0x06], [0x50, 0x4b, 0x07, 0x08]]

/**
 * Read at most `length` bytes from the start of a file.
 * @param {string} path - file to read.
 * @param {number} length - maximum bytes.
 * @returns {Promise<Buffer>} the head bytes.
 */
export async function readHead(path, length = HEAD_BYTES) {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * Remove a UTF-8 byte-order mark.
 * @param {string} text - decoded text.
 * @returns {string} text without a leading BOM.
 */
export function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/**
 * Whether the head bytes carry a ZIP signature.
 * @param {Buffer} head - first bytes of the file.
 * @returns {boolean} true for a ZIP archive.
 */
export function looksLikeZip(head) {
  return ZIP_MAGICS.some(magic => magic.every((byte, index) => head[index] === byte))
}

/**
 * Whether one line parses as a complete JSON value.
 * @param {string} line - candidate line.
 * @returns {boolean} true when the line is JSON.
 */
function isJsonLine(line) {
  const trimmed = line.trim()
  if (trimmed === '') return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    return false
  }
}

/**
 * Detect the input kind of an existing path.
 * @param {string} path - export file or extracted directory.
 * @param {{ maxJsonBytes: number }} config - resolved config.
 * @returns {Promise<{ kind: 'zip'|'dir'|'jsonl'|'json'|'unknown'|'empty', path: string, bytes: number, extension: string, head: string }>} detection result.
 */
export async function detectKind(path, config) {
  const info = await stat(path)
  const extension = basename(path).toLowerCase().split('.').pop() ?? ''
  if (info.isDirectory()) return { kind: 'dir', path, bytes: 0, extension, head: '' }
  if (info.size === 0) return { kind: 'empty', path, bytes: 0, extension, head: '' }
  const head = await readHead(path, HEAD_BYTES)
  if (looksLikeZip(head)) return { kind: 'zip', path, bytes: info.size, extension, head: '' }
  const text = stripBom(head.toString('utf8'))
  const stripped = text.trimStart()
  if (!stripped.startsWith('{') && !stripped.startsWith('[')) {
    return { kind: 'unknown', path, bytes: info.size, extension, head: text.slice(0, 2000) }
  }
  if (extension === 'jsonl' || extension === 'ndjson') return { kind: 'jsonl', path, bytes: info.size, extension, head: text }
  const lines = text.split(/\r?\n/u).filter(line => line.trim() !== '').slice(0, 3)
  const jsonLines = lines.filter(isJsonLine).length
  if (lines.length >= 2 && jsonLines === lines.length) return { kind: 'jsonl', path, bytes: info.size, extension, head: text }
  void config
  return { kind: 'json', path, bytes: info.size, extension, head: text }
}

/**
 * List every regular file of an extracted export directory as archive-style
 * entry names (`a/b.json`).
 * @param {string} root - directory root.
 * @returns {Promise<string[]>} relative entry names with forward slashes.
 */
export async function listDirectoryEntries(root) {
  const names = []
  const walk = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (entry.isFile()) names.push(full.slice(root.length + 1).split('\\').join('/'))
    }
  }
  await walk(root)
  names.sort()
  return names
}

/**
 * Iterate one JSON Lines file without loading it.
 * @param {string} path - file path.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {AsyncGenerator<string>} trimmed non-empty lines.
 */
export async function* iterateFileLines(path, signal) {
  const stream = createReadStream(path, { encoding: 'utf8' })
  let carry = ''
  try {
    for await (const chunk of stream) {
      if (signal?.aborted === true) throw signal.reason ?? new Error('aborted')
      carry += chunk
      const lines = carry.split(/\r?\n/u)
      carry = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = stripBom(line).trim()
        if (trimmed !== '') yield trimmed
      }
    }
    const last = stripBom(carry).trim()
    if (last !== '') yield last
  } finally {
    stream.close()
  }
}

/**
 * Open an input as a uniform read-only source.
 * @param {string} path - export file or extracted directory.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} config - resolved config.
 * @returns {Promise<{
 *   kind: 'zip'|'dir'|'jsonl'|'json'|'unknown'|'empty',
 *   path: string,
 *   bytes: number,
 *   entryNames(): string[],
 *   hasEntry(name: string): boolean,
 *   readEntry(name: string): Promise<Uint8Array | undefined>,
 *   readEntryText(name: string): Promise<string | undefined>,
 *   walk(handler: Parameters<typeof walkJson>[2], options?: object): Promise<void>,
 *   lines(signal?: AbortSignal): AsyncGenerator<string>,
 *   hash(signal?: AbortSignal): Promise<string>,
 *   close(): Promise<void>,
 * }>} uniform source.
 */
export async function openSource(path, config) {
  const detected = await detectKind(path, config)
  /** @type {Awaited<ReturnType<typeof openZip>> | null} */
  let zip = null
  /** @type {string[] | null} */
  let directoryNames = null
  if (detected.kind === 'zip') zip = await openZip(path, { maxEntryBytes: config.maxEntryBytes })
  if (detected.kind === 'dir') directoryNames = await listDirectoryEntries(path)

  const entryNames = () => {
    if (zip !== null) return zip.names()
    if (directoryNames !== null) return [...directoryNames]
    return []
  }
  const hasEntry = name => {
    if (zip !== null) return zip.has(name)
    if (directoryNames !== null) return directoryNames.includes(name)
    return false
  }
  const readEntry = async name => {
    if (zip !== null) return zip.read(name, { maxEntryBytes: config.maxEntryBytes })
    if (directoryNames !== null && directoryNames.includes(name)) {
      const { readFile } = await import('node:fs/promises')
      return readFile(join(path, ...name.split('/')))
    }
    return undefined
  }
  const hash = async signal => {
    if (zip !== null || detected.kind === 'json' || detected.kind === 'jsonl') return hashFile(path, signal)
    if (directoryNames !== null) return hashDirectory(path)
    return hashFile(path, signal)
  }

  return {
    kind: detected.kind,
    path,
    bytes: detected.bytes,
    head: detected.head,
    extension: detected.extension,
    entryNames,
    hasEntry,
    readEntry,
    async readEntryText(name) {
      const bytes = await readEntry(name)
      return bytes === undefined ? undefined : stripBom(Buffer.from(bytes).toString('utf8'))
    },
    walk(handler, options = {}) {
      return walkJson(path, options, handler)
    },
    lines(signal) {
      return iterateFileLines(path, signal)
    },
    hash,
    async close() {
      await zip?.close()
    },
  }
}
