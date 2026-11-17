/**
 * Literal search over one companion transcript.
 *
 * A hit requires every token of the query (or the whole query) to occur in
 * the message. This is a keyword safety net, not semantic search.
 *
 * @module dsh-reunion-import/recall
 */

import { iterateTranscript } from './transcript.mjs'

/**
 * Split a query into tokens of at least two characters.
 * @param {string} query - user text.
 * @returns {string[]} tokens, or the whole query when it does not split.
 */
export function recallTokens(query) {
  const parts = String(query).split(/[\s,，。！？、；;]+/u).map(part => part.trim()).filter(part => part.length >= 2)
  if (parts.length > 0) return parts
  const whole = String(query).trim()
  return whole.length >= 2 ? [whole] : []
}

/**
 * Search a transcript for query tokens.
 * @param {object} request - inputs.
 * @param {string} request.transcriptPath - archive path.
 * @param {string} request.query - user query.
 * @param {number} [request.limit] - maximum hits.
 * @param {number} [request.maxChars] - total returned characters.
 * @returns {Promise<{ turn: number, role: string, ts: number | null, text: string }[]>} hits.
 */
export async function searchTranscript(request) {
  const tokens = recallTokens(request.query)
  if (tokens.length === 0) return []
  const limit = Math.max(1, request.limit ?? 5)
  const maxChars = Math.max(200, request.maxChars ?? 2000)
  const hits = []
  let used = 0
  for await (const entry of iterateTranscript(request.transcriptPath)) {
    const content = String(entry.content ?? '')
    if (!tokens.every(token => content.includes(token))) continue
    const room = maxChars - used
    if (room < 40) break
    const text = content.length > Math.min(240, room) ? `${content.slice(0, Math.min(239, room - 1))}…` : content
    hits.push({ turn: entry.turn, role: entry.role, ts: entry.ts ?? null, text })
    used += text.length
    if (hits.length >= limit) break
  }
  return hits
}
