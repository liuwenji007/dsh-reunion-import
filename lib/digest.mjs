/**
 * Deterministic distillation digest.
 *
 * This module is the part of persona distillation that can be unit-tested
 * without a model: it reads the transcript once and reports measurable voice
 * evidence (length distribution, particles, punctuation, openings, address
 * terms, advice rate), a small set of verbatim few-shot candidates, and the
 * user's self-disclosure sentences that are the raw material for MEMORY.md.
 *
 * It never writes prompt text. The model composes SOUL.md and MEMORY.md from
 * this digest; `validate.mjs` checks the result.
 *
 * @module dsh-reunion-import/digest
 */

import { createHash } from 'node:crypto'

/** Digest algorithm version, bumped when fold semantics change. */
export const DIGEST_VERSION = 1

/** Sentence-final particles that carry a recognizable voice. */
const PARTICLES = ['呀', '吧', '呢', '啦', '哦', '嘛', '喔', '诶', '欸', '嗯', '哈', '咯', '捏', '嗷', '欸', '嘿']
/** Punctuation marks worth counting. */
const PUNCTUATION = ['～', '~', '……', '…', '——', '！', '!', '？', '?', '、', '“', '”', '（', '）', '；', ';']
/** Words that signal advice-giving rather than listening. */
const ADVICE = ['建议', '应该', '不妨', '可以试试', '记住', '注意', '最好', '你要', '你得', '试试看', '推荐']
/** Words that signal comfort rather than advice. */
const COMFORT = ['抱抱', '没事', '我在', '辛苦', '别怕', '陪你', '慢慢来', '不容易', '哭吧', '挺好的']
/** Common words and particles that must never become a "shared phrase". */
const STOP_GRAMS = new Set([
  '我们', '你们', '他们', '她们', '大家', '这个', '那个', '这些', '那些', '什么', '怎么', '为什么', '因为', '所以',
  '但是', '可是', '如果', '可以', '知道', '觉得', '真的', '就是', '还是', '不是', '没有', '一个', '一些', '时候',
  '现在', '今天', '明天', '昨天', '自己', '这样', '那样', '然后', '而且', '已经', '事情', '东西', '地方', '感觉',
  '喜欢', '开心', '难过', '有点', '一点', '其实', '不过', '就这样', '好吧', '好的', '对的', '是啊', '哈哈',
  '哈哈哈', '呵呵', '嗯嗯', '哦哦', '谢谢', '不好', '好的呀', '我知道', '我不知道', '没关系', '没问题', '我觉得',
  '需要', '方向', '可能', '工作', '问题', '时间', '公司', '团队', '价值', '平台', '领导', '老师', '项目', '产品',
  '业务', '技术', '开发', '系统', '数据', '内容', '需求', '目标', '方法', '方式', '情况', '结果', '原因', '建议',
  '希望', '准备', '开始', '继续', '应该', '可以', '如果', '但是', '因为', '所以', '现在', '已经', '还是', '这样',
  '那样', '一个', '一些', '什么', '怎么', '为什么', '时候', '自己', '觉得', '知道', '真的', '就是', '没有',
  '不是', '我们', '你们', '他们', '大家', '这个', '那个', '这些', '那些', '以及', '还有', '同时', '另外', '比如',
  '当然', '首先', '其次', '最后', '总之', '这里', '那里', '上面', '下面', '前面', '后面', '第一', '第二',
])
/** Characters that cannot start or end a meaningful phrase. */
const EDGE_BAD = new Set([...'的了呢吧啊呀嘛哦哈啦着地得是在有和与就都也还很太更最不没我你他她它们这那哪什么怎么和跟吧', ' '])
/** Chinese address forms worth surfacing even without a tone pattern. */
const KNOWN_VOCATIVES = ['宝宝', '宝贝', '亲爱的', '小笨蛋', '笨蛋', '傻瓜', '小朋友', '小可爱', '乖', '乖乖', '老婆', '老公', '宝']
/** Two- and three-character clause openers that are never vocatives. */
const CLAUSE_OPENERS = new Set([
  '比如', '但是', '不过', '而且', '同时', '另外', '所以', '因此', '其实', '现在', '目前', '今天', '明天', '昨天',
  '之后', '然后', '当然', '首先', '其次', '最后', '总之', '这里', '这个', '那个', '这样', '那样', '如果', '因为',
  '并且', '以及', '还有', '我们', '你们', '他们', '是的', '对的', '好的', '可以', '你先', '你看', '你说', '你的',
  '你这', '你现', '剩下', '接下', '其他', '其它', '其它', '前面', '后面', '上面', '下面', '总之', '简单', '具体',
  '需要', '建议', '这里', '第一', '第二', '第三', '一是', '二是', '三是', '注意', '记住', '别急', '慢慢', '先别',
  '周五', '周一', '周二', '周三', '周四', '周六', '周日', '上午', '下午', '晚上', '早上',
])
/** Self-disclosure sentence patterns, in priority order. */
const DISCLOSURES = [
  { kind: 'identity', pattern: /(我是|我是做|我叫|我今年|我姓|我的名字)/u },
  { kind: 'location', pattern: /(我在|我住|我来自|我家在|搬到|出差)/u },
  { kind: 'family', pattern: /(我爸|我妈|我父母|我哥|我姐|我弟|我妹|我儿子|我女儿|我老公|我老婆|我对象|家里)/u },
  { kind: 'pet', pattern: /(我养的|我的猫|我的狗|我家猫|我家狗|猫叫|狗叫|宠物)/u },
  { kind: 'work', pattern: /(我上班|我工作|我公司|我老板|我同事|我在做|项目|离职|面试|加班)/u },
  { kind: 'plan', pattern: /(我准备|我要去|我打算|下周|下个月|明天要|今年要|计划)/u },
  { kind: 'preference', pattern: /(我喜欢|我爱|我讨厌|我不喜欢|我最喜欢|我害怕)/u },
  { kind: 'health', pattern: /(我生病|我不舒服|我感冒|我失眠|我吃药|医院)/u },
  { kind: 'feeling', pattern: /(我很累|我难过|我开心|我焦虑|我害怕|我孤单|我想你|我想你)/u },
]

