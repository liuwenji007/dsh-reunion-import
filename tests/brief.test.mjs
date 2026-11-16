/** Tests for the deterministic thread brief and thread import/load path. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { buildThreadBrief, buildThreadBriefFromTranscript } from '../lib/brief.mjs'
import { writeTranscript } from './fixtures.mjs'

/** One temp dir per test. */
async function withRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'reunion-brief-'))
  try {
    return await callback(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** A fictional problem-solving thread. */
function threadMessages() {
  return [
    { role: 'user', content: '我在准备硕士论文开题，导师建议我换方向，我要不要争取原题？', ts: Date.parse('2025-10-08T10:00:00Z') },
    { role: 'assistant', content: '先说结论：先判断换方向是资源问题还是判断问题。建议把导师的顾虑写成两条，再决定谈什么。下一步是约他确认。', ts: Date.parse('2025-10-08T10:01:00Z') },
    { role: 'user', content: '导师不想单独见我怎么办？', ts: Date.parse('2025-10-09T09:00:00Z') },
    { role: 'assistant', content: '那就先走书面。可以先发一封很短的邮件，只问两个事实问题，不辩解。计划是周三前发出去。', ts: Date.parse('2025-10-09T09:01:00Z') },
    { role: 'user', content: '如果他还是不回呢？', ts: Date.parse('2025-10-10T09:00:00Z') },
  ]
}

test('the brief records the topic, decisions, open questions, and recent turns', () => {
  const brief = buildThreadBrief({
    title: '论文开题',
    locale: 'zh',
    messages: threadMessages(),
  })
  assert.match(brief.text, /^# 论文开题 · 对话线程/u)
  assert.match(brief.text, /这段对话在解决什么/u)
  assert.match(brief.text, /起点: 我在准备硕士论文开题/u)
  assert.match(brief.text, /已经明确的事 \/ 下一步/u)
  assert.match(brief.text, /先判断换方向是资源问题还是判断问题/u)
  assert.match(brief.text, /还没解决的问题/u)
  assert.match(brief.text, /导师不想单独见我怎么办/u)
  assert.match(brief.text, /最近对话（逐字）/u)
  assert.match(brief.text, /用户: 如果他还是不回呢/u)
  assert.equal(brief.stats.messages, 5)
  assert.equal(brief.stats.users, 3)
  assert.equal(brief.stats.decisions >= 1, true)
  assert.equal(brief.stats.open >= 1, true)
  assert.equal(brief.stats.recent, 5)
})

test('the brief stays inside its character budget', () => {
  const long = Array.from({ length: 40 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `这是第 ${index + 1} 轮的问题与回答，用来把摘要撑长。`.repeat(6),
    ts: 1_700_000_000_000 + index * 1000,
  }))
  const brief = buildThreadBrief({ title: '长线程', locale: 'zh', maxChars: 1500, messages: long })
  assert.ok(brief.text.length <= 1500, `${brief.text.length}`)
  assert.equal(brief.stats.truncated, true)
  assert.ok(brief.stats.recent < 12)
})

test('the brief can be built from a transcript file', async () => {
  await withRoot(async root => {
    const file = await writeTranscript(join(root, 'transcript.jsonl'), threadMessages())
    const brief = await buildThreadBriefFromTranscript({ transcriptPath: file, title: '论文开题', locale: 'zh', maxChars: 4000 })
    assert.match(brief.text, /论文开题/u)
    assert.match(brief.text, /导师不想单独见我怎么办/u)
  })
})

test('English labels are available', () => {
  const brief = buildThreadBrief({ title: 'Thesis topic', locale: 'en', messages: threadMessages() })
  assert.match(brief.text, /What this thread is about/u)
  assert.match(brief.text, /Recent turns \(verbatim\)/u)
})
