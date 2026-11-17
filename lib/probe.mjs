/**
 * The `inspect` probe: what is in this file, before anything is imported.
 *
 * The report is deliberately diagnostic rather than decorative. It answers the
 * questions a user asks the first time they see an export: how many
 * conversations and messages, over what period, which field means what, what
 * was recognized and what was not, and what the first and last messages look
 * like. An unrecognized structure produces diagnostics, never an exception.
 *
 * @module dsh-reunion-import/probe
 */

import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import {
  analyzeConversation, exportLayout, openDeepseekExport, parseConversation,
} from './deepseek.mjs'
import { collectGenericLines, collectGenericStream, collectGenericText } from './generic.mjs'
import { isShareRef, loadDeepseekShare, shareInspectReport } from './share.mjs'
import { openSource, stripBom } from './source.mjs'

/** Smallest document size still parsed in one piece. */
const INLINE_PARSE_BYTES = 8 * 1024 * 1024

/** Fields of the DeepSeek conversation and message records, with meaning keys. */
const DEEPSEEK_FIELDS = [
  { scope: 'conversation', name: 'id', meaning: 'field.conversation-id' },
  { scope: 'conversation', name: 'title', meaning: 'field.title' },
  { scope: 'conversation', name: 'current_message_id', meaning: 'field.current-message' },
  { scope: 'conversation', name: 'inserted_at', meaning: 'field.created-at' },
  { scope: 'message', name: 'id', meaning: 'field.message-id' },
  { scope: 'message', name: 'parent_id', meaning: 'field.parent' },
  { scope: 'message', name: 'role', meaning: 'field.role' },
  { scope: 'message', name: 'status', meaning: 'field.status' },
  { scope: 'message', name: 'inserted_at', meaning: 'field.message-time' },
  { scope: 'fragment', name: 'type', meaning: 'field.fragment-type' },
  { scope: 'fragment', name: 'content', meaning: 'field.fragment-content' },
]

/** Fragment type meanings. */
const FRAGMENT_MEANINGS = {
  REQUEST: 'fragment.request',
  RESPONSE: 'fragment.response',
  TEMPLATE_RESPONSE: 'fragment.template',
  THINK: 'fragment.think',
  TIP: 'fragment.tip',
  FILE: 'fragment.file',
  TOOL_SEARCH: 'fragment.tool',
  CONTENT_RISK: 'fragment.risk',
}

/**
 * Human label for an entry path, collapsing conversation ids.
 * @param {string} name - archive entry name.
 * @returns {string} display label.
 */
function entryLabel(name) {
  return name.replace(/^chat_sessions\/[^/]+\/_files\/.+/u, 'chat_sessions/<id>_files/<image>')
    .replace(/^chat_sessions\/[^/]+\.json$/u, 'chat_sessions/<id>.json')
}

/**
 * Aggregate unknown-field diagnostics from conversation analyses.
 * @param {{ level: string, code: string, detail: string }[]} diagnostics - diagnostics.
 * @returns {{ scope: string, name: string }[]} unknown fields.
 */
export function unknownFieldsOf(diagnostics) {
  const found = new Map()
  for (const item of diagnostics) {
    if (item.code === 'export.conversation-fields') {
      for (const name of item.detail.split(',').map(part => part.trim())) found.set(`conversation.${name}`, { scope: 'conversation', name })
    } else if (item.code === 'export.message-fields') {
      for (const name of item.detail.split(',').map(part => part.trim())) found.set(`message.${name}`, { scope: 'message', name })
    } else if (item.code === 'export.fragment-types') {
      for (const name of item.detail.split(',').map(part => part.trim())) found.set(`fragment.${name}`, { scope: 'fragment', name })
    }
  }
  return [...found.values()]
}

/**
 * Summarize a list of normalized generic sessions.
 * @param {{ id: string, title: string | null, messages: { role: string, content: string, ts: number | null }[] }[]} sessions - inferred sessions.
 * @returns {{ summaries: any[], totals: any }} summaries and totals.
 */
export function summarizeSessions(sessions) {
  const summaries = sessions.map(session => {
    const times = session.messages.map(message => message.ts).filter(ts => ts !== null)
    return {
      id: session.id,
      title: session.title,
      messages: session.messages.length,
      users: session.messages.filter(message => message.role === 'user').length,
      assistants: session.messages.filter(message => message.role === 'assistant').length,
      from: times.length > 0 ? reduceMin(times) : null,
      to: times.length > 0 ? reduceMax(times) : null,
    }
  })
  const all = sessions.flatMap(session => session.messages)
  const times = all.map(message => message.ts).filter(ts => ts !== null)
  return {
    summaries,
    totals: {
      sessions: summaries.length,
      messages: all.length,
      users: all.filter(message => message.role === 'user').length,
      assistants: all.filter(message => message.role === 'assistant').length,
      from: times.length > 0 ? reduceMin(times) : null,
      to: times.length > 0 ? reduceMax(times) : null,
    },
  }
}

