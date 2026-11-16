/**
 * Validation of a distilled draft before anything is written.
 *
 * The checks exist to prevent the failure mode this plugin is built against:
 * a "persona" that is really a transcript digest, where the model becomes a
 * narrator of the old conversation instead of the character in it. So the
 * checks are mechanical, not taste-based:
 *
 * - MEMORY.md stays inside its budget and carries the relationship structure.
 * - Every few-shot anchor really occurs in the transcript, and the count is 5–10.
 * - SOUL.md prose never reproduces a transcript window; only declared anchors do.
 * - The three sample replies are new, not copied lines.
 *
 * @module dsh-reunion-import/validate
 */

import { countBudget, countCjk } from './digest.mjs'
import { iterateTranscript } from './transcript.mjs'

/** Maximum characters indexed for matching. */
const GRAM_LIMIT = 3_000_000

/**
 * Normalize text for verbatim comparison: lower-case, whitespace collapsed.
 * @param {string} text - any text.
 * @returns {string} comparable text.
 */
export function normalizeForMatch(text) {
  return String(text).replace(/\s+/gu, ' ').trim().toLowerCase()
}

/**
 * 32-bit FNV-1a hash of a string window.
 * @param {string} text - window text.
 * @returns {number} unsigned 32-bit hash.
 */
