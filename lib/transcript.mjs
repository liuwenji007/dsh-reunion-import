/**
 * The transcript archive: one JSON object per line with exactly
 * `{ role, content, ts, turn }`, plus the streaming merge that keeps repeated
 * imports idempotent and multi-session imports in one continuous timeline.
 *
 * @module dsh-reunion-import/transcript
 */

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { createInterface } from 'node:readline'

/** File name of the archive inside one persona directory. */
export const TRANSCRIPT_FILE = 'transcript.jsonl'

/**
 * Stable identity of one message, used to make repeated imports idempotent.
 * The timestamp participates when it exists, so two identical sentences said
 * at different times both survive.
 * @param {{ role: string, content: string, ts: number | null }} entry - normalized message.
 * @returns {string} hex SHA-256 fingerprint.
 */
export function fingerprint(entry) {
  return createHash('sha256')
    .update(entry.role)
    .update('\u0000')
    .update(entry.ts === null || entry.ts === undefined ? '' : String(entry.ts))
    .update('\u0000')
    .update(entry.content)
    .digest('hex')
}

/**
 * Sort normalized messages into one timeline. Entries keep their relative
 * order when timestamps tie, and undated entries follow dated ones.
 * @param {readonly { role: string, content: string, ts: number | null, session?: string }[]} messages
 * @returns {{ role: string, content: string, ts: number | null, session?: string }[]} a new sorted array.
 */
export function sortMessages(messages) {
  const decorated = messages.map((message, index) => ({ message, index }))
  decorated.sort((left, right) => {
    const a = left.message.ts
    const b = right.message.ts
    if (a === b) return left.index - right.index
    if (a === null || a === undefined) return 1
    if (b === null || b === undefined) return -1
    return a - b
  })
  return decorated.map(item => item.message)
}

/**
 * Read one transcript line into a normalized entry, or null when the line is
 * damaged. The archive is plugin-owned, so a bad line is skipped rather than
 * failing the whole read.
 * @param {string} line - raw line without the trailing newline.
 * @param {number} lineNumber - 1-based line number for diagnostics.
 * @returns {{ entry: { role: 'user'|'assistant'|'system', content: string, ts: number|null, turn: number } } | { badLine: number }} parsed entry or the bad line number.
 */
export function parseTranscriptLine(line, lineNumber) {
  if (line.trim() === '') return { badLine: lineNumber }
  let value
  try {
    value = JSON.parse(line)
  } catch {
    return { badLine: lineNumber }
  }
  if (value === null || typeof value !== 'object') return { badLine: lineNumber }
  const role = value.role
  const content = value.content
  if (role !== 'user' && role !== 'assistant' && role !== 'system') return { badLine: lineNumber }
  if (typeof content !== 'string' || content.length === 0) return { badLine: lineNumber }
  const ts = typeof value.ts === 'number' && Number.isFinite(value.ts) ? value.ts : null
  const turn = typeof value.turn === 'number' && Number.isFinite(value.turn) ? value.turn : 0
  return { entry: { role, content, ts, turn } }
}

/**
 * Stream one transcript file. Damaged lines are counted, never thrown.
 * @param {string} file - absolute transcript path.
 * @param {{ onBadLine?: (lineNumber: number) => void, signal?: AbortSignal }} [options]
 * @returns {AsyncGenerator<{ role: 'user'|'assistant'|'system', content: string, ts: number|null, turn: number }>} entries in file order.
 */
export async function* iterateTranscript(file, options = {}) {
  const { signal } = options
  const stream = createReadStream(file, { encoding: 'utf8' })
  let lineNumber = 0
  try {
    for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
      if (signal?.aborted === true) throw signal.reason ?? new Error('aborted')
      lineNumber++
      const parsed = parseTranscriptLine(line, lineNumber)
      if ('badLine' in parsed) {
        options.onBadLine?.(parsed.badLine)
        continue
      }
      yield parsed.entry
    }
  } finally {
    stream.close()
  }
}

/**
 * Read a whole transcript into memory. Callers that must stay memory-bounded
 * stream instead.
 * @param {string} file - absolute transcript path.
 * @param {number} [limit] - maximum entries to return.
 * @returns {Promise<{ role: string, content: string, ts: number|null, turn: number }[]>} entries.
 */
export async function readTranscript(file, limit = Number.POSITIVE_INFINITY) {
  const entries = []
  for await (const entry of iterateTranscript(file)) {
    entries.push(entry)
    if (entries.length >= limit) break
  }
  return entries
}

/** Comparison used by the merge: dated entries first, then undated ones. */
function compareTs(a, b) {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a - b
}

