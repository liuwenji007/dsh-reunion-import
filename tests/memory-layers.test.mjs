/** CORE / THREAD split and literal recall pins. */
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildThreadBrief } from '../lib/brief.mjs'
import { RECALL_HEADING, appendCorePins, buildCore, coreFactLines } from '../lib/core.mjs'
import { DEFAULT_CONFIG } from '../lib/config.mjs'
import { importThread } from '../lib/import.mjs'
import { searchTranscript } from '../lib/recall.mjs'
import { writeTranscript } from './fixtures.mjs'

const messages = [
  { role: 'user', content: '我叫小林，论文十一月要交初稿，导师不想单独见我怎么办？', ts: 1 },
  { role: 'assistant', content: '宝，先说结论：建议周三前发一封短邮件，只问两个事实问题。下一步是约确认。', ts: 2 },
  { role: 'user', content: '如果他还是不回呢？', ts: 3 },
]

test('CORE keeps the decision and THREAD does not repeat that sentence', () => {
  const core = buildCore({ title: '论文', locale: 'zh', maxChars: 1200, messages })
  assert.match(core.text, /建议周三前发一封短邮件/u)
  assert.match(core.text, /称呼：宝/u)
  assert.ok(core.stats.chars <= 1200)
  const brief = buildThreadBrief({ title: '论文', locale: 'zh', maxChars: 2500, messages, omit: core.sentences })
  const beforeRecent = brief.text.split('最近对话')[0]
  assert.equal(beforeRecent.includes('建议周三前发一封短邮件'), false)
  assert.match(brief.text, /最近对话/u)
})

test('pin-only CORE has no imported fact lines', () => {
  const pinOnly = `\n\n${RECALL_HEADING}\n- 团子打碎了杯子\n`
  assert.equal(coreFactLines(pinOnly).length, 0)
  assert.ok(coreFactLines(buildCore({ title: '论文', locale: 'zh', maxChars: 1200, messages }).text).length > 0)
})

test('appendCorePins drops the oldest pin and keeps imported facts', () => {
  const core = buildCore({ title: '论文', locale: 'zh', maxChars: 1200, messages })
  const pinA = `甲${'回想'.repeat(100)}`
  const pinB = `乙${'回想'.repeat(100)}`
  const budget = 450
  let text = appendCorePins(core.text, [pinA], budget)
  text = appendCorePins(text, [pinB], budget)
  assert.match(text, /建议周三前发一封短邮件/u)
  assert.equal(text.includes(pinA), false)
  assert.match(text, /乙回想/u)
  assert.ok(text.length <= budget)
})

test('searchTranscript matches every token and import writes CORE.md once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-core-'))
  try {
    const file = await writeTranscript(join(root, 'transcript.jsonl'), messages)
    const hits = await searchTranscript({ transcriptPath: file, query: '短邮件', limit: 5, maxChars: 2000 })
    assert.equal(hits.length, 1)
    assert.match(hits[0].text, /短邮件/u)
    const missed = await searchTranscript({ transcriptPath: file, query: '截止日期', limit: 5, maxChars: 2000 })
    assert.equal(missed.length, 0)

    const imported = await importThread({
      path: file,
      companionsRoot: join(root, 'companions'),
      config: DEFAULT_CONFIG,
      locale: 'zh',
      name: '论文',
    })
    const corePath = join(root, 'companions', imported.slug, 'CORE.md')
    const first = await readFile(corePath, 'utf8')
    assert.match(first, /硬约定/u)
    const again = await importThread({
      path: file,
      companionsRoot: join(root, 'companions'),
      config: DEFAULT_CONFIG,
      locale: 'zh',
      name: '论文',
    })
    assert.equal(again.unchanged, true)
    assert.equal(await readFile(corePath, 'utf8'), first)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