/** Length buckets used by the voice profile. */
const LENGTH_BUCKETS = [
  { label: '<=8', max: 8 },
  { label: '9-20', max: 20 },
  { label: '21-40', max: 40 },
  { label: '41-80', max: 80 },
  { label: '81-160', max: 160 },
  { label: '>160', max: Number.POSITIVE_INFINITY },
]

/**
 * Count Unicode code points, which is the unit of the MEMORY.md budget.
 * @param {string} text - any text.
 * @returns {number} non-whitespace code points.
 */
export function countBudget(text) {
  let count = 0
  for (const character of String(text)) {
    if (!/\s/u.test(character)) count++
  }
  return count
}

/**
 * Count CJK characters, reported separately from the budget.
 * @param {string} text - any text.
 * @returns {number} CJK code points.
 */
export function countCjk(text) {
  let count = 0
  for (const character of String(text)) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(character)) count++
  }
  return count
}

/**
 * Count emoji and pictographs.
 * @param {string} text - any text.
 * @returns {number} pictographic code points.
 */
export function countEmoji(text) {
  let count = 0
  for (const character of String(text)) {
    if (/\p{Extended_Pictographic}/u.test(character)) count++
  }
  return count
}

/**
 * Split text into sentences without external tokenizers.
 * @param {string} text - message text.
 * @returns {string[]} sentence-like fragments.
 */
export function sentences(text) {
  return String(text)
    .split(/(?<=[。！？!?…~～\n])/u)
    .map(part => part.trim())
    .filter(part => part.length > 0)
}

