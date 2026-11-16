/**
 * Deterministic thread brief.
 *
 * A long conversation does not always need a persona. For the common case —
 * "this thread was solving something and I want to keep going" — this module
 * writes a compact, factual brief: what the thread is about, what was decided,
 * what is still open, and the last few turns verbatim. No model call, no
 * invented memories, no character voice.
 *
 * @module dsh-reunion-import/brief
 */

import { formatDate } from './i18n.mjs'
import { iterateTranscript } from './transcript.mjs'

/** Messages reproduced verbatim at the end of the brief. */
const RECENT_TURNS = 12
/** Maximum characters of one reproduced message. */
const MESSAGE_CHARS = 500
/** Phrases that mark a decision or a next step in an assistant reply. */
const DECISION = /(建议|下一步|可以先|先.+再|计划|截止|决定|方案是|我的建议|优先|节奏|安排)/u
/** Phrases that mark an open question in a user message. */
const QUESTION = /(怎么办|要不要|是否|如何|为什么|能不能|该不该|可不可以|怎么选)/u

/** Collapse whitespace of one line. */
function line(text) {
  return String(text).replace(/\s+/gu, ' ').trim()
}

/** Remove Markdown decoration so a brief reads as prose. */
function plain(text) {
  return line(
    String(text)
      .replace(/\*\*/gu, '')
      .replace(/^#{1,6}\s*/u, '')
      .replace(/^\s*(?:[-*>]|\d+[.)])\s+/u, ''),
  )
}

/** Truncate text with an ellipsis. */
function clampText(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/** Split into sentence-like units, keeping list item text. */
function sentences(text) {
  return String(text)
    .split(/(?<=[。！？!?…~～\n])/u)
    .map(item => item.replace(/^\s*(?:[-*>]|\d+[.)])\s+/u, '').trim())
    .filter(item => item.length > 0)
}

/** Labels in the brief's language. */
function labels(locale) {
  return locale === 'en'
    ? {
      brief: 'THREAD',
      meta: 'messages',
      range: 'time',
      about: 'What this thread is about',
      start: 'Starting point',
      focus: 'Current focus',
      decided: 'What was decided / next steps',
      open: 'Still unresolved',
      recent: 'Recent turns (verbatim)',
      user: 'User',
      assistant: 'Assistant',
      omitted: 'older turns omitted for budget',
    }
    : {
      brief: '对话线程',
      meta: '消息',
      range: '时间',
      about: '这段对话在解决什么',
      start: '起点',
      focus: '目前的焦点',
      decided: '已经明确的事 / 下一步',
      open: '还没解决的问题',
      recent: '最近对话（逐字）',
      user: '用户',
      assistant: '助手',
      omitted: '较早的轮次因预算省略',
    }
}

/**
 * Build a thread brief from normalized messages.
 * @param {object} request - inputs.
 * @param {string} request.title - thread title.
 * @param {{ role: string, content: string, ts: number | null }[]} request.messages - normalized messages.
 * @param {'zh'|'en'} [request.locale] - brief language.
 * @param {number} [request.maxChars] - character budget.
 * @returns {{ text: string, stats: any }} the brief and its measurements.
 */
