/**
 * Deterministic thread brief.
 *
 * A long conversation does not always need a persona. For the common case —
 * "this thread was solving something and I want to keep going" — this module
 * writes a compact continuation pack: what the thread is about, what was
 * decided, what is still open, a few verbatim voice anchors, and a short hot
 * window of recent turns. No model call, no invented memories.
 *
 * Budget priority: facts + voice first; recent turns fill the remainder.
 *
 * @module dsh-reunion-import/brief
 */

import { formatDate } from './i18n.mjs'
import { iterateTranscript } from './transcript.mjs'

/** Messages reproduced verbatim at the end of the brief (hot window). */
const RECENT_TURNS = 4
/** Maximum characters of one reproduced recent message. */
const MESSAGE_CHARS = 320
/** Verbatim assistant sentences kept as tone anchors. */
const VOICE_ANCHORS = 4
/** Maximum characters of one voice anchor. */
const VOICE_CHARS = 100
/** Phrases that mark a decision or a next step in an assistant reply. */
const DECISION = /(建议|下一步|可以先|先.+再|计划|截止|决定|方案是|我的建议|优先|节奏|安排)/u
/** Phrases that mark an open question in a user message. */
const QUESTION = /(怎么办|要不要|是否|如何|为什么|能不能|该不该|可不可以|怎么选)/u
/** Particles / marks that carry recognizable tone. */
const VOICE_MARK = /[呀吧呢啦哦嘛喔诶欸嗯哈咯捏嗷嘿～~…—]/u

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

/**
 * Pick a few distinctive assistant sentences as tone anchors.
 * Prefers short, spoken lines over long advice blocks.
 * @param {{ content: string }[]} assistants - assistant messages.
 * @param {number} limit - maximum anchors.
 * @returns {string[]} selected verbatim sentences.
 */
function pickVoiceAnchors(assistants, limit) {
  const pool = []
  for (const message of assistants) {
    for (const sentence of sentences(message.content)) {
      const text = plain(sentence)
      if (text.length < 8 || text.length > VOICE_CHARS) continue
      if (text.endsWith('：') || text.endsWith(':')) continue
      if (text.includes('|') || /^-{3,}$/u.test(text)) continue
      if (/https?:\/\//u.test(text) || /```/u.test(text)) continue
      if (/^(抱歉|对不起|作为|我是一个|请问)/u.test(text)) continue
      let score = 1
      if (VOICE_MARK.test(text)) score += 2
      if (text.length >= 12 && text.length <= 60) score += 1
      if (DECISION.test(text)) score -= 1
      if (/[？?]/u.test(text)) score -= 0.5
      pool.push({ text, score })
    }
  }
  pool.sort((left, right) => right.score - left.score)
  const selected = []
  for (const item of pool) {
    if (selected.length >= limit) break
    if (selected.some(existing => existing === item.text || existing.includes(item.text) || item.text.includes(existing))) continue
    selected.push(item.text)
  }
  return selected
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
      voice: 'Voice anchors (verbatim)',
      voiceHint: 'Match this tone when continuing; do not recite the brief.',
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
      voice: '口吻参考（原句）',
      voiceHint: '续写时沿用这些句子的语气；不要复述整段摘要。',
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
 * @param {string[]} [request.omit] - sentences already stored in CORE; matching bullets are dropped.
 * @returns {{ text: string, stats: any }} the brief and its measurements.
 */
export function buildThreadBrief(request) {
  const locale = request.locale === 'en' ? 'en' : 'zh'
  const omit = Array.isArray(request.omit) ? request.omit : []
  const blocked = text => omit.some(item => {
    const left = String(text)
    const right = String(item)
    if (left.length < 8 || right.length < 8) return left === right
    return left === right || left.includes(right) || right.includes(left)
  })
  const word = labels(locale)
  const maxChars = Math.max(1200, request.maxChars ?? 3500)
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
      if (blocked(text)) continue
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
    if (blocked(text)) continue
    open.push(clampText(text, 220))
  }

  const voice = pickVoiceAnchors(assistants, VOICE_ANCHORS).filter(text => !blocked(text))

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
  const voiceSection = voice.length > 0
    ? [`## ${word.voice}`, ...voice.map(item => `- ${item}`), `> ${word.voiceHint}`]
    : []

  const recentSource = messages.slice(-RECENT_TURNS)

  let fixedText = [
    ...header,
    '',
    ...about,
    ...(decidedSection.length > 0 ? ['', ...decidedSection] : []),
    ...(openSection.length > 0 ? ['', ...openSection] : []),
    ...(voiceSection.length > 0 ? ['', ...voiceSection] : []),
  ].join('\n')
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
      voice: voice.length,
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
 * @param {string[]} [request.omit] - sentences already stored in CORE.
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
    omit: request.omit,
  })
}
