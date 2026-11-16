/**
 * The DeepSeek chat export format (`export_format_version: 3`) as actually
 * written by the DeepSeek exporter:
 *
 * ```
 * manifest.json                       { export_format_version }
 * chat_session_index.json             [{ id, inserted_at, updated_at, ... }]
 * chat_sessions/<id>.json             { id, title, current_message_id, inserted_at, messages[] }
 * chat_sessions/<id>_files/<file>     images (never read by this plugin)
 * ```
 *
 * One message is a node of a tree: `{ id, parent_id, role, status, inserted_at,
 * fragments[] }`, where `fragments` carries the text (`REQUEST` for the user,
 * `RESPONSE`/`TEMPLATE_RESPONSE` for the assistant, plus tool, thinking, and
 * file fragments the plugin ignores). `current_message_id` selects the branch
 * that was on screen; without it the greatest message id is used.
 *
 * The parser is deliberately tolerant: a damaged message or missing parent is
 * a diagnostic, not a crash, because `inspect` must survive whatever the user
 * actually has.
 *
 * @module dsh-reunion-import/deepseek
 */

import { stripBom } from './source.mjs'

/** Entry name of the export manifest. */
export const MANIFEST_ENTRY = 'manifest.json'
/** Entry name of the export conversation index. */
export const INDEX_ENTRY = 'chat_session_index.json'
/** Entry names of conversation files. */
const CONVERSATION_ENTRY = /^chat_sessions\/([^/]+)\.json$/u
/** The export format versions this reader was written against. */
export const SUPPORTED_VERSIONS = Object.freeze([3])

/** Fragment types that carry user text. */
const USER_FRAGMENTS = new Set(['REQUEST'])
/** Fragment types that carry assistant text. */
const ASSISTANT_FRAGMENTS = new Set(['RESPONSE', 'TEMPLATE_RESPONSE'])
/** Fragment types that are recorded but never become transcript content. */
const IGNORED_FRAGMENTS = new Set([
  'THINK', 'TIP', 'TOOL_SEARCH', 'TOOL_OPEN', 'TOOL_FIND', 'READ_LINK',
  'TOOL_IMAGE_SEARCH', 'PARTIAL_FILE_READ', 'FILE',
])

/**
 * Parse JSON text without throwing.
 * @param {string} text - JSON text.
 * @returns {{ value: any } | { error: string }} parsed value or a short error.
 */
export function parseJsonText(text) {
  try {
    return { value: JSON.parse(stripBom(text)) }
  } catch (error) {
    return { error: error.message }
  }
}

/**
 * Convert one export timestamp to epoch milliseconds.
 * @param {unknown} value - RFC 3339 string from the export.
 * @returns {number | null} epoch milliseconds, or null when unusable.
 */
export function parseTime(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < 1e11 ? Math.round(value * 1000) : Math.round(value)
  }
  if (typeof value !== 'string' || value.trim() === '') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * List the conversation ids an archive or extracted directory holds.
 * @param {readonly string[]} entryNames - every entry name in the source.
 * @returns {{ manifest: boolean, index: boolean, conversations: string[] }} what the layout contains.
 */
export function exportLayout(entryNames) {
  const conversations = []
  let manifest = false
  let index = false
  for (const name of entryNames) {
    if (name === MANIFEST_ENTRY) manifest = true
    else if (name === INDEX_ENTRY) index = true
    else {
      const match = CONVERSATION_ENTRY.exec(name)
      if (match !== null) conversations.push(match[1])
    }
  }
  conversations.sort()
  return { manifest, index, conversations }
}

/**
 * Open a DeepSeek export behind a source.
 * @param {Awaited<ReturnType<typeof import('./source.mjs').openSource>>} source - opened source.
 * @param {{ maxInspectSessions: number }} config - resolved config.
 * @returns {Promise<{
 *   manifest: any,
 *   version: number | null,
 *   indexRows: any[],
 *   conversations: { id: string, entry: string, createdAt: number | null, updatedAt: number | null, indexTitle: string | null }[],
 *   diagnostics: { level: string, code: string, detail: string }[],
 *   readConversation(id: string): Promise<{ file: any, diagnostics: any[] }>,
 * }>} the opened export.
 */