export function buildThreadBrief(request) {
  const locale = request.locale === 'en' ? 'en' : 'zh'
  const word = labels(locale)
  const maxChars = Math.max(1200, request.maxChars ?? 6000)
  const messages = request.messages
    .map(message => ({ ...message, content: String(message.content ?? '').trim() }))
    .filter(message => message.content.length > 0)
  const times = messages.map(message => message.ts).filter(ts => typeof ts === 'number')
  const from = times.length > 0 ? times.reduce((min, value) => (value < min ? value : min), Number.POSITIVE_INFINITY) : null
  const to = times.length > 0 ? times.reduce((max, value) => (value > max ? value : max), Number.NEGATIVE_INFINITY) : null
  const users = messages.filter(message => message.role === 'user')
  const assistants = messages.filter(message => message.role === 'assistant')

  const first = users.length > 0 ? clampText(plain(users[0].content), 400) : ''
  const last = users.length > 1 ? clampText(plain(users[users.length - 1].content), 400) : ''

  const decisions = []
  for (const message of assistants.slice(-80)) {
    for (const sentence of sentences(message.content)) {
      if (decisions.length >= 6) break
      const text = plain(sentence)
      if (text.length < 10 || text.length > 220) continue
      if (text.endsWith('：') || text.endsWith(':')) continue
      if (text.includes('|') || /^-{3,}$/u.test(text)) continue
      if (!DECISION.test(text)) continue
      if (decisions.some(existing => existing === text)) continue
      decisions.push(text)
    }
  }

  const half = Math.floor(users.length / 2)
  const open = []
  for (const [index, message] of users.entries()) {
    if (index < half) continue
    if (open.length >= 6) break
    const text = plain(message.content)
    if (!/[？?]/u.test(text) && !QUESTION.test(text)) continue
    if (text.length < 6) continue
    open.push(clampText(text, 220))
  }

  const header = [
    `# ${request.title || word.brief} · ${word.brief}`,
    `- ${word.meta}: ${messages.length} · ${word.range}: ${formatDate(from)} → ${formatDate(to)}`,
  ]
  const about = first.length === 0
    ? []
    : [
      `## ${word.about}`,
      `- ${word.start}: ${first}`,
      last.length > 0 ? `- ${word.focus}: ${last}` : '',
    ].filter(Boolean)
  const decidedSection = decisions.length > 0 ? [`## ${word.decided}`, ...decisions.map(item => `- ${item}`)] : []
  const openSection = open.length > 0 ? [`## ${word.open}`, ...open.map(item => `- ${item}`)] : []

  const recentSource = messages.slice(-RECENT_TURNS)
  const renderRecent = picked => {
    if (picked.length === 0) return []
    return [
      `## ${word.recent}`,
      ...picked.map(message => `${message.role === 'assistant' ? word.assistant : word.user}: ${clampText(line(message.content), MESSAGE_CHARS)}`),
    ]
  }

  let fixedText = [...header, '', ...about, ...(decidedSection.length > 0 ? ['', ...decidedSection] : []), ...(openSection.length > 0 ? ['', ...openSection] : [])].join('\n')
  if (fixedText.length > maxChars - 200) fixedText = `${fixedText.slice(0, Math.max(0, maxChars - 200)).trimEnd()}…`

  const recentLines = []
  let budget = maxChars - fixedText.length - 60
  for (let index = recentSource.length - 1; index >= 0; index--) {
    const message = recentSource[index]
    const rendered = `${message.role === 'assistant' ? word.assistant : word.user}: ${clampText(plain(message.content), MESSAGE_CHARS)}`
    if (rendered.length + 1 > budget) break
    recentLines.unshift(rendered)
    budget -= rendered.length + 1
  }
  const omitted = messages.length > recentLines.length
  const recentSection = recentLines.length > 0 ? [`## ${word.recent}`, ...recentLines] : []
  const omittedLine = omitted ? [`（${word.omitted}）`] : []
  const text = [fixedText, '', ...recentSection, ...(omittedLine.length > 0 ? ['', ...omittedLine] : [])]
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
  const clamped = text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text
  return {
    text: `${clamped}\n`,
    stats: {
      messages: messages.length,
      users: users.length,
      assistants: assistants.length,
      from,
      to,
      decisions: decisions.length,
      open: open.length,
      recent: recentLines.length,
      chars: clamped.length,
      truncated: omitted || clamped.length < text.length,
    },
  }
}
/**
 * Read a transcript and build its thread brief.
 * @param {object} request - inputs.
 * @param {string} request.transcriptPath - archive path.
 * @param {string} request.title - thread title.
 * @param {'zh'|'en'} [request.locale] - brief language.
 * @param {number} [request.maxChars] - character budget.
 * @returns {Promise<{ text: string, stats: any }>} the brief and its measurements.
 */
export async function buildThreadBriefFromTranscript(request) {
  const messages = []
  for await (const entry of iterateTranscript(request.transcriptPath)) {
    messages.push({ role: entry.role, content: entry.content, ts: entry.ts })
  }
  return buildThreadBrief({
    title: request.title,
    messages,
    locale: request.locale,
    maxChars: request.maxChars,
  })
}
