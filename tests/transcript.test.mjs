/** Tests for the transcript archive merge: ordering, deduplication, limits. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprint, iterateTranscript, mergeIntoTranscript, sortMessages } from '../lib/transcript.mjs'

/** One temp dir per test. */
async function withRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'reunion-transcript-'))
  try {
    return await callback(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('fingerprints include role, time, and content', () => {
  const base = { role: 'user', content: '你好', ts: 1000 }
  assert.notEqual(fingerprint(base), fingerprint({ ...base, role: 'assistant' }))
  assert.notEqual(fingerprint(base), fingerprint({ ...base, ts: 2000 }))
  assert.notEqual(fingerprint(base), fingerprint({ ...base, content: '你好呀' }))
  assert.equal(fingerprint(base), fingerprint({ ...base }))
})

test('messages sort by timestamp and keep undated entries last', () => {
  const sorted = sortMessages([
    { role: 'user', content: 'c', ts: 300 },
    { role: 'user', content: 'none', ts: null },
    { role: 'user', content: 'a', ts: 100 },
  ])
  assert.deepEqual(sorted.map(item => item.content), ['a', 'c', 'none'])
})

test('the first merge writes ordered lines with sequential turns', async () => {
  await withRoot(async root => {
    const file = join(root, 'transcript.jsonl')
    const result = await mergeIntoTranscript({
      file,
      incoming: [
        { role: 'assistant', content: 'b', ts: 2000 },
        { role: 'user', content: 'a', ts: 1000 },
      ],
    })
    assert.equal(result.added, 2)
    assert.equal(result.total, 2)
    assert.equal(result.from, 1000)
    assert.equal(result.to, 2000)
    assert.match(result.sha256, /^[0-9a-f]{64}$/)
    const entries = []
    for await (const entry of iterateTranscript(file)) entries.push(entry)
    assert.deepEqual(entries.map(entry => [entry.content, entry.turn]), [['a', 1], ['b', 2]])
    const lines = (await readFile(file, 'utf8')).trim().split('\n')
    assert.deepEqual(Object.keys(JSON.parse(lines[0])), ['role', 'content', 'ts', 'turn'])
  })
})

test('a second merge adds only new messages and renumbers turns', async () => {
  await withRoot(async root => {
    const file = join(root, 'transcript.jsonl')
    await mergeIntoTranscript({
      file,
      incoming: [
        { role: 'user', content: 'a', ts: 1000 },
        { role: 'assistant', content: 'b', ts: 2000 },
      ],
    })
    const second = await mergeIntoTranscript({
      file,
      incoming: [
        { role: 'user', content: 'a', ts: 1000 },
        { role: 'assistant', content: 'b', ts: 2000 },
        { role: 'user', content: 'c', ts: 500 },
        { role: 'assistant', content: 'd', ts: 3000 },
      ],
    })
    assert.equal(second.added, 2)
    assert.equal(second.total, 4)
    assert.equal(second.duplicates, 2)
    const entries = []
    for await (const entry of iterateTranscript(file)) entries.push(entry)
    assert.deepEqual(entries.map(entry => entry.content), ['c', 'a', 'b', 'd'])
    assert.deepEqual(entries.map(entry => entry.turn), [1, 2, 3, 4])
  })
})

test('damaged existing lines are skipped and counted', async () => {
  await withRoot(async root => {
    const file = join(root, 'transcript.jsonl')
    await writeFile(file, '{"role":"user","content":"keep","ts":1,"turn":1}\nnot json\n')
    const result = await mergeIntoTranscript({
      file,
      incoming: [{ role: 'assistant', content: 'new', ts: 2 }],
    })
    assert.equal(result.badLines, 1)
    assert.equal(result.total, 2)
    const entries = []
    for await (const entry of iterateTranscript(file)) entries.push(entry)
    assert.deepEqual(entries.map(entry => entry.content), ['keep', 'new'])
  })
})

test('a merge above maxMessages leaves the archive untouched', async () => {
  await withRoot(async root => {
    const file = join(root, 'transcript.jsonl')
    await mergeIntoTranscript({ file, incoming: [{ role: 'user', content: 'a', ts: 1 }] })
    const before = await readFile(file, 'utf8')
    await assert.rejects(
      mergeIntoTranscript({
        file,
        maxMessages: 1,
        incoming: [{ role: 'assistant', content: 'b', ts: 2 }],
      }),
      /maxMessages/,
    )
    assert.equal(await readFile(file, 'utf8'), before)
  })
})