export async function openDeepseekExport(source, config) {
  const diagnostics = []
  const layout = exportLayout(source.entryNames())
  if (!layout.manifest) diagnostics.push({ level: 'warn', code: 'export.manifest-missing', detail: MANIFEST_ENTRY })
  if (!layout.index) diagnostics.push({ level: 'warn', code: 'export.index-missing', detail: INDEX_ENTRY })

  let manifest = null
  if (layout.manifest) {
    const text = await source.readEntryText(MANIFEST_ENTRY)
    const parsed = text === undefined ? { error: 'entry missing' } : parseJsonText(text)
    if ('error' in parsed) {
      diagnostics.push({ level: 'error', code: 'export.manifest-damaged', detail: parsed.error })
    } else {
      manifest = parsed.value
    }
  }
  const version = manifest !== null && typeof manifest === 'object' && Number.isFinite(manifest.export_format_version)
    ? Number(manifest.export_format_version)
    : null
  if (version === null) diagnostics.push({ level: 'warn', code: 'export.version-unknown', detail: String(MANIFEST_ENTRY) })
  else if (!SUPPORTED_VERSIONS.includes(version)) {
    diagnostics.push({ level: 'warn', code: 'export.version-unsupported', detail: String(version) })
  }

  let indexRows = []
  if (layout.index) {
    const text = await source.readEntryText(INDEX_ENTRY)
    const parsed = text === undefined ? { error: 'entry missing' } : parseJsonText(text)
    if ('error' in parsed) {
      diagnostics.push({ level: 'error', code: 'export.index-damaged', detail: parsed.error })
    } else if (Array.isArray(parsed.value)) {
      for (const [position, row] of parsed.value.entries()) {
        if (row === null || typeof row !== 'object' || typeof row.id !== 'string' || row.id.length === 0) {
          diagnostics.push({ level: 'warn', code: 'export.index-row-invalid', detail: String(position) })
          continue
        }
        indexRows.push(row)
      }
    } else {
      diagnostics.push({ level: 'warn', code: 'export.index-not-array', detail: typeof parsed.value })
    }
  }

  const byId = new Map(indexRows.map(row => [row.id, row]))
  const conversations = layout.conversations.map(id => {
    const row = byId.get(id)
    return {
      id,
      entry: `chat_sessions/${id}.json`,
      createdAt: row === undefined ? null : parseTime(row.inserted_at),
      updatedAt: row === undefined ? null : parseTime(row.updated_at),
      indexTitle: row !== undefined && typeof row.title === 'string' ? row.title : null,
    }
  })
  void config

  return {
    manifest,
    version,
    indexRows,
    conversations,
    diagnostics,
    async readConversation(id) {
      const text = await source.readEntryText(`chat_sessions/${id}.json`)
      if (text === undefined) {
        return { file: null, diagnostics: [{ level: 'error', code: 'export.conversation-missing', detail: id }] }
      }
      return parseConversation(text, id)
    },
  }
}

/**
 * Known conversation-file keys, used to report unrecognized fields.
 * @type {ReadonlySet<string>}
 */
const CONVERSATION_KEYS = new Set(['id', 'title', 'current_message_id', 'inserted_at', 'updated_at', 'messages'])
/** Known message keys. */
const MESSAGE_KEYS = new Set(['id', 'parent_id', 'role', 'status', 'inserted_at', 'fragments', 'token_count', 'search_enabled', 'thinking_enabled'])
/** Known fragment keys beyond `type`; fragment-specific extras are ignored. */
const FRAGMENT_KEYS = new Set(['type', 'content', 'elapsed_secs', 'queries', 'results', 'status', 'stage_id', 'url', 'title', 'pattern', 'ratio', 'files'])

/**
 * Parse one conversation file tolerantly.
 * @param {string} text - conversation JSON text.
 * @param {string} fallbackId - id from the entry name.
 * @returns {{ file: any, diagnostics: any[] }} normalized conversation and diagnostics.
 */