/** Record one address-term occurrence with its time range. */
function bumpAddress(map, term, ts, count = 1) {
  const current = map.get(term) ?? { count: 0, first: null, last: null }
  current.count += count
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    if (current.first === null || ts < current.first) current.first = ts
    if (current.last === null || ts > current.last) current.last = ts
  }
  map.set(term, current)
}

/** Sorted top-N helper over a count map. */
function topEntries(map, limit, filter = () => true) {
  return [...map.entries()]
    .filter(([, count]) => count > 0)
    .filter(([value]) => filter(value))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
}

/** Median of a sorted-in-place numeric array. */
function median(values) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle]
}

/** Percentile. */
function percentile(values, fraction) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))
  return sorted[index]
}

/** ISO date (YYYY-MM-DD) in UTC. */
function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10)
}

/** ISO month (YYYY-MM) in UTC. */
function isoMonth(ms) {
  return new Date(ms).toISOString().slice(0, 7)
}

/** Extract CJK runs of one message for phrase mining. */
function cjkRuns(text) {
  return String(text).match(/[\u3400-\u9fff]{2,}/gu) ?? []
}

/** Whether a phrase may be reported as a shared phrase. */
function usablePhrase(phrase) {
  if (phrase.length < 2) return false
  if (STOP_GRAMS.has(phrase)) return false
  if (EDGE_BAD.has(phrase[0]) || EDGE_BAD.has(phrase[phrase.length - 1])) return false
  return true
}

/** Five-character shingles of normalized text, used for similarity checks. */
export function shingles(text, size = 5) {
  const normalized = String(text).replace(/\s+/gu, '').toLowerCase()
  const set = new Set()
  if (normalized.length <= size) {
    if (normalized.length > 0) set.add(normalized)
    return set
  }
  for (let index = 0; index + size <= normalized.length; index++) set.add(normalized.slice(index, index + size))
  return set
}

/** Jaccard similarity of two shingle sets. */
export function similarity(left, right) {
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const item of left) if (right.has(item)) shared++
  return shared / (left.size + right.size - shared)
}

/**
 * Build the digest from normalized transcript entries.
 * @param {object} request - inputs.
 * @param {Iterable<{ role: string, content: string, ts: number | null, turn: number }> | AsyncIterable<{ role: string, content: string, ts: number | null, turn: number }>} request.entries - transcript entries.
 * @param {string} request.slug - persona slug.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} request.config - resolved config.
 * @param {AbortSignal} [request.signal] - cancellation.
 * @returns {Promise<any>} the digest.
 */