/** Min without spreading a large array. */
function reduceMin(values) {
  return values.reduce((min, value) => (value < min ? value : min), Number.POSITIVE_INFINITY)
}

/** Max without spreading a large array. */
function reduceMax(values) {
  return values.reduce((max, value) => (value > max ? value : max), Number.NEGATIVE_INFINITY)
}

/**
 * Truncate one preview text and collapse its whitespace.
 * @param {string} text - message text.
 * @param {number} limit - maximum characters.
 * @returns {string} preview text.
 */
export function previewText(text, limit) {
  const collapsed = String(text).replace(/\s+/gu, ' ').trim()
  return collapsed.length > limit ? `${collapsed.slice(0, limit)}…` : collapsed
}

/**
 * First and last messages of one message list, bounded.
 * @param {{ role: string, content: string, ts: number | null }[]} messages - normalized messages.
 * @param {number} limit - preview character limit.
 * @returns {{ first: any[], last: any[] }} previews.
 */
export function previewsOf(messages, limit) {
  const toPreview = message => ({ role: message.role, ts: message.ts, text: previewText(message.content, limit) })
  return {
    first: messages.slice(0, 2).map(toPreview),
    last: messages.slice(-2).map(toPreview),
  }
}

/**
 * Inspect a DeepSeek export held behind a source.
 * @param {any} source - opened source.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} config - resolved config.
 * @returns {Promise<any>} report body.
 */
async function inspectExport(source, config) {
  const exportFile = await openDeepseekExport(source, config)
  const diagnostics = [...exportFile.diagnostics]
  const wanted = exportFile.conversations.slice(0, config.maxInspectSessions)
  const sessions = []
  let previewMessages = []
  let totals = { sessions: exportFile.conversations.length, analyzed: 0, messages: 0, users: 0, assistants: 0, from: null, to: null, skippedFiltered: 0, unanswered: 0 }
  const fragmentTotals = new Map()
  const statusTotals = new Map()
  for (const conversation of wanted) {
    const parsed = await exportFile.readConversation(conversation.id)
    const analysis = analyzeConversation(conversation.id, parsed)
    diagnostics.push(...analysis.diagnostics.map(item => ({ ...item, detail: item.detail ?? conversation.id })))
    if (analysis.summary === null) {
      sessions.push({ id: conversation.id, title: conversation.indexTitle, error: 'unreadable' })
      continue
    }
    totals.analyzed++
    totals.messages += analysis.summary.messages
    totals.users += analysis.summary.userMessages
    totals.assistants += analysis.summary.assistantMessages
    totals.skippedFiltered += analysis.summary.skippedFiltered
    totals.unanswered += analysis.summary.unanswered
    if (analysis.summary.from !== null) totals.from = totals.from === null ? analysis.summary.from : Math.min(totals.from, analysis.summary.from)
    if (analysis.summary.to !== null) totals.to = totals.to === null ? analysis.summary.to : Math.max(totals.to, analysis.summary.to)
    for (const [type, count] of Object.entries(analysis.summary.fragments)) fragmentTotals.set(type, (fragmentTotals.get(type) ?? 0) + count)
    for (const [status, count] of Object.entries(analysis.summary.statuses)) statusTotals.set(status, (statusTotals.get(status) ?? 0) + count)
    sessions.push(analysis.summary)
    if (previewMessages.length === 0) previewMessages = analysis.transcript.messages
  }
  const layout = exportLayout(source.entryNames())
  return {
    format: {
      id: 'deepseek-chat-export',
      version: exportFile.version,
      manifest: exportFile.manifest,
      indexRows: exportFile.indexRows.length,
      layout,
    },
    topLevel: [
      { name: 'manifest.json', type: 'object', keys: exportFile.manifest === null ? [] : Object.keys(exportFile.manifest) },
      { name: 'chat_session_index.json', type: 'array', length: exportFile.indexRows.length },
      { name: 'chat_sessions/<id>.json', type: 'object', keys: ['id', 'title', 'current_message_id', 'inserted_at', 'messages'] },
    ],
    fields: DEEPSEEK_FIELDS,
    fragmentTypes: [...fragmentTotals.entries()].map(([type, count]) => ({ type, count, meaning: FRAGMENT_MEANINGS[type] ?? null })),
    statuses: [...statusTotals.entries()].map(([status, count]) => ({ status, count })),
    sessions,
    totals,
    previews: previewsOf(previewMessages, config.previewChars),
    unknownFields: unknownFieldsOf(diagnostics),
    diagnostics,
    truncated: exportFile.conversations.length > wanted.length,
  }
}