/**
 * Merge incoming messages into a transcript file without loading it.
 *
 * The file is rewritten through a temporary sibling and renamed into place, so
 * a crash leaves the previous archive intact. Lines already present (same
 * fingerprint) are dropped, which makes importing the same export twice a
 * no-op and keeps partially overlapping exports from duplicating messages.
 *
 * @param {object} request - merge inputs.
 * @param {string} request.file - absolute transcript path.
 * @param {readonly { role: string, content: string, ts: number | null }[]} request.incoming - normalized messages, any order.
 * @param {number} [request.maxMessages] - refusal threshold for the merged archive.
 * @param {AbortSignal} [request.signal] - cancellation during the rewrite.
 * @returns {Promise<{ added: number, duplicates: number, total: number, badLines: number, bytes: number, sha256: string, from: number | null, to: number | null, turns: number }>} merge statistics.
 */
export async function mergeIntoTranscript(request) {
  const { file, incoming, maxMessages = Number.POSITIVE_INFINITY, signal } = request
  const sorted = sortMessages(incoming)
  const seen = new Set()
  const fresh = []
  let duplicates = 0
  for (const message of sorted) {
    if (typeof message.content !== 'string' || message.content.length === 0) continue
    const key = fingerprint(message)
    if (seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    fresh.push({ role: message.role, content: message.content, ts: typeof message.ts === 'number' ? message.ts : null })
  }

  let existingSize = null
  try {
    existingSize = (await stat(file)).size
  } catch {
    existingSize = null
  }
  if (existingSize === null && fresh.length === 0) {
    throw new Error('nothing to write: the import produced no messages')
  }

  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
  const hash = createHash('sha256')
  const out = createWriteStream(temporary, { encoding: 'utf8' })
  const write = chunk => new Promise((resolve, reject) => {
    out.write(chunk, error => (error ? reject(error) : resolve()))
  })
  const taken = new Set()
  let pending = []
  let pendingBytes = 0
  let lines = 0
  let existingLines = 0
  let bytes = 0
  let badLines = 0
  let turn = 0
  let users = 0
  let from = null
  let to = null

  const flush = async () => {
    if (pending.length === 0) return
    const chunk = pending.join('')
    pending = []
    pendingBytes = 0
    await write(chunk)
  }

  const emit = async message => {
    const entry = {
      role: message.role,
      content: message.content,
      ts: typeof message.ts === 'number' ? message.ts : null,
      turn: ++turn,
    }
    if (entry.role === 'user') users++
    const line = `${JSON.stringify(entry)}\n`
    hash.update(line)
    bytes += Buffer.byteLength(line)
    lines++
    pending.push(line)
    pendingBytes += line.length
    if (entry.ts !== null) {
      if (from === null || entry.ts < from) from = entry.ts
      if (to === null || entry.ts > to) to = entry.ts
    }
    if (pendingBytes >= 256 * 1024) await flush()
  }

  try {
    if (existingSize !== null) {
      const iterator = iterateTranscript(file, { signal, onBadLine: () => { badLines++ } })[Symbol.asyncIterator]()
      let nextExisting = await iterator.next()
      let index = 0
      while (index < fresh.length || nextExisting.done !== true) {
        const message = index < fresh.length ? fresh[index] : undefined
        const current = nextExisting.done === true ? undefined : nextExisting.value
        if (message === undefined && current === undefined) break
        const takeFresh = current === undefined
          || (message !== undefined && compareTs(message.ts, current.ts) <= 0)
        if (takeFresh) {
          taken.add(fingerprint(message))
          await emit(message)
          index++
          continue
        }
        const key = fingerprint(current)
        if (taken.has(key)) {
          duplicates++
        } else {
          await emit(current)
        }
        existingLines++
        nextExisting = await iterator.next()
      }
      await iterator.return?.()
    } else {
      for (const message of fresh) {
        taken.add(fingerprint(message))
        await emit(message)
      }
    }
    await flush()
    out.end()
    await new Promise((resolve, reject) => out.on('close', resolve).on('error', reject))
    if (turn > maxMessages) {
      await rm(temporary, { force: true })
      throw new Error(`the merged transcript would hold ${turn} messages, above config.maxMessages (${maxMessages})`)
    }
    await rename(temporary, file)
  } catch (error) {
    out.destroy()
    await rm(temporary, { force: true })
    throw error
  }

  return {
    added: turn - existingLines,
    duplicates,
    total: turn,
    users,
    badLines,
    bytes,
    sha256: hash.digest('hex'),
    from,
    to,
    turns: users,
  }
}