export function parseConversation(text, fallbackId) {
  const diagnostics = []
  const parsed = parseJsonText(text)
  if ('error' in parsed) {
    return { file: null, diagnostics: [{ level: 'error', code: 'export.conversation-damaged', detail: `${fallbackId}: ${parsed.error}` }] }
  }
  const raw = parsed.value
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { file: null, diagnostics: [{ level: 'error', code: 'export.conversation-shape', detail: fallbackId }] }
  }
  const unknownKeys = Object.keys(raw).filter(key => !CONVERSATION_KEYS.has(key))
  const messages = []
  const unknownMessageFields = new Set()
  const unknownFragmentTypes = new Set()
  for (const [position, item] of (Array.isArray(raw.messages) ? raw.messages : []).entries()) {
    if (item === null || typeof item !== 'object') {
      diagnostics.push({ level: 'warn', code: 'export.message-shape', detail: `${fallbackId}#${position}` })
      continue
    }
    const id = Number.isInteger(item.id) ? item.id : null
    const parentId = Number.isInteger(item.parent_id) ? item.parent_id : null
    const role = typeof item.role === 'string' ? item.role.toUpperCase() : ''
    if (id === null || (role !== 'USER' && role !== 'ASSISTANT' && role !== 'SYSTEM')) {
      diagnostics.push({ level: 'warn', code: 'export.message-shape', detail: `${fallbackId}#${position}` })
      continue
    }
    for (const key of Object.keys(item)) if (!MESSAGE_KEYS.has(key)) unknownMessageFields.add(key)
    const fragments = []
    for (const fragment of Array.isArray(item.fragments) ? item.fragments : []) {
      if (fragment === null || typeof fragment !== 'object' || typeof fragment.type !== 'string') continue
      for (const key of Object.keys(fragment)) {
        if (!FRAGMENT_KEYS.has(key) && key !== 'type') unknownMessageFields.add(`fragments[].${key}`)
      }
      if (!USER_FRAGMENTS.has(fragment.type) && !ASSISTANT_FRAGMENTS.has(fragment.type) && !IGNORED_FRAGMENTS.has(fragment.type)) {
        unknownFragmentTypes.add(fragment.type)
      }
      fragments.push(fragment)
    }
    messages.push({
      id,
      parentId,
      role,
      status: typeof item.status === 'string' ? item.status : '',
      time: parseTime(item.inserted_at),
      insertedAt: typeof item.inserted_at === 'string' ? item.inserted_at : null,
      fragments,
    })
  }
  if (!Array.isArray(raw.messages)) {
    diagnostics.push({ level: 'error', code: 'export.conversation-shape', detail: `${fallbackId}: messages` })
  }
  if (unknownKeys.length > 0) diagnostics.push({ level: 'info', code: 'export.conversation-fields', detail: unknownKeys.join(', ') })
  if (unknownMessageFields.size > 0) diagnostics.push({ level: 'info', code: 'export.message-fields', detail: [...unknownMessageFields].join(', ') })
  if (unknownFragmentTypes.size > 0) diagnostics.push({ level: 'info', code: 'export.fragment-types', detail: [...unknownFragmentTypes].join(', ') })

  return {
    file: {
      id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : fallbackId,
      title: typeof raw.title === 'string' ? raw.title : null,
      currentMessageId: Number.isInteger(raw.current_message_id) ? raw.current_message_id : null,
      insertedAt: typeof raw.inserted_at === 'string' ? raw.inserted_at : null,
      messages,
      unknownKeys,
    },
    diagnostics,
  }
}

/**
 * Select the branch that matches what the user last saw: the path from the root
 * to `current_message_id`, or to the greatest message id when that field is
 * absent or names no message.
 * @param {any} file - normalized conversation.
 * @returns {{ chain: any[], selectedId: number | null, fallback: boolean, alternates: number, diagnostics: any[] }} selected path.
 */
export function selectChain(file) {
  const diagnostics = []
  const byId = new Map()
  let newest = null
  for (const message of file.messages) {
    if (byId.has(message.id)) {
      diagnostics.push({ level: 'warn', code: 'export.duplicate-id', detail: String(message.id) })
      continue
    }
    byId.set(message.id, message)
    if (newest === null || message.id > newest.id) newest = message
  }
  if (newest === null) {
    return { chain: [], selectedId: null, fallback: false, alternates: 0, diagnostics }
  }
  const current = file.currentMessageId === null ? undefined : byId.get(file.currentMessageId)
  const fallback = current === undefined
  const selected = current ?? newest
  const chain = []
  let cursor = selected
  while (cursor !== undefined) {
    if (chain.length > byId.size) {
      diagnostics.push({ level: 'warn', code: 'export.parent-cycle', detail: String(cursor.id) })
      break
    }
    chain.push(cursor)
    if (cursor.parentId === null) return { chain: chain.reverse(), selectedId: selected.id, fallback, alternates: file.messages.length - chain.length, diagnostics }
    const parent = byId.get(cursor.parentId)
    if (parent === undefined) {
      diagnostics.push({ level: 'warn', code: 'export.parent-missing', detail: `${cursor.id} -> ${cursor.parentId}` })
      break
    }
    cursor = parent
  }
  return { chain: chain.reverse(), selectedId: selected.id, fallback, alternates: file.messages.length - chain.length, diagnostics }
}

/**
 * Text of one message from its fragments.
 * @param {any} message - normalized message.
 * @returns {{ text: string, fragments: number, types: Record<string, number> }} extracted text.
 */
