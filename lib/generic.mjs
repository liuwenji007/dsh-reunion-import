/**
 * Unknown-format fallback.
 *
 * When the input is not a DeepSeek export, the plugin still tries to be
 * useful: it looks for arrays of `{ role, content }`-shaped objects, maps the
 * common role and content spellings, and reports every field it did not use so
 * the user can judge the guess. Nothing here throws on an unexpected shape.
 *
 * @module dsh-reunion-import/generic
 */

import { parseJsonText, parseTime } from './deepseek.mjs'

/** Role field spellings, in match order. */
const ROLE_KEYS = ['role', 'author', 'from', 'sender', 'speaker', 'type', 'is_user', 'isUser']
/** Content field spellings, in match order. */
const CONTENT_KEYS = ['content', 'text', 'message', 'body', 'prompt', 'response', 'answer', 'value']
/** Timestamp field spellings, in match order. */
const TIME_KEYS = ['ts', 'time', 'timestamp', 'created_at', 'createdAt', 'inserted_at', 'insertedAt', 'date', 'updated_at']
/** Title field spellings. */
const TITLE_KEYS = ['title', 'name', 'topic', 'subject', 'conversation_title']
/** Fields that hint at branches or regenerated replies. */
const BRANCH_KEYS = ['parent', 'parent_id', 'parentId', 'prev', 'prev_id', 'branch', 'branches', 'regenerated', 'regenerate', 'alternate', 'alternates', 'version', 'sibling', 'siblings', 'children']

/** Role value spellings. */
const ROLE_VALUES = new Map([
  ['user', 'user'], ['human', 'user'], ['me', 'user'], ['request', 'user'], ['prompt', 'user'], ['question', 'user'], ['我', 'user'], ['用户', 'user'],
  ['assistant', 'assistant'], ['ai', 'assistant'], ['bot', 'assistant'], ['model', 'assistant'], ['response', 'assistant'], ['answer', 'assistant'], ['gpt', 'assistant'], ['deepseek', 'assistant'], ['助手', 'assistant'], ['助理', 'assistant'],
  ['system', 'system'], ['developer', 'system'], ['instruction', 'system'],
])

/**
 * Extract text from a content value of unknown shape.
 * @param {unknown} value - candidate content.
 * @param {number} depth - remaining recursion depth.
 * @returns {string} extracted text, or an empty string.
 */
export function extractText(value, depth = 0) {
  if (depth > 6) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (Array.isArray(value)) {
    const parts = value.map(item => extractText(item, depth + 1)).filter(text => text.length > 0)
    return parts.join('\n')
  }
  if (value !== null && typeof value === 'object') {
    const record = /** @type {Record<string, unknown>} */ (value)
    for (const key of ['text', 'content', 'parts', 'value', 'body', 'message']) {
      if (!(key in record)) continue
      const text = extractText(record[key], depth + 1)
      if (text.length > 0) return text
    }
  }
  return ''
}

/**
 * Map one role value onto the transcript vocabulary.
 * @param {unknown} value - role field value.
 * @returns {'user'|'assistant'|'system'|null} normalized role.
 */
export function normalizeRole(value) {
  if (typeof value !== 'string') return null
  return ROLE_VALUES.get(value.trim().toLowerCase()) ?? null
}

/**
 * Find the field names of one object that carry role, content, and time.
 * @param {Record<string, unknown>} record - candidate message object.
 * @returns {{ role?: string, content?: string, ts?: string }} the recognized fields.
 */
export function matchFields(record) {
  const fields = {}
  for (const key of ROLE_KEYS) {
    if (normalizeRole(record[key]) !== null) {
      fields.role = key
      break
    }
  }
  for (const key of CONTENT_KEYS) {
    if (key in record && extractText(record[key]).length > 0) {
      fields.content = key
      break
    }
  }
  for (const key of TIME_KEYS) {
    if (key in record && parseTime(record[key]) !== null) {
      fields.ts = key
      break
    }
  }
  return fields
}

/**
 * Turn one object into a normalized message when it has role and content.
 * @param {unknown} value - candidate object.
 * @returns {{ role: string, content: string, ts: number | null, fields: object, unknownKeys: string[] } | null} normalized message.
 */
export function toMessage(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = /** @type {Record<string, unknown>} */ (value)
  const fields = matchFields(record)
  if (fields.role === undefined || fields.content === undefined) return null
  const role = normalizeRole(record[fields.role])
  if (role === null) return null
  const content = extractText(record[fields.content]).trim()
  if (content.length === 0) return null
  const known = new Set([fields.role, fields.content, fields.ts, ...TITLE_KEYS, ...BRANCH_KEYS].filter(Boolean))
  return {
    role,
    content,
    ts: fields.ts === undefined ? null : parseTime(record[fields.ts]),
    fields,
    unknownKeys: Object.keys(record).filter(key => !known.has(key)),
  }
}