/**
 * Inspect one standalone DeepSeek conversation file.
 * @param {string} text - conversation JSON.
 * @param {string} id - fallback id.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} config - resolved config.
 * @returns {any} report body.
 */
function inspectConversationFile(text, id, config) {
  const parsed = parseConversation(text, id)
  const analysis = analyzeConversation(id, parsed)
  const fragmentTotals = new Map()
  for (const [type, count] of Object.entries(analysis.summary?.fragments ?? {})) fragmentTotals.set(type, count)
  return {
    format: { id: 'deepseek-conversation', version: 3, layout: { manifest: false, index: false, conversations: [id] } },
    topLevel: [{ name: 'conversation', type: 'object', keys: parsed.file === null ? [] : Object.keys(parsed.file) }],
    fields: DEEPSEEK_FIELDS,
    fragmentTypes: [...fragmentTotals.entries()].map(([type, count]) => ({ type, count, meaning: FRAGMENT_MEANINGS[type] ?? null })),
    statuses: [],
    sessions: analysis.summary === null ? [] : [analysis.summary],
    totals: {
      sessions: 1,
      analyzed: analysis.summary === null ? 0 : 1,
      messages: analysis.summary?.messages ?? 0,
      users: analysis.summary?.userMessages ?? 0,
      assistants: analysis.summary?.assistantMessages ?? 0,
      from: analysis.summary?.from ?? null,
      to: analysis.summary?.to ?? null,
      skippedFiltered: analysis.summary?.skippedFiltered ?? 0,
      unanswered: analysis.summary?.unanswered ?? 0,
    },
    previews: previewsOf(analysis.transcript?.messages ?? [], config.previewChars),
    diagnostics: [...parsed.diagnostics, ...analysis.diagnostics],
    truncated: false,
  }
}

/** Span of one session's messages in milliseconds. */
function spanOf(session) {
  return typeof session.from === 'number' && typeof session.to === 'number' ? session.to - session.from : 0
}

/**
 * Filter and order conversation summaries for a usable selection list.
 * @param {any[]} sessions - conversation summaries.
 * @param {{ query?: string, sort?: 'messages'|'span'|'recent' }} options - filter and order.
 * @returns {any[]} filtered, ordered summaries.
 */
export function orderSessions(sessions, options = {}) {
  const query = typeof options.query === 'string' ? options.query.trim().toLowerCase() : ''
  const filtered = query === ''
    ? [...sessions]
    : sessions.filter(session => `${session.title ?? ''} ${session.id ?? ''}`.toLowerCase().includes(query))
  filtered.sort((left, right) => {
    if (left.error !== undefined && right.error === undefined) return 1
    if (right.error !== undefined && left.error === undefined) return -1
    if (options.sort === 'recent') return (right.to ?? 0) - (left.to ?? 0) || (right.messages ?? 0) - (left.messages ?? 0)
    if (options.sort === 'span') return spanOf(right) - spanOf(left) || (right.messages ?? 0) - (left.messages ?? 0)
    return (right.messages ?? 0) - (left.messages ?? 0) || spanOf(right) - spanOf(left)
  })
  return filtered
}

/**
 * Collapse repeated diagnostics into one row per code.
 * @param {{ level: string, code: string, detail?: string }[]} diagnostics - raw diagnostics.
 * @param {number} [limit] - maximum groups.
 * @returns {{ level: string, code: string, detail?: string, count: number }[]} aggregated diagnostics.
 */
export function aggregateDiagnostics(diagnostics, limit = 30) {
  const groups = new Map()
  for (const item of diagnostics) {
    const key = `${item.level}:${item.code}`
    const group = groups.get(key)
    if (group === undefined) groups.set(key, { level: item.level, code: item.code, detail: item.detail, count: 1 })
    else group.count++
  }
  return [...groups.values()].sort((left, right) => right.count - left.count).slice(0, limit)
}