export function messageText(message) {
  const types = {}
  const parts = []
  let used = 0
  for (const fragment of message.fragments) {
    types[fragment.type] = (types[fragment.type] ?? 0) + 1
    if (message.role === 'USER' && USER_FRAGMENTS.has(fragment.type)) {
      if (typeof fragment.content === 'string' && fragment.content.length > 0) {
        parts.push(fragment.content)
        used++
      }
    } else if (message.role === 'ASSISTANT' && ASSISTANT_FRAGMENTS.has(fragment.type)) {
      if (typeof fragment.content === 'string' && fragment.content.length > 0) {
        parts.push(fragment.content)
        used++
      }
    }
  }
  return { text: parts.join('\n').trim(), fragments: used, types }
}

/**
 * Turn one selected branch into normalized transcript messages.
 *
 * A user question whose reply was withdrawn by content filtering is dropped
 * with its reply, mirroring how the conversation actually reads. A reply that
 * never finished contributes its user question only.
 *
 * @param {any} file - normalized conversation.
 * @param {any[]} chain - selected path.
 * @returns {{ messages: { role: string, content: string, ts: number | null }[], stats: any, diagnostics: any[] }} normalized messages.
 */
export function chainToMessages(file, chain) {
  const messages = []
  const diagnostics = []
  const stats = {
    users: 0,
    assistants: 0,
    systems: 0,
    skippedFiltered: 0,
    unanswered: 0,
    empty: 0,
    fragments: {},
    statuses: {},
  }
  for (let index = 0; index < chain.length; index++) {
    const message = chain[index]
    if (message.role === 'SYSTEM') {
      const { text } = messageText(message)
      if (text.length > 0) {
        messages.push({ role: 'system', content: text, ts: message.time })
        stats.systems++
      }
      continue
    }
    if (message.role !== 'USER') continue
    stats.statuses[message.status] = (stats.statuses[message.status] ?? 0) + 1
    const next = chain[index + 1]
    const reply = next !== undefined && next.role === 'ASSISTANT' ? next : undefined
    if (reply !== undefined) index++
    if (reply !== undefined && reply.status === 'CONTENT_FILTER') {
      stats.skippedFiltered++
      continue
    }
    const user = messageText(message)
    if (user.text.length > 0) {
      messages.push({ role: 'user', content: user.text, ts: message.time })
      stats.users++
    }
    for (const [type, count] of Object.entries(user.types)) stats.fragments[type] = (stats.fragments[type] ?? 0) + count
    if (reply === undefined) continue
    const assistant = messageText(reply)
    for (const [type, count] of Object.entries(assistant.types)) stats.fragments[type] = (stats.fragments[type] ?? 0) + count
    if (assistant.text.length > 0) {
      messages.push({ role: 'assistant', content: assistant.text, ts: reply.time })
      stats.assistants++
    } else {
      stats.unanswered++
    }
    if (message.time !== null && reply.time !== null && reply.time < message.time) {
      diagnostics.push({ level: 'info', code: 'export.time-order', detail: String(reply.id) })
    }
  }
  if (messages.length === 0) {
    diagnostics.push({ level: 'warn', code: 'export.no-messages', detail: file.id })
  }
  return { messages, stats, diagnostics }
}

/**
 * Summarize one conversation for inspect and import planning.
 * @param {string} exportId - id from the export index.
 * @param {{ file: any, diagnostics: any[] }} parsed - parsed conversation.
 * @returns {{ conversation: any, chain: any, transcript: any, diagnostics: any[], summary: any }} analysis.
 */
export function analyzeConversation(exportId, parsed) {
  const diagnostics = [...parsed.diagnostics]
  if (parsed.file === null) {
    return { conversation: null, chain: null, transcript: null, diagnostics, summary: null }
  }
  const chain = selectChain(parsed.file)
  diagnostics.push(...chain.diagnostics)
  const transcript = chainToMessages(parsed.file, chain.chain)
  diagnostics.push(...transcript.diagnostics)
  const times = transcript.messages.map(message => message.ts).filter(ts => ts !== null)
  const summary = {
    id: exportId,
    title: parsed.file.title,
    messages: transcript.messages.length,
    userMessages: transcript.stats.users,
    assistantMessages: transcript.stats.assistants,
    from: times.length > 0 ? times.reduce((min, value) => (value < min ? value : min), Number.POSITIVE_INFINITY) : null,
    to: times.length > 0 ? times.reduce((max, value) => (value > max ? value : max), Number.NEGATIVE_INFINITY) : null,
    branchMessages: chain.chain.length,
    alternateMessages: chain.alternates,
    branchFallback: chain.fallback,
    skippedFiltered: transcript.stats.skippedFiltered,
    unanswered: transcript.stats.unanswered,
    fragments: transcript.stats.fragments,
    statuses: transcript.stats.statuses,
  }
  return { conversation: parsed.file, chain, transcript, diagnostics, summary }
}