export function hashWindow(text) {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/**
 * Index a transcript for quote checks and the anti-verbatim guard.
 * @param {string} transcriptPath - transcript file.
 * @param {number} window - window length in characters.
 * @param {number} maxChars - maximum indexed characters.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {Promise<{ grams: Set<number>, exact: Set<string>, haystack: string, messages: number, chars: number, truncated: boolean }>} index.
 */
export async function indexTranscript(transcriptPath, window, maxChars, signal) {
  const grams = new Set()
  const exact = new Set()
  const parts = []
  let chars = 0
  let messages = 0
  let truncated = false
  for await (const entry of iterateTranscript(transcriptPath, { signal })) {
    messages++
    const text = normalizeForMatch(entry.content)
    if (text.length === 0) continue
    if (chars + text.length > maxChars) {
      truncated = true
      break
    }
    chars += text.length
    parts.push(text)
    if (exact.size < 50000 && text.length >= 12) exact.add(text)
    if (grams.size < GRAM_LIMIT && text.length >= window) {
      for (let index = 0; index + window <= text.length; index++) {
        grams.add(hashWindow(text.slice(index, index + window)))
        if (grams.size >= GRAM_LIMIT) {
          truncated = true
          break
        }
      }
    }
  }
  return { grams, exact, haystack: parts.join('\n'), messages, chars, truncated }
}

/**
 * Find a verbatim window of SOUL prose that also occurs in the transcript.
 * @param {string} soul - SOUL prose (anchors excluded).
 * @param {Set<number>} grams - transcript window hashes.
 * @param {string} haystack - normalized transcript text.
 * @param {number} window - window length.
 * @param {Set<string>} [exact] - whole normalized transcript messages.
 * @returns {string | null} the offending excerpt, or null when the prose is original.
 */
export function findVerbatim(soul, grams, haystack, window, exact = new Set()) {
  for (const rawLine of String(soul).split(/\r?\n/u)) {
    const line = normalizeForMatch(rawLine).replace(/^[-*>#\s]+/u, '')
    if (line.length >= 12 && exact.has(line)) return line
    if (grams.size === 0) continue
    if (line.length < window) continue
    for (let index = 0; index + window <= line.length; index++) {
      const candidate = line.slice(index, index + window)
      if (!grams.has(hashWindow(candidate))) continue
      if (haystack.includes(candidate)) return candidate
    }
  }
  return null
}

/**
 * Check a draft against the distilled transcript and the configured budgets.
 * @param {object} request - inputs.
 * @param {{ displayName: string, userNickname: string, soul: string, memory: string, fewShots: string[], samples: string[], uncertain: string[] }} request.draft - the draft.
 * @param {string} request.transcriptPath - archive used for matching.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} request.config - resolved config.
 * @param {AbortSignal} [request.signal] - cancellation.
 * @returns {Promise<{ errors: { code: string, detail?: string }[], warnings: { code: string, detail?: string }[], stats: any }>} verdict.
 */
export async function validateDraft(request) {
  const { draft, transcriptPath, config } = request
  const errors = []
  const warnings = []
  const soul = typeof draft.soul === 'string' ? draft.soul.trim() : ''
  const memory = typeof draft.memory === 'string' ? draft.memory.trim() : ''
  const fewShots = Array.isArray(draft.fewShots) ? draft.fewShots.map(item => String(item).trim()).filter(item => item.length > 0) : []
  const samples = Array.isArray(draft.samples) ? draft.samples.map(item => String(item).trim()) : []
  const uncertain = Array.isArray(draft.uncertain) ? draft.uncertain.map(item => String(item).trim()).filter(item => item.length > 0) : []
  const displayName = String(draft.displayName ?? '').trim()
  const userNickname = String(draft.userNickname ?? '').trim()

  if (displayName.length === 0) errors.push({ code: 'display.missing' })
  if (userNickname.length === 0) errors.push({ code: 'nickname.missing' })
  if (soul.length === 0) errors.push({ code: 'soul.missing' })
  if (memory.length === 0) errors.push({ code: 'memory.missing' })

  const soulChars = countBudget(soul)
  const memoryChars = countBudget(memory)
  if (soul.length > 0 && soulChars < 80) errors.push({ code: 'soul.too-short', detail: String(soulChars) })
  if (memory.length > 0 && memoryChars < 80) errors.push({ code: 'memory.too-short', detail: String(memoryChars) })
  if (memoryChars > config.maxMemoryChars) {
    errors.push({ code: 'memory.budget', detail: `${memoryChars}/${config.maxMemoryChars}` })
  }
  if (memory.length > 0) {
    if (!/^#{1,3}\s+\S/mu.test(memory)) errors.push({ code: 'memory.structure' })
    const bullets = memory.split(/\r?\n/u).filter(line => /^\s*([-*]|\d+[.)])\s+\S/u.test(line)).length
    if (bullets < 4) errors.push({ code: 'memory.bullets', detail: String(bullets) })
    if (userNickname.length > 0 && !memory.includes(userNickname)) errors.push({ code: 'memory.nickname', detail: userNickname })
    if (/(可能|大概|也许|似乎|推测|或许|maybe|probably|perhaps|likely)/iu.test(memory)) {
      warnings.push({ code: 'memory.hedge' })
    }
    if (displayName.length > 0 && !soul.includes(displayName)) warnings.push({ code: 'soul.display-name' })
  }

  if (fewShots.length < config.fewShotMin || fewShots.length > config.fewShotMax) {
    errors.push({ code: 'fewshot.count', detail: `${fewShots.length}/${config.fewShotMin}-${config.fewShotMax}` })
  }
  for (const quote of fewShots) {
    if (quote.length < 6 || quote.length > 200) {
      errors.push({ code: 'fewshot.length', detail: quote.slice(0, 40) })
    }
    if (quote.includes('\n')) errors.push({ code: 'fewshot.multiline', detail: quote.slice(0, 40) })
  }

  if (samples.length !== 3) errors.push({ code: 'samples.count', detail: String(samples.length) })
  for (const sample of samples) {
    if (sample.length === 0 || sample.length > 300) errors.push({ code: 'samples.length', detail: sample.slice(0, 40) })
  }

  const index = await indexTranscript(transcriptPath, config.verbatimWindow, config.maxSearchChars, request.signal)
  const normalizedHaystack = index.haystack
  if (index.truncated) warnings.push({ code: 'scan.truncated', detail: String(index.chars) })

  if (!index.truncated) {
    for (const quote of fewShots) {
      if (quote.includes('\n')) continue
      if (!normalizedHaystack.includes(normalizeForMatch(quote))) {
        errors.push({ code: 'fewshot.not-found', detail: quote.slice(0, 40) })
      }
    }
    const offending = soul.length > 0 ? findVerbatim(soul, index.grams, normalizedHaystack, config.verbatimWindow, index.exact) : null
    if (offending !== null) errors.push({ code: 'soul.verbatim', detail: offending })
  }

  const seenSamples = new Set()
  for (const sample of samples) {
    if (sample.length === 0) continue
    const normalized = normalizeForMatch(sample)
    if (seenSamples.has(normalized)) {
      errors.push({ code: 'samples.duplicate' })
      continue
    }
    seenSamples.add(normalized)
    if (normalizedHaystack.includes(normalized)) {
      errors.push({ code: 'samples.verbatim', detail: sample.slice(0, 40) })
      continue
    }
    if (!index.truncated && normalized.length >= config.verbatimWindow) {
      let present = 0
      let total = 0
      for (let position = 0; position + config.verbatimWindow <= normalized.length; position++) {
        total++
        if (index.grams.has(hashWindow(normalized.slice(position, position + config.verbatimWindow)))) present++
      }
      const ratio = total === 0 ? 0 : present / total
      if (ratio > 0.6) errors.push({ code: 'samples.derivative', detail: sample.slice(0, 40) })
      else if (ratio > 0.3) warnings.push({ code: 'samples.close', detail: sample.slice(0, 40) })
    }
  }

  return {
    errors,
    warnings,
    stats: {
      soulChars,
      soulCjk: countCjk(soul),
      memoryChars,
      memoryCjk: countCjk(memory),
      memoryLimit: config.maxMemoryChars,
      fewShots: fewShots.length,
      samples: samples.length,
      uncertain: uncertain.length,
      transcriptMessages: index.messages,
      transcriptChars: index.chars,
      scanTruncated: index.truncated,
    },
  }
}
