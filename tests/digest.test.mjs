/** Tests for the deterministic distillation digest. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../lib/config.mjs'
import { buildDigest, countBudget, pickFewShots, shingles, similarity } from '../lib/digest.mjs'
import { iterateTranscript } from '../lib/transcript.mjs'
import { digestTranscript, writeTranscript } from './fixtures.mjs'

const config = resolveConfig({}).config

/** Build a digest over the fixed transcript. */
async function digestOf(root) {
  const file = await writeTranscript(join(root, 'transcript.jsonl'), digestTranscript())
  return buildDigest({ entries: iterateTranscript(file), slug: 'test', config })
}

test('digest reports the measured voice profile of a fixed transcript', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-digest-'))
  try {
    const digest = await digestOf(root)
    assert.equal(digest.messages, 10)
    assert.equal(digest.counts.user, 5)
    assert.equal(digest.counts.assistant, 5)
    assert.equal(digest.voice.endings.some(item => item.value === '呀' && item.count >= 2), true)
    assert.equal(digest.voice.addressTerms.some(item => item.term === '宝'), true)
    assert.equal(digest.voice.addressTerms.some(item => item.term === '先喝口水'), false)
    assert.equal(digest.voice.punctuation.some(item => item.value === '～'), true)
    assert.equal(digest.stats.assistant.count, 5)
    assert.ok(digest.stats.assistant.median > 0)
    assert.equal(digest.memory.disclosures.some(item => item.kind === 'pet' && item.text.includes('团子')), true)
    assert.equal(digest.memory.disclosures.some(item => item.kind === 'family' && item.text.includes('我爸')), true)
    assert.equal(digest.memory.sharedPhrases.some(item => item.phrase === '团子' && item.messages >= 2), true)
    assert.ok(digest.memory.timeline.months.length >= 3)
    assert.ok(Array.isArray(digest.lowConfidence))
    assert.match(digest.fingerprint, /^[0-9a-f]{16}$/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('every few-shot candidate occurs verbatim in the transcript', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-digest-'))
  try {
    const digest = await digestOf(root)
    assert.ok(digest.fewShots.length >= 1)
    assert.ok(digest.fewShots.length <= config.fewShotMax)
    const transcript = digestTranscript().map(entry => entry.content)
    for (const shot of digest.fewShots) {
      assert.equal(transcript.some(text => text.includes(shot.text)), true, shot.text)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('few-shot selection prefers distinct messages and respects the limit', () => {
  const texts = [
    '宝，又加班呀。先喝口水，别硬扛着～',
    '团子这是想让你陪它玩呀，扫干净就好，别凶它。',
    '我在呢。你先去医院陪着，别一个人瞎想。',
    '那就好。你也要记得吃饭呀，别光顾着照顾别人。',
    '怎么会呢，它只是不会说而已嘛。',
  ]
  const pool = texts.map((text, index) => ({
    text,
    ts: index * 30 * 24 * 3600 * 1000,
    turn: index,
    length: text.length,
    score: 1,
  }))
  const picked = pickFewShots(pool, 3)
  assert.equal(picked.length, 3)
  assert.equal(new Set(picked.map(item => item.text)).size, 3)
})

test('similarity rejects near-duplicate anchors', () => {
  const left = shingles('宝，又加班呀。先喝口水，别硬扛着～')
  const right = shingles('宝，又加班呀。先喝口水，别硬扛着～')
  assert.equal(similarity(left, right), 1)
  assert.equal(similarity(left, shingles('今天天气不错，出去走走吧。')), 0)
})

test('countBudget counts non-whitespace code points and CJK separately', () => {
  assert.equal(countBudget('你好 world'), 7)
  assert.equal(countBudget('a\nb\tc'), 3)
})