export async function buildDigest(request) {
  const { entries, slug, config } = request
  const signal = request.signal
  const counts = { user: 0, assistant: 0, system: 0 }
  const lengths = { user: [], assistant: [] }
  const endings = new Map()
  const punctuation = new Map()
  const openings = new Map()
  /** term -> { count, first, last } */
  const addressTerms = new Map()
  const months = new Map()
  const gaps = []
  const disclosures = []
  const seenDisclosures = new Set()
  const phraseCounts = new Map()
  const phraseMessages = new Map()
  const fewShotPool = []
  let advice = 0
  let comfort = 0
  let questions = 0
  let emoji = 0
  let totalChars = 0
  let messageCount = 0
  let from = null
  let to = null
  let previousTs = null

  for await (const entry of entries) {
    if (signal?.aborted === true) throw signal.reason ?? new Error('aborted')
    if (entry.role !== 'user' && entry.role !== 'assistant' && entry.role !== 'system') continue
    messageCount++
    counts[entry.role] = (counts[entry.role] ?? 0) + 1
    const text = entry.content
    totalChars += text.length
    if (entry.ts !== null && entry.ts !== undefined) {
      if (from === null || entry.ts < from) from = entry.ts
      if (to === null || entry.ts > to) to = entry.ts
      const month = isoMonth(entry.ts)
      months.set(month, (months.get(month) ?? 0) + 1)
      if (previousTs !== null && entry.ts - previousTs > 45 * 24 * 3600 * 1000) {
        gaps.push({ from: isoDate(previousTs), to: isoDate(entry.ts), days: Math.round((entry.ts - previousTs) / 86400000) })
      }
      previousTs = entry.ts
    }

    if (entry.role === 'assistant') {
      lengths.assistant.push(text.length)
      for (const particle of PARTICLES) {
        const matches = text.match(new RegExp(particle, 'gu'))
        if (matches !== null) endings.set(particle, (endings.get(particle) ?? 0) + matches.length)
      }
      for (const mark of PUNCTUATION) {
        const matches = text.split(mark).length - 1
        if (matches > 0) punctuation.set(mark, (punctuation.get(mark) ?? 0) + matches)
      }
      const opening = text.replace(/^[\s「『"'（(*~～]+/u, '').slice(0, 4)
      if (opening.length >= 2) openings.set(opening, (openings.get(opening) ?? 0) + 1)
      emoji += countEmoji(text)
      if (text.includes('？') || text.includes('?')) questions++
      if (ADVICE.some(word => text.includes(word))) advice++
      if (COMFORT.some(word => text.includes(word))) comfort++
      // A vocative opens the whole message with a short name and a separator:
      // "宝，…" is one; "是的，…" or "比如，…" is a clause, not an address.
      const head = /^([\u3400-\u9fff]{1,3})[，,、：:]/u.exec(text.trim())
      if (head !== null) {
        const term = head[1]
        const known = KNOWN_VOCATIVES.includes(term)
        const clean = !STOP_GRAMS.has(term)
          && !EDGE_BAD.has(term[0])
          && !EDGE_BAD.has(term[term.length - 1])
          && !CLAUSE_OPENERS.has(term)
        if (known || clean) bumpAddress(addressTerms, term, entry.ts)
      }
      for (const candidate of fewShotCandidates(text)) {
        fewShotPool.push({
          text: candidate.text,
          ts: entry.ts ?? null,
          turn: entry.turn,
          length: candidate.text.length,
          score: candidate.score,
        })
      }
    } else {
      lengths.user.push(text.length)
      if (entry.role === 'user') {
        for (const sentence of sentences(text)) {
          const trimmed = sentence.trim()
          if (trimmed.length < 4 || trimmed.length > 180) continue
          const rule = DISCLOSURES.find(item => item.pattern.test(trimmed))
          if (rule === undefined) continue
          const key = trimmed.replace(/\s+/gu, '')
          if (seenDisclosures.has(key)) continue
          seenDisclosures.add(key)
          disclosures.push({ text: trimmed, kind: rule.kind, ts: entry.ts ?? null, turn: entry.turn })
        }
      }
    }

    for (const run of cjkRuns(text)) {
      const maxN = Math.min(5, run.length)
      for (let size = 2; size <= maxN; size++) {
        for (let index = 0; index + size <= run.length; index++) {
          const phrase = run.slice(index, index + size)
          if (!usablePhrase(phrase)) continue
          phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1)
          let holders = phraseMessages.get(phrase)
          if (holders === undefined) {
            holders = new Set()
            phraseMessages.set(phrase, holders)
          }
          holders.add(messageCount)
        }
      }
    }
  }

  const userLengths = lengths.user
  const assistantLengths = lengths.assistant
  const bucketCounts = LENGTH_BUCKETS.map(bucket => ({ label: bucket.label, count: 0 }))
  for (const length of assistantLengths) {
    const index = LENGTH_BUCKETS.findIndex(bucket => length <= bucket.max)
    bucketCounts[index === -1 ? bucketCounts.length - 1 : index].count++
  }

  const exactPhrases = topEntries(phraseCounts, 60, phrase => (phraseMessages.get(phrase)?.size ?? 0) >= 2)
    .map(([phrase, count]) => ({ phrase, count, messages: phraseMessages.get(phrase)?.size ?? 0 }))
  const sharedPhrases = exactPhrases
    .filter(item => !exactPhrases.some(other => other !== item && other.phrase.length > item.phrase.length && other.phrase.includes(item.phrase) && other.messages === item.messages))
    .slice(0, 20)

  const fewShots = pickFewShots(fewShotPool, config.fewShotMax)
  const addressList = [...addressTerms.entries()]
    .map(([term, value]) => ({ term, count: value.count, first: value.first, last: value.last }))
    .filter(item => item.term.length >= 1)
    // A one-off three-character phrase is a clause far more often than a name.
    .filter(item => item.term.length <= 2 || KNOWN_VOCATIVES.includes(item.term) || item.count >= 2)
    .sort((left, right) => right.count - left.count || left.term.localeCompare(right.term))
    .slice(0, 12)

  const digest = {
    version: DIGEST_VERSION,
    slug,
    messages: messageCount,
    counts,
    totalChars,
    from,
    to,
    stats: {
      assistant: {
        count: assistantLengths.length,
        median: median(assistantLengths),
        p90: percentile(assistantLengths, 0.9),
        buckets: bucketCounts,
        shortRatio: assistantLengths.length === 0 ? 0 : round(assistantLengths.filter(length => length <= 8).length / assistantLengths.length),
        questionRatio: assistantLengths.length === 0 ? 0 : round(questions / assistantLengths.length),
        adviceRatio: assistantLengths.length === 0 ? 0 : round(advice / assistantLengths.length),
        comfortRatio: assistantLengths.length === 0 ? 0 : round(comfort / assistantLengths.length),
        emojiPerMessage: assistantLengths.length === 0 ? 0 : round(emoji / assistantLengths.length),
      },
      user: { count: userLengths.length, median: median(userLengths), p90: percentile(userLengths, 0.9) },
    },
    voice: {
      endings: topEntries(endings, 12).map(([value, count]) => ({ value, count })),
      punctuation: topEntries(punctuation, 12).map(([value, count]) => ({ value, count })),
      openings: topEntries(openings, 10).map(([value, count]) => ({ value, count })),
      addressTerms: addressList,
      particlesPer100: assistantLengths.length === 0 ? 0 : round([...endings.values()].reduce((sum, value) => sum + value, 0) / assistantLengths.length * 100),
    },
    fewShots: fewShots.map(item => ({ text: item.text, ts: item.ts, turn: item.turn, length: item.length })),
    memory: {
      disclosures: disclosures.slice(0, 60),
      sharedPhrases,
      timeline: {
        months: [...months.entries()].sort((left, right) => left[0].localeCompare(right[0])).map(([month, count]) => ({ month, count })),
        gaps: gaps.sort((left, right) => right.days - left.days).slice(0, 5),
      },
    },
    lowConfidence: [
      ...addressList.filter(item => item.count < 2).map(item => ({ kind: 'address-term', value: item.term, seen: item.count })),
      ...disclosures.filter(item => item.ts === null).slice(0, 5).map(item => ({ kind: 'undated-disclosure', value: item.text.slice(0, 60), seen: 1 })),
    ].slice(0, 12),
    truncated: {
      disclosures: Math.max(0, disclosures.length - 60),
      sharedPhrases: Math.max(0, exactPhrases.length - sharedPhrases.length),
    },
  }
  digest.fingerprint = createHash('sha256').update(JSON.stringify({ messages: digest.messages, from, to, fewShots: digest.fewShots.map(item => item.text) })).digest('hex').slice(0, 16)
  return digest
}

/** Round to three decimals. */
function round(value) {
  return Math.round(value * 1000) / 1000
}

/**
 * Extract few-shot anchor candidates from one assistant message.
 *
 * Long consultative replies are the norm in some relationships, so a whole
 * message is not a usable anchor: the plugin takes representative sentences
 * that are exact substrings of the message. Short replies stay whole.
 *
 * @param {string} text - assistant message.
 * @returns {{ text: string, score: number }[]} anchor candidates with scores.
 */
function fewShotCandidates(text) {
  const whole = selectFewShotCandidate(text)
  if (whole !== null) return [{ text, score: whole }]
  if (text.length <= 180) return []
  const candidates = []
  for (const sentence of sentences(text)) {
    const trimmed = sentence.replace(/^\s*(?:[-*>]|\d+[.)])\s+/u, '').trim()
    if (trimmed.length < 18 || trimmed.length > 140) continue
    if (/https?:\/\//u.test(trimmed) || /```/u.test(trimmed) || /^#+\s/u.test(trimmed)) continue
    if (trimmed.includes('**') || /\|.+\|/u.test(trimmed)) continue
    if (/^(抱歉|对不起|作为|请问)/u.test(trimmed)) continue
    let score = 1
    if (ADVICE.some(word => trimmed.includes(word))) score += 0.5
    if (trimmed.includes('——') || trimmed.includes('、')) score += 0.5
    if (/[？?]/u.test(trimmed)) score -= 0.5
    if (trimmed.length >= 30 && trimmed.length <= 90) score += 1
    candidates.push({ text: trimmed, score })
  }
  return candidates
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
}

/**
 * Score one assistant message as a whole-message few-shot anchor.
 * @param {string} text - assistant message.
 * @returns {number | null} score, or null when the message is unsuitable.
 */
function selectFewShotCandidate(text) {
  if (text.length < 12 || text.length > 180) return null
  if (/https?:\/\//u.test(text) || /```/u.test(text) || /\|.+\|/u.test(text)) return null
  if (/\b(API|JSON|SQL|HTTP|npm|pnpm|函数|代码|参数|接口|报错)\b/u.test(text)) return null
  if (/^(抱歉|对不起|作为|我是一个|请问)/u.test(text)) return null
  if (text.split('\n').length > 3) return null
  let score = 1
  const particles = PARTICLES.reduce((sum, particle) => sum + (text.split(particle).length - 1), 0)
  score += Math.min(2, particles * 0.5)
  for (const mark of ['～', '~', '……', '…', '——', '“', '”']) {
    if (text.includes(mark)) score += 0.5
  }
  if (ADVICE.some(word => text.includes(word))) score -= 1
  if (text.length >= 24 && text.length <= 120) score += 1
  if (/[？?]/u.test(text)) score -= 0.5
  if (/[0-9]{3,}/u.test(text)) score -= 0.5
  return score
}

/**
 * Select few-shot anchors: high score, low mutual similarity, spread over time.
 * @param {{ text: string, ts: number | null, turn: number, length: number, score: number }[]} pool - candidates.
 * @param {number} limit - maximum anchors.
 * @returns {{ text: string, ts: number | null, turn: number, length: number, score: number }[]} selected anchors.
 */
export function pickFewShots(pool, limit) {
  const ranked = [...pool].sort((left, right) => right.score - left.score || left.turn - right.turn)
  const selected = []
  const usedShingles = []
  const usedMonths = new Set()
  for (const pass of [true, false]) {
    for (const candidate of ranked) {
      if (selected.length >= limit) break
      if (selected.includes(candidate)) continue
      const month = candidate.ts === null ? null : isoMonth(candidate.ts)
      if (pass && month !== null && usedMonths.has(month)) continue
      const candidateShingles = shingles(candidate.text)
      if (usedShingles.some(existing => similarity(existing, candidateShingles) > 0.45)) continue
      selected.push(candidate)
      usedShingles.push(candidateShingles)
      if (month !== null) usedMonths.add(month)
    }
  }
  return selected.sort((left, right) => (left.ts ?? 0) - (right.ts ?? 0))
}