/**
 * Summarize one value's shape for the inspect report.
 * @param {unknown} value - any JSON value.
 * @param {number} depth - remaining depth.
 * @returns {{ type: string, length?: number, keys?: string[], items?: any[], sample?: string }} shape node.
 */
export function summarizeShape(value, depth = 2) {
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) {
    const node = { type: 'array', length: value.length }
    if (depth > 0 && value.length > 0) node.items = [summarizeShape(value[0], depth - 1)]
    return node
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    const node = { type: 'object', keys: keys.slice(0, 24) }
    if (depth > 0) {
      node.fields = {}
      for (const key of keys.slice(0, 12)) node.fields[key] = summarizeShape(value[key], depth - 1)
    }
    return node
  }
  if (typeof value === 'string') return { type: 'string', sample: value.length > 80 ? `${value.slice(0, 80)}…` : value }
  return { type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : typeof value, sample: String(value) }
}

/**
 * Collect message arrays and sessions from one parsed JSON value.
 * @param {unknown} root - parsed document.
 * @param {{ maxMessages: number, maxSessions: number }} limits - collection caps.
 * @returns {{ sessions: any[], unknownKeys: Map<string, number>, truncated: boolean }} inferred sessions.
 */
export function collectFromValue(root, limits) {
  const sessions = []
  const unknownKeys = new Map()
  const fieldUsage = new Map()
  const branchFields = new Set()
  let collected = 0
  let truncated = false

  const addSession = (id, title, messages) => {
    if (sessions.length >= limits.maxSessions) {
      truncated = true
      return
    }
    sessions.push({ id, title, messages })
  }

  const isMessageArray = value => {
    if (!Array.isArray(value) || value.length === 0) return false
    let matches = 0
    for (const item of value.slice(0, 5)) if (toMessage(item) !== null) matches++
    return matches >= Math.min(2, value.length)
  }

  const visit = (value, path, depth, title) => {
    if (depth > 8 || value === null || typeof value !== 'object') return
    if (Array.isArray(value)) {
      if (isMessageArray(value)) {
        const messages = []
        for (const item of value) {
          const message = toMessage(item)
          if (message === null) continue
          for (const [kind, field] of Object.entries(message.fields)) {
            const key = `${kind}:${field}`
            fieldUsage.set(key, (fieldUsage.get(key) ?? 0) + 1)
          }
          for (const key of message.unknownKeys) unknownKeys.set(key, (unknownKeys.get(key) ?? 0) + 1)
          if (collected >= limits.maxMessages) {
            truncated = true
            break
          }
          messages.push({ role: message.role, content: message.content, ts: message.ts })
          collected++
        }
        addSession(path.join('.') || '$', title, messages)
        return
      }
      for (const [index, item] of value.entries()) {
        visit(item, [...path, index], depth + 1, title)
      }
      return
    }
    const record = /** @type {Record<string, unknown>} */ (value)
    for (const key of BRANCH_KEYS) if (key in record) branchFields.add(key)
    const foundTitle = TITLE_KEYS.map(key => record[key]).find(candidate => typeof candidate === 'string')
    for (const [key, child] of Object.entries(record)) {
      visit(child, [...path, key], depth + 1, typeof foundTitle === 'string' ? foundTitle : title)
    }
  }

  const single = toMessage(root)
  if (single !== null) {
    addSession('$', null, [{ role: single.role, content: single.content, ts: single.ts }])
    return { sessions, unknownKeys, fieldUsage, branchFields, truncated }
  }
  visit(root, [], 0, null)
  return { sessions, unknownKeys, fieldUsage, branchFields, truncated }
}

/**
 * Collect sessions from a small JSON document.
 * @param {string} text - JSON text.
 * @param {{ maxMessages: number, maxSessions: number }} limits - caps.
 * @returns {{ ok: boolean, root?: unknown, shape?: any, sessions: any[], unknownKeys: Map<string, number>, truncated: boolean, error?: string }} inference result.
 */
export function collectGenericText(text, limits) {
  const parsed = parseJsonText(text)
  if ('error' in parsed) return { ok: false, sessions: [], unknownKeys: new Map(), truncated: false, error: parsed.error }
  const collected = collectFromValue(parsed.value, limits)
  return { ok: true, root: parsed.value, shape: summarizeShape(parsed.value), ...collected }
}

/**
 * Collect sessions from JSON Lines text.
 * @param {AsyncIterable<string>} lines - candidate JSON lines.
 * @param {{ maxMessages: number, maxSessions: number }} limits - caps.
 * @returns {Promise<{ sessions: any[], unknownKeys: Map<string, number>, truncated: boolean, badLines: number }>} inference result.
 */