/**
 * Inspect an input without writing anything.
 * @param {object} request - inputs.
 * @param {string} request.path - export file or extracted directory.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} request.config - resolved config.
 * @param {AbortSignal} [request.signal] - cancellation.
 * @param {string} [request.query] - filter conversation titles or ids.
 * @param {'messages'|'span'|'recent'} [request.sort] - conversation ordering; defaults to messages.
 * @param {typeof fetch} [request.fetch] - injectable fetch for DeepSeek share links.
 * @returns {Promise<any>} the inspect report.
 */
export async function inspectSource(request) {
  const { path, config, signal, query, sort } = request
  if (isShareRef(path)) {
    const loaded = await loadDeepseekShare(path, {
      fetch: request.fetch,
      signal,
      locale: request.locale,
    })
    const report = shareInspectReport(loaded, config)
    const sessions = Array.isArray(report.sessions) ? report.sessions : []
    const ordered = orderSessions(sessions, { query, sort })
    if (ordered.length === 0) report.previews = { first: [], last: [] }
    return {
      path: loaded.url,
      name: loaded.shareId,
      kind: 'share',
      bytes: loaded.bytes,
      sha256: loaded.sha256,
      ...report,
      sessions: ordered,
      sessionsTotal: sessions.length,
      matches: ordered.length,
      sort: sort ?? 'messages',
      ...(typeof query === 'string' && query.trim() !== '' ? { query: query.trim() } : {}),
      diagnostics: aggregateDiagnostics(report.diagnostics ?? []),
    }
  }
  const source = await openSource(path, config)
  const diagnostics = []
  let report
  let ordered = []
  let sessionsTotal = 0
  try {
    if (source.kind === 'empty') {
      report = emptyReport('file.empty')
    } else if (source.kind === 'unknown') {
      report = emptyReport('source.not-json', source.head)
    } else if (source.kind === 'zip' || source.kind === 'dir') {
      const layout = exportLayout(source.entryNames())
      const looksDeepseek = layout.manifest && (layout.index || layout.conversations.length > 0)
      if (looksDeepseek) {
        report = await inspectExport(source, config)
      } else {
        const imageEntries = source.entryNames().filter(name => /_files\//u.test(name)).length
        report = emptyReport('source.unrecognized', `${source.entryNames().length} entries, ${imageEntries} image entries`)
        report.topLevel = source.entryNames().slice(0, 24).map(name => ({ name: entryLabel(name), type: 'entry' }))
        report.layout = { entries: source.entryNames().length, images: imageEntries }
      }
    } else if (source.kind === 'jsonl') {
      report = await inspectJsonLines(source, config, signal)
    } else {
      report = await inspectJson(source, config, signal)
    }

    const sessions = Array.isArray(report.sessions) ? report.sessions : []
    sessionsTotal = sessions.length
    ordered = orderSessions(sessions, { query, sort })
    // Preview the conversation the user is most likely to act on (the first
    // one after ordering), not whichever file the archive happened to list first.
    // An empty filter must clear stale analysis-pass previews so the report
    // never pairs "no matches" with another conversation's excerpts.
    if (ordered.length === 0) {
      report.previews = { first: [], last: [] }
    } else if ((source.kind === 'zip' || source.kind === 'dir') && typeof ordered[0].id === 'string') {
      try {
        const text = await source.readEntryText(`chat_sessions/${ordered[0].id}.json`)
        if (text !== undefined) {
          const parsed = parseConversation(text, ordered[0].id)
          const analysis = analyzeConversation(ordered[0].id, parsed)
          if (analysis.transcript !== null && analysis.transcript.messages.length > 0) {
            report.previews = previewsOf(analysis.transcript.messages, config.previewChars)
          }
        }
      } catch {
        // Keep the previews collected during the analysis pass.
      }
    }
  } finally {
    await source.close()
  }

  const hash = await hashOf(source, signal)
  const bytes = source.bytes
  const allDiagnostics = [...diagnostics, ...(report.diagnostics ?? [])]
  const result = {
    path,
    name: basename(path),
    kind: source.kind,
    bytes,
    sha256: hash,
    ...report,
    sessions: ordered,
    sessionsTotal,
    matches: ordered.length,
    sort: sort ?? 'messages',
    ...(typeof query === 'string' && query.trim() !== '' ? { query: query.trim() } : {}),
    diagnostics: aggregateDiagnostics(allDiagnostics),
  }
  return result
}

/** Hash the source, tolerating failures. */
async function hashOf(source, signal) {
  try {
    if (source.kind === 'zip' || source.kind === 'json' || source.kind === 'jsonl') return await source.hash(signal)
    if (source.kind === 'dir') return await source.hash(signal)
    return null
  } catch {
    return null
  }
}

/** Report body for inputs that carry no usable structure. */
function emptyReport(code, detail) {
  return {
    format: { id: 'unknown', version: null, layout: {} },
    topLevel: [],
    fields: [],
    fragmentTypes: [],
    statuses: [],
    sessions: [],
    totals: { sessions: 0, analyzed: 0, messages: 0, users: 0, assistants: 0, from: null, to: null, skippedFiltered: 0, unanswered: 0 },
    previews: { first: [], last: [] },
    diagnostics: [{ level: 'error', code, detail: detail ?? null }],
    truncated: false,
  }
}

/**
 * Inspect one JSON document.
 * @param {any} source - opened source.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} config - resolved config.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {Promise<any>} report body.
 */
async function inspectJson(source, config, signal) {
  if (source.bytes <= INLINE_PARSE_BYTES) {
    const text = stripBom(await readFile(source.path, 'utf8'))
    const root = tryParse(text)
    if (root === undefined) return emptyReport('source.not-json')
    if (isConversationFile(root)) return inspectConversationFile(text, String(root.id ?? 'conversation'), config)
    const collected = collectGenericText(text, { maxMessages: config.maxMessages, maxSessions: config.maxInspectSessions })
    if (!collected.ok) return emptyReport('source.not-json')
    return genericReport(collected, config)
  }
  const collected = await collectGenericStream(source, {
    maxMessages: config.maxMessages,
    maxSessions: config.maxInspectSessions,
  })
  const report = genericReport({ ...collected, shape: undefined }, config)
  report.diagnostics.push({ level: 'warn', code: 'source.streamed', detail: String(source.bytes) })
  report.truncated = report.truncated || collected.truncated
  return report
}

/**
 * Inspect one JSON Lines file.
 * @param {any} source - opened source.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} config - resolved config.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {Promise<any>} report body.
 */
async function inspectJsonLines(source, config, signal) {
  const collected = await collectGenericLines(source.lines(signal), {
    maxMessages: config.maxMessages,
    maxSessions: config.maxInspectSessions,
  })
  const report = genericReport({ ...collected, shape: { type: 'jsonl', lines: collected.sessions.reduce((sum, session) => sum + session.messages.length, 0) } }, config)
  if (collected.badLines > 0) report.diagnostics.push({ level: 'warn', code: 'source.bad-lines', detail: String(collected.badLines) })
  report.truncated = report.truncated || collected.truncated
  return report
}

/** Parse JSON text, or undefined. */
function tryParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Whether a parsed JSON value is one DeepSeek conversation file. */
function isConversationFile(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray(value.messages)
    && value.messages.length > 0
    && value.messages[0] !== null && typeof value.messages[0] === 'object'
    && Array.isArray(value.messages[0].fragments)
}

/**
 * Build a report for an inferred generic document.
 * @param {{ sessions: any[], shape?: any, fieldUsage?: Map<string, number>, branchFields?: Set<string>, unknownKeys?: Map<string, number>, truncated?: boolean }} collected - inference result.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} config - resolved config.
 * @returns {any} report body.
 */
function genericReport(collected, config) {
  const { summaries, totals } = summarizeSessions(collected.sessions)
  const diagnostics = []
  if (collected.sessions.length === 0) {
    diagnostics.push({ level: 'error', code: 'source.no-messages' })
  }
  if (collected.truncated === true) diagnostics.push({ level: 'warn', code: 'inspect.partial' })
  const fields = [...(collected.fieldUsage ?? new Map()).entries()].map(([key, count]) => {
    const [kind, name] = key.split(':')
    return { scope: 'inferred', kind, name, count }
  })
  const branchFields = [...(collected.branchFields ?? [])].map(name => ({ scope: 'inferred', kind: 'branch', name }))
  const previewSource = collected.sessions.flatMap(session => session.messages)
  return {
    format: { id: 'generic', version: null, layout: { sessions: summaries.length } },
    topLevel: collected.shape === undefined ? [] : [{ name: 'document', type: collected.shape.type, keys: collected.shape.keys, length: collected.shape.length, items: collected.shape.items }],
    fields: [...fields, ...branchFields],
    fragmentTypes: [],
    statuses: [],
    sessions: summaries,
    totals: { ...totals, analyzed: totals.sessions, skippedFiltered: 0, unanswered: 0 },
    previews: previewsOf(previewSource, config.previewChars),
    unknownFields: [...(collected.unknownKeys ?? new Map()).keys()].slice(0, 40),
    diagnostics,
    truncated: collected.truncated === true,
  }
}
