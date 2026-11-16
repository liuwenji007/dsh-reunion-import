/**
 * DeepSeek public share links (`https://chat.deepseek.com/share/<id>`).
 *
 * A share is a frozen snapshot of one conversation. Reunion fetches it over
 * the public share API (no login), normalizes the messages into the same
 * `{ role, content, ts }` shape used by local exports, and feeds that into
 * inspect / thread import. This is the mobile-friendly path: copy a link
 * instead of downloading the full history ZIP.
 *
 * Network access is deliberate and limited to this module.
 *
 * @module dsh-reunion-import/share
 */

import { createHash } from 'node:crypto'
import { parseTime } from './deepseek.mjs'

/** Match a DeepSeek chat share URL or a bare share id. */
const SHARE_URL_RE = /^(?:https?:\/\/)?chat\.deepseek\.com\/share\/([A-Za-z0-9_-]+)(?:[/?#].*)?$/iu
/** Bare share ids as pasted from the App. */
const SHARE_ID_RE = /^[A-Za-z0-9_-]{6,128}$/u
/** Public share content endpoint. */
const SHARE_CONTENT_URL = 'https://chat.deepseek.com/api/v0/share/content'

/**
 * Whether a user-supplied path/spec is a DeepSeek share reference.
 * @param {unknown} value - path, URL, or id.
 * @returns {boolean} true when it should be fetched, not opened as a file.
 */
export function isShareRef(value) {
  if (typeof value !== 'string') return false
  const text = value.trim()
  if (text.length === 0) return false
  if (SHARE_URL_RE.test(text)) return true
  if (text.includes('/') || text.includes('\\') || text.includes('.')) return false
  return SHARE_ID_RE.test(text)
}

/**
 * Extract the share id from a URL or bare id.
 * @param {string} raw - share URL or id.
 * @returns {string} share id.
 */
export function extractShareId(raw) {
  const text = String(raw ?? '').trim()
  const matched = SHARE_URL_RE.exec(text)
  if (matched !== null) return matched[1]
  if (SHARE_ID_RE.test(text) && !text.includes('/') && !text.includes('\\')) return text
  throw new Error(`not a DeepSeek share link or id: ${text}`)
}

/**
 * Canonical share URL for a share id.
 * @param {string} shareId - share id.
 * @returns {string} https URL.
 */
export function shareUrlOf(shareId) {
  return `https://chat.deepseek.com/share/${shareId}`
}

/**
 * Normalize one public-share payload into a reunion session.
 * @param {{ shareId: string, biz: any }} input - share id and biz_data.
 * @returns {{ id: string, title: string | null, messages: { role: string, content: string, ts: number | null }[], stats: any }}
 */
export function normalizeShareConversation(input) {
  const shareId = input.shareId
  const biz = input.biz ?? {}
  const rawMessages = Array.isArray(biz.messages)
    ? biz.messages
    : (Array.isArray(biz.chat_messages) ? biz.chat_messages : [])
  const messages = []
  for (const item of rawMessages) {
    if (item === null || typeof item !== 'object') continue
    const roleRaw = typeof item.role === 'string' ? item.role.toUpperCase() : ''
    const role = roleRaw === 'USER' || roleRaw === 'HUMAN'
      ? 'user'
      : (roleRaw === 'ASSISTANT' || roleRaw === 'AI' || roleRaw === 'BOT' ? 'assistant' : null)
    if (role === null) continue
    const content = typeof item.content === 'string' && item.content.trim() !== ''
      ? item.content.trim()
      : (typeof item.message === 'string' ? item.message.trim() : '')
    if (content.length === 0) continue
    const ts = parseTime(item.inserted_at ?? item.created_at ?? item.timestamp ?? item.ts ?? null)
    messages.push({ role, content, ts })
  }
  const title = typeof biz.title === 'string' && biz.title.trim() !== '' ? biz.title.trim() : null
  return {
    id: `share-${shareId}`,
    title,
    messages,
    stats: {
      users: messages.filter(message => message.role === 'user').length,
      assistants: messages.filter(message => message.role === 'assistant').length,
      skippedFiltered: 0,
      unanswered: 0,
    },
  }
}

/**
 * Fetch and normalize one DeepSeek public share.
 * @param {string} raw - share URL or id.
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal }} [options] - injectable fetch for tests.
 * @returns {Promise<{
 *   shareId: string,
 *   url: string,
 *   formatId: 'deepseek-share',
 *   version: null,
 *   sha256: string,
 *   bytes: number,
 *   session: ReturnType<typeof normalizeShareConversation>,
 *   diagnostics: any[],
 * }>} loaded share.
 */
export async function loadDeepseekShare(raw, options = {}) {
  const shareId = extractShareId(raw)
  const url = shareUrlOf(shareId)
  const fetchImpl = options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable; cannot load a DeepSeek share link')

  const endpoint = `${SHARE_CONTENT_URL}?share_id=${encodeURIComponent(shareId)}`
  let response
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json, text/plain, */*',
        referer: 'https://chat.deepseek.com/',
        'user-agent': 'dsh-reunion-import/0.1 (+https://www.npmjs.com/package/dsh-reunion-import)',
      },
      signal: options.signal,
    })
  } catch (error) {
    throw new Error(`failed to fetch DeepSeek share ${shareId}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (response?.ok !== true) {
    throw new Error(`DeepSeek share HTTP ${response?.status ?? 'error'} for ${shareId}`)
  }

  let payload
  try {
    payload = await response.json()
  } catch (error) {
    throw new Error(`DeepSeek share returned non-JSON for ${shareId}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (payload === null || typeof payload !== 'object') throw new Error(`DeepSeek share unavailable: empty payload for ${shareId}`)
  if (payload.code !== 0 && payload.code !== undefined) {
    throw new Error(`DeepSeek share unavailable: ${payload.msg || `code ${payload.code}`}`)
  }
  const data = payload.data
  if (data === null || typeof data !== 'object') throw new Error(`DeepSeek share unavailable: missing data for ${shareId}`)
  if (data.biz_code !== undefined && data.biz_code !== 0) {
    throw new Error(`DeepSeek share unavailable: ${data.biz_msg || `biz_code ${data.biz_code}`}`)
  }
  const biz = data.biz_data
  if (biz === null || typeof biz !== 'object') throw new Error(`DeepSeek share unavailable: no conversation payload for ${shareId}`)

  const session = normalizeShareConversation({ shareId, biz })
  if (session.messages.length === 0) throw new Error(`DeepSeek share ${shareId} contains no usable messages`)

  const body = JSON.stringify(biz)
  const sha256 = createHash('sha256').update(`deepseek-share\0${shareId}\0`).update(body).digest('hex')
  return {
    shareId,
    url,
    formatId: 'deepseek-share',
    version: null,
    sha256,
    bytes: Buffer.byteLength(body),
    session,
    diagnostics: [],
  }
}

/**
 * Build an inspect-shaped report for one loaded share.
 * @param {Awaited<ReturnType<typeof loadDeepseekShare>>} loaded - fetched share.
 * @param {{ previewChars: number }} config - preview budget.
 * @returns {any} inspect report body fields.
 */
export function shareInspectReport(loaded, config) {
  const messages = loaded.session.messages
  const times = messages.map(message => message.ts).filter(ts => ts !== null)
  const from = times.length > 0 ? times.reduce((min, value) => (value < min ? value : min), Number.POSITIVE_INFINITY) : null
  const to = times.length > 0 ? times.reduce((max, value) => (value > max ? value : max), Number.NEGATIVE_INFINITY) : null
  const previewChars = config.previewChars ?? 160
  const clip = text => (text.length > previewChars ? `${text.slice(0, previewChars)}…` : text)
  const first = messages.slice(0, Math.min(2, messages.length)).map(message => ({
    role: message.role,
    ts: message.ts,
    text: clip(message.content),
  }))
  const last = messages.length > 2
    ? messages.slice(-Math.min(2, messages.length)).map(message => ({
      role: message.role,
      ts: message.ts,
      text: clip(message.content),
    }))
    : []
  return {
    format: {
      id: loaded.formatId,
      version: loaded.version,
      shareId: loaded.shareId,
      layout: { share: true, conversations: [loaded.session.id] },
    },
    topLevel: [
      { name: 'share_id', type: 'string' },
      { name: 'title', type: 'string' },
      { name: 'messages[]', type: 'array', length: messages.length },
    ],
    fields: [
      { scope: 'share', name: 'share_id', meaning: 'field.share-id' },
      { scope: 'message', name: 'role', meaning: 'field.role' },
      { scope: 'message', name: 'content', meaning: 'field.share-content' },
    ],
    fragmentTypes: [],
    statuses: [],
    sessions: [{
      id: loaded.session.id,
      title: loaded.session.title,
      messages: messages.length,
      userMessages: loaded.session.stats.users,
      assistantMessages: loaded.session.stats.assistants,
      from,
      to,
      alternateMessages: 0,
      skippedFiltered: 0,
      unanswered: 0,
    }],
    totals: {
      sessions: 1,
      analyzed: 1,
      messages: messages.length,
      users: loaded.session.stats.users,
      assistants: loaded.session.stats.assistants,
      from,
      to,
      skippedFiltered: 0,
      unanswered: 0,
    },
    previews: { first, last },
    diagnostics: loaded.diagnostics,
    truncated: false,
  }
}