export async function collectGenericLines(lines, limits) {
  const unknownKeys = new Map()
  const fieldUsage = new Map()
  const branchFields = new Set()
  const loose = []
  const sessions = []
  let collected = 0
  let truncated = false
  let badLines = 0
  for await (const line of lines) {
    const parsed = parseJsonText(line)
    if ('error' in parsed) {
      badLines++
      continue
    }
    const single = toMessage(parsed.value)
    if (single !== null) {
      for (const [kind, field] of Object.entries(single.fields)) {
        const key = `${kind}:${field}`
        fieldUsage.set(key, (fieldUsage.get(key) ?? 0) + 1)
      }
      for (const key of single.unknownKeys) unknownKeys.set(key, (unknownKeys.get(key) ?? 0) + 1)
      if (collected >= limits.maxMessages) {
        truncated = true
        continue
      }
      loose.push({ role: single.role, content: single.content, ts: single.ts })
      collected++
      continue
    }
    const nested = collectFromValue(parsed.value, {
      maxMessages: Math.max(0, limits.maxMessages - collected),
      maxSessions: Math.max(1, limits.maxSessions - sessions.length),
    })
    for (const [key, count] of nested.unknownKeys) unknownKeys.set(key, (unknownKeys.get(key) ?? 0) + count)
    for (const [key, count] of nested.fieldUsage) fieldUsage.set(key, (fieldUsage.get(key) ?? 0) + count)
    for (const field of nested.branchFields) branchFields.add(field)
    for (const session of nested.sessions) {
      sessions.push({ ...session, id: `${sessions.length}:${session.id}` })
      collected += session.messages.length
    }
    if (nested.truncated) truncated = true
  }
  if (loose.length > 0) sessions.unshift({ id: 'lines', title: null, messages: loose })
  return { sessions, unknownKeys, fieldUsage, branchFields, truncated, badLines }
}

/**
 * Read and infer a whole JSON file through the streaming walker.
 *
 * Only used when the document is too large to parse at once: every array whose
 * items look like messages becomes one session, and the walker keeps one item
 * in memory at a time.
 *
 * @param {Awaited<ReturnType<typeof import('./source.mjs').openSource>>} source - opened source.
 * @param {{ maxMessages: number, maxSessions: number }} limits - caps.
 * @returns {Promise<{ sessions: any[], unknownKeys: Map<string, number>, truncated: boolean, badLines: number }>} inference result.
 */
export async function collectGenericStream(source, limits) {
  const unknownKeys = new Map()
  const fieldUsage = new Map()
  const buckets = new Map()
  let collected = 0
  let truncated = false
  const mergeFields = message => {
    for (const [kind, field] of Object.entries(message.fields)) {
      const key = `${kind}:${field}`
      fieldUsage.set(key, (fieldUsage.get(key) ?? 0) + 1)
    }
    for (const field of message.unknownKeys) unknownKeys.set(field, (unknownKeys.get(field) ?? 0) + 1)
  }
  await source.walk({
    onNode() {},
    onArrayItem(path, item, index) {
      const message = toMessage(item)
      if (message !== null) {
        // The walker reports an item path, so the owning array is the parent.
        const key = path.slice(0, -1).join('.')
        let bucket = buckets.get(key)
        if (bucket === undefined) {
          bucket = { id: key || '$', title: null, messages: [] }
          buckets.set(key, bucket)
        }
        if (collected >= limits.maxMessages) truncated = true
        else {
          mergeFields(message)
          bucket.messages.push({ role: message.role, content: message.content, ts: message.ts })
          collected++
        }
        return
      }
      // A session object: the walker hands it over whole, so mine its nested
      // message arrays here instead of asking the walker to descend again.
      if (item === null || typeof item !== 'object' || Array.isArray(item)) return
      const nested = collectFromValue(item, {
        maxMessages: Math.max(0, limits.maxMessages - collected),
        maxSessions: Math.max(1, limits.maxSessions - buckets.size),
      })
      if (nested.truncated) truncated = true
      for (const [field, count] of nested.unknownKeys) unknownKeys.set(field, (unknownKeys.get(field) ?? 0) + count)
      for (const [field, count] of nested.fieldUsage) fieldUsage.set(field, (fieldUsage.get(field) ?? 0) + count)
      for (const session of nested.sessions) {
        if (session.messages.length === 0) continue
        if (buckets.size >= limits.maxSessions) {
          truncated = true
          break
        }
        const id = `${path.join('.')}#${index}:${session.id}`
        buckets.set(id, { ...session, id })
        collected += session.messages.length
      }
    },
  }, { maxDepth: 6, maxValueChars: 8 * 1024 * 1024 })
  const sessions = [...buckets.values()].filter(bucket => bucket.messages.length > 0)
  return { sessions, unknownKeys, fieldUsage, branchFields: new Set(), truncated, badLines: 0 }
}
