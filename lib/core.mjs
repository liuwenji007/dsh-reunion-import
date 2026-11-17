/**
 * Deterministic core memory for a thread.
 *
 * CORE keeps durable facts (decisions, open commitments, dates, address,
 * a few self-disclosures). THREAD keeps the hot window and must not repeat
 * the same sentences. Later recalls append under a "回想" section; when the
 * budget is exceeded, the oldest recall lines are dropped first.
 *
 * @module dsh-reunion-import/core
 */

import { iterateTranscript } from './transcript.mjs'

/** Heading that separates imported facts from silent recall pins. */
export const RECALL_HEADING = '## 回想'

/**
 * Fact lines already stored in CORE, excluding recall pins.
 * @param {string} coreText - CORE.md.
 * @returns {string[]} snippets THREAD should not repeat.
 */
export function coreFactLines(coreText) {
  const head = String(coreText ?? '').split(RECALL_HEADING)[0]
  return head.split('\n').filter(line => line.startsWith('- ')).map(line => line.slice(2).trim()).filter(line => line.length >= 8)
}

/**
 * Silent recall pin lines under the 回想 section.
 * @param {string} coreText - CORE.md.
 * @returns {string[]} pin snippets without leading dashes.
 */
export function corePinLines(coreText) {
  const source = String(coreText ?? '')
  const splitAt = source.indexOf(RECALL_HEADING)
  if (splitAt < 0) return []
  return source
    .slice(splitAt + RECALL_HEADING.length)
    .split('\n')
    .map(line => line.replace(/^- /u, '').trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
}

const DECISION = /(建议|下一步|可以先|先.+再|计划|截止|决定|方案是|我的建议|优先|节奏|安排)/u
const QUESTION = /(怎么办|要不要|是否|如何|为什么|能不能|该不该|可不可以|怎么选)/u
const DATED = /(截止|明天|下周|周[一二三四五六日天]|[0-9]{1,2}月|[0-9]{1,2}号)/u
const ADDRESS = /^(宝|亲爱的|小家伙)[，,]/u
const DISCLOSURE = /(我叫|我是|我喜欢|我打算|我准备|我在做)/u

/** Collapse whitespace. */
function plain(text) {
  return String(text).replace(/\s+/gu, ' ').trim()
}

/** Split into sentence-like units. */
function sentences(text) {
  return String(text)
    .split(/(?<=[。！？!?…~～\n])/u)
    .map(item => plain(item))
    .filter(item => item.length >= 8 && item.length <= 220)
}

/**
 * Whether two snippets are the same fact (equal or contained).
 * @param {string} left - one snippet.
 * @param {string} right - another snippet.
 * @returns {boolean} true when one contains the other.
 */
export function overlaps(left, right) {
  const a = plain(left)
  const b = plain(right)
  if (a.length < 8 || b.length < 8) return a === b && a.length > 0
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * Whether text repeats any kept snippet.
 * @param {string} text - candidate.
 * @param {string[]} kept - snippets already selected.
 * @returns {boolean} true when it overlaps.
 */
export function overlapsAny(text, kept) {
  return kept.some(item => overlaps(text, item))
}

/**
 * Build CORE.md from normalized messages.
 * @param {object} request - inputs.
 * @param {string} [request.title] - thread title.
 * @param {{ role: string, content: string }[]} request.messages - normalized messages.
 * @param {'zh'|'en'} [request.locale] - labels.
 * @param {number} [request.maxChars] - character budget.
 * @returns {{ text: string, sentences: string[], stats: { chars: number } }} core text and the sentences THREAD must omit.
 */
export function buildCore(request) {
  const locale = request.locale === 'en' ? 'en' : 'zh'
  const maxChars = Math.max(400, request.maxChars ?? 1200)
  const messages = (request.messages ?? [])
    .map(message => ({ role: message.role, content: plain(message.content) }))
    .filter(message => message.content.length > 0)
  const facts = []
  const push = text => {
    const line = plain(text)
    if (line.length < 8 || overlapsAny(line, facts)) return
    facts.push(line)
  }

  const assistants = messages.filter(message => message.role === 'assistant')
  const users = messages.filter(message => message.role === 'user')
  for (const message of assistants.slice(-80)) {
    for (const sentence of sentences(message.content)) {
      if (facts.length >= 8) break
      if (DECISION.test(sentence) || DATED.test(sentence)) push(sentence)
    }
  }
  for (const message of assistants) {
    if (ADDRESS.test(message.content)) {
      push(locale === 'en' ? `Address: ${message.content.slice(0, 12)}` : `称呼：${message.content.slice(0, 8)}`)
      break
    }
  }
  const half = Math.floor(users.length / 2)
  for (const [index, message] of users.entries()) {
    if (index < half) continue
    if (!QUESTION.test(message.content) && !/[？?]/u.test(message.content)) continue
    push(message.content.slice(0, 180))
    if (facts.filter(item => QUESTION.test(item) || /[？?]/u.test(item)).length >= 3) break
  }
  let disclosures = 0
  for (const message of users) {
    if (disclosures >= 3) break
    for (const sentence of sentences(message.content)) {
      if (!DISCLOSURE.test(sentence)) continue
      push(sentence)
      disclosures += 1
      break
    }
  }

  const title = request.title || (locale === 'en' ? 'Core memory' : '核心记忆')
  const heading = locale === 'en' ? 'Durable facts' : '硬约定'
  const lines = [`# ${title} · ${locale === 'en' ? 'CORE' : '核心记忆'}`, '', `## ${heading}`, ...facts.map(item => `- ${item}`)]
  let text = `${lines.join('\n')}\n`
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…\n`
  return { text, sentences: facts, stats: { chars: text.length } }
}

/**
 * Build CORE from a transcript file.
 * @param {object} request - inputs.
 * @param {string} request.transcriptPath - archive path.
 * @param {string} [request.title] - thread title.
 * @param {'zh'|'en'} [request.locale] - labels.
 * @param {number} [request.maxChars] - character budget.
 * @returns {Promise<ReturnType<typeof buildCore>>} core document.
 */
export async function buildCoreFromTranscript(request) {
  const messages = []
  for await (const entry of iterateTranscript(request.transcriptPath)) {
    messages.push({ role: entry.role, content: entry.content })
  }
  return buildCore({
    title: request.title,
    messages,
    locale: request.locale,
    maxChars: request.maxChars,
  })
}

/**
 * Append recall excerpts under the pin section.
 * Imported facts stay; the oldest pin lines are dropped until the budget fits.
 * @param {string} coreText - current CORE.md.
 * @param {string[]} excerpts - new snippets.
 * @param {number} maxChars - character budget.
 * @returns {string} updated CORE.md.
 */
export function appendCorePins(coreText, excerpts, maxChars) {
  const budget = Math.max(400, maxChars)
  const source = String(coreText ?? '')
  const splitAt = source.indexOf(RECALL_HEADING)
  const base = (splitAt >= 0 ? source.slice(0, splitAt) : source).trimEnd()
  const pins = splitAt >= 0
    ? source.slice(splitAt + RECALL_HEADING.length).split('\n').map(line => line.replace(/^- /u, '').trim()).filter(line => line.length > 0 && !line.startsWith('#'))
    : []
  for (const excerpt of excerpts) {
    const text = plain(excerpt).slice(0, 240)
    if (text.length < 2) continue
    if (base.includes(text) || pins.some(pin => overlaps(pin, text) || pin === text)) continue
    pins.push(text)
  }
  const render = () => (pins.length === 0
    ? `${base}\n`
    : `${base}\n\n${RECALL_HEADING}\n${pins.map(pin => `- ${pin}`).join('\n')}\n`)
  let text = render()
  while (text.length > budget && pins.length > 0) {
    pins.shift()
    text = render()
  }
  if (text.length > budget) text = `${text.slice(0, budget - 1)}…\n`
  return text
}
