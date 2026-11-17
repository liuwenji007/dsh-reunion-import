/** Tests for inspect, import, merging, and idempotency. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../lib/config.mjs'
import { collectGenericStream } from '../lib/generic.mjs'
import { importIntoCompanion, importSeparate, importThread } from '../lib/import.mjs'
import { openSource } from '../lib/source.mjs'
import { inspectSource } from '../lib/probe.mjs'
import { readTranscript } from '../lib/transcript.mjs'
import {
  assistantMessage, buildExportZip, conversation, sampleConversation, userMessage, writeExportDirectory,
} from './fixtures.mjs'

const config = resolveConfig({}).config

/** Create a temp root with an export. */
async function tempRoot() {
  return mkdtemp(join(tmpdir(), 'reunion-test-'))
}

/** Two conversations with disjoint periods, for merge tests. */
function secondConversation(id = 'c2') {
  return conversation({
    id,
    title: '第二个线程',
    currentMessageId: 4,
    messages: [
      userMessage({ id: 1, parentId: null, time: '2025-01-04T09:00:00.000Z', text: '新年第一天上班，好困。' }),
      assistantMessage({ id: 2, parentId: 1, time: '2025-01-04T09:01:00.000Z', text: '新年快乐呀，困就早点睡，别熬夜。' }),
      userMessage({ id: 3, parentId: 2, time: '2025-01-05T22:00:00.000Z', text: '我把团子的照片设成壁纸了。' }),
      assistantMessage({ id: 4, parentId: 3, time: '2025-01-05T22:01:00.000Z', text: '那它天天陪你上班，挺好嘛。' }),
    ],
  })
}

test('inspect reports a DeepSeek export with branch evidence and previews', async () => {
  const root = await tempRoot()
  try {
    const zip = buildExportZip({ conversations: [sampleConversation()] })
    const file = join(root, 'export.zip')
    await writeFile(file, zip)
    const report = await inspectSource({ path: file, config })
    assert.equal(report.format.id, 'deepseek-chat-export')
    assert.equal(report.kind, 'zip')
    assert.match(report.sha256, /^[0-9a-f]{64}$/)
    assert.equal(report.totals.sessions, 1)
    assert.equal(report.totals.messages, 8)
    assert.equal(report.sessions[0].alternateMessages, 1)
    assert.equal(report.previews.first.length, 2)
    assert.equal(report.previews.last.length, 2)
    assert.ok(report.fragmentTypes.some(item => item.type === 'THINK'))
    assert.ok(report.fields.some(field => field.name === 'parent_id'))
    assert.deepEqual(report.diagnostics.filter(item => item.level === 'error'), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('inspect writes nothing', async () => {
  const root = await tempRoot()
  try {
    const directory = await writeExportDirectory(join(root, 'export'), { conversations: [sampleConversation()] })
    const before = await readFile(join(directory, 'chat_sessions', 'c1.json'))
    const report = await inspectSource({ path: directory, config })
    assert.equal(report.format.id, 'deepseek-chat-export')
    const after = await readFile(join(directory, 'chat_sessions', 'c1.json'))
    assert.deepEqual(after, before)
    assert.deepEqual(report.diagnostics.filter(item => item.level === 'error'), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('import writes the four files, meta fields, and a continuous transcript', async () => {
  const root = await tempRoot()
  try {
    const zip = buildExportZip({ conversations: [sampleConversation()] })
    const file = join(root, 'export.zip')
    await writeFile(file, zip)
    const result = await importIntoCompanion({
      path: file,
      displayName: '小满',
      companionsRoot: join(root, 'companions'),
      config,
      locale: 'zh',
    })
    assert.equal(result.unchanged, false)
    const dir = join(root, 'companions', result.slug)
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
    const transcript = await readTranscript(join(dir, 'transcript.jsonl'))
    assert.equal(transcript.length, 8)
    assert.deepEqual(transcript.map(entry => entry.turn), [1, 2, 3, 4, 5, 6, 7, 8])
    assert.equal(meta.slug, result.slug)
    assert.equal(meta.displayName, '小满')
    assert.equal(meta.messages, 8)
    assert.equal(meta.sources.length, 1)
    assert.match(meta.sources[0].sha256, /^[0-9a-f]{64}$/)
    assert.equal(meta.sources[0].sessions.length, 1)
    assert.equal(meta.sources[0].sessions[0].messages, 8)
    assert.equal(meta.transcript.lines, 8)
    assert.match(meta.transcript.sha256, /^[0-9a-f]{64}$/)
    assert.equal(meta.timeRange.from, Date.parse('2024-03-02T10:00:00.000Z'))
    assert.equal(meta.timeRange.to, Date.parse('2024-09-03T19:01:00.000Z'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('re-importing the same file changes nothing', async () => {
  const root = await tempRoot()
  try {
    const file = join(root, 'export.zip')
    await writeFile(file, buildExportZip({ conversations: [sampleConversation()] }))
    const first = await importIntoCompanion({
      path: file, displayName: '小满', companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    const transcriptPath = join(root, 'companions', first.slug, 'transcript.jsonl')
    const before = await readFile(transcriptPath, 'utf8')
    const second = await importIntoCompanion({
      path: file, displayName: '小满', companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    assert.equal(second.unchanged, true)
    assert.equal(await readFile(transcriptPath, 'utf8'), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('multiple conversations merge into one timeline without duplicates', async () => {
  const root = await tempRoot()
  try {
    const file = join(root, 'export.zip')
    const conversations = [sampleConversation(), secondConversation()]
    await writeFile(file, buildExportZip({ conversations }))
    const result = await importIntoCompanion({
      path: file,
      displayName: '小满',
      sessions: ['c2', 'c1'],
      companionsRoot: join(root, 'companions'),
      config,
      locale: 'zh',
    })
    assert.equal(result.sessions, 2)
    assert.equal(result.messages, 12)
    const transcript = await readTranscript(join(root, 'companions', result.slug, 'transcript.jsonl'))
    const times = transcript.map(entry => entry.ts)
    assert.deepEqual([...times].sort((left, right) => left - right), times)
    assert.equal(new Set(transcript.map(entry => `${entry.role}:${entry.content}`)).size, transcript.length)
    const meta = JSON.parse(await readFile(join(root, 'companions', result.slug, 'meta.json'), 'utf8'))
    assert.equal(meta.sources[0].sessions.length, 2)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a later export of the same conversations adds only new messages', async () => {
  const root = await tempRoot()
  try {
    const firstDir = await writeExportDirectory(join(root, 'export-1'), { conversations: [sampleConversation()] })
    const first = await importIntoCompanion({
      path: firstDir, displayName: '小满', companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    assert.equal(first.messages, 8)
    const secondFile = join(root, 'export-2.zip')
    await writeFile(secondFile, buildExportZip({ conversations: [sampleConversation(), secondConversation()] }))
    const second = await importIntoCompanion({
      path: secondFile, displayName: '小满', all: true, companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    assert.equal(second.unchanged, false)
    assert.equal(second.added, 4)
    assert.equal(second.messages, 12)
    assert.equal(second.duplicates >= 8, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('merging every conversation requires an explicit choice', async () => {
  const root = await tempRoot()
  try {
    const file = join(root, 'export.zip')
    await writeFile(file, buildExportZip({ conversations: [sampleConversation(), secondConversation()] }))
    await assert.rejects(
      importIntoCompanion({ path: file, displayName: '小满', companionsRoot: join(root, 'companions'), config, locale: 'zh' }),
      /holds 2 conversations.*all: true/su,
    )
    const merged = await importIntoCompanion({
      path: file, displayName: '小满', sessions: ['c1', 'c2'], companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    const meta = JSON.parse(await readFile(join(root, 'companions', merged.slug, 'meta.json'), 'utf8'))
    const [first, second] = meta.sources[0].sessions
    assert.deepEqual([first.turnFrom, first.turnTo], [1, 8])
    assert.deepEqual([second.turnFrom, second.turnTo], [9, 12])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('separate mode restores one persona per conversation thread', async () => {
  const root = await tempRoot()
  try {
    const file = join(root, 'export.zip')
    await writeFile(file, buildExportZip({ conversations: [sampleConversation(), secondConversation()] }))
    const result = await importSeparate({
      path: file, companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    assert.equal(result.separate, true)
    assert.equal(result.personas.length, 2)
    assert.deepEqual(result.personas.map(item => item.displayName), ['和小满的日常', '第二个线程'])
    assert.deepEqual(result.personas.map(item => item.messages), [8, 4])
    const first = JSON.parse(await readFile(join(root, 'companions', result.personas[0].slug, 'meta.json'), 'utf8'))
    assert.equal(first.sources[0].sessions.length, 1)
    assert.deepEqual([first.sources[0].sessions[0].turnFrom, first.sources[0].sessions[0].turnTo], [1, 8])

    const again = await importSeparate({
      path: file, companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    assert.equal(again.personas.every(item => item.unchanged === true), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('separate mode disambiguates identical conversation titles', async () => {
  const root = await tempRoot()
  try {
    const first = sampleConversation('c1')
    const second = secondConversation('c2')
    first.title = '同一线程'
    second.title = '同一线程'
    const file = join(root, 'export.zip')
    await writeFile(file, buildExportZip({ conversations: [first, second] }))
    const result = await importSeparate({
      path: file, companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    assert.equal(new Set(result.personas.map(item => item.slug)).size, 2)
    assert.deepEqual(result.personas.map(item => item.slug), ['同一线程', '同一线程-1'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('thread import writes a continuation brief and no persona', async () => {
  const root = await tempRoot()
  try {
    const file = join(root, 'export.zip')
    await writeFile(file, buildExportZip({ conversations: [sampleConversation(), secondConversation()] }))
    const result = await importThread({
      path: file,
      sessions: ['c1'],
      name: '和小满的日常',
      companionsRoot: join(root, 'companions'),
      config,
      locale: 'zh',
    })
    assert.equal(result.kind, 'thread')
    assert.equal(result.messages, 8)
    assert.ok(result.briefChars > 0)
    const dir = join(root, 'companions', result.slug)
    const meta = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf8'))
    assert.equal(meta.kind, 'thread')
    assert.equal(meta.brief.chars > 0, true)
    const brief = await readFile(join(dir, 'THREAD.md'), 'utf8')
    assert.match(brief, /对话线程/u)
    assert.match(brief, /和小满的日常/u)
    await assert.rejects(readFile(join(dir, 'SOUL.md'), 'utf8'))
    await assert.rejects(readFile(join(dir, 'MEMORY.md'), 'utf8'))

    const again = await importThread({
      path: file, sessions: ['c1'], companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    assert.equal(again.unchanged, true)

    await assert.rejects(
      importThread({ path: file, sessions: ['c1', 'c2'], companionsRoot: join(root, 'companions'), config, locale: 'zh' }),
      /接着聊一次只能选一个|exactly one/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a thread cannot take over an existing persona slug', async () => {
  const root = await tempRoot()
  try {
    const file = join(root, 'export.zip')
    await writeFile(file, buildExportZip({ conversations: [sampleConversation()] }))
    await importIntoCompanion({
      path: file, displayName: '小满', companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    await assert.rejects(
      importThread({ path: file, sessions: ['c1'], name: '小满', companionsRoot: join(root, 'companions'), config, locale: 'zh' }),
      /already used by a persona/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('merge mode refuses to overwrite an existing thread slug', async () => {
  const root = await tempRoot()
  try {
    const first = join(root, 'first.zip')
    const second = join(root, 'second.zip')
    await writeFile(first, buildExportZip({ conversations: [sampleConversation('c1')] }))
    await writeFile(second, buildExportZip({ conversations: [secondConversation('c2')] }))
    await importThread({
      path: first,
      sessions: ['c1'],
      name: '碰撞',
      slug: 'pengzhuang',
      companionsRoot: join(root, 'companions'),
      config,
      locale: 'zh',
    })
    const briefBefore = await readFile(join(root, 'companions', 'pengzhuang', 'THREAD.md'), 'utf8')
    await assert.rejects(
      importIntoCompanion({
        path: second,
        displayName: '碰撞',
        slug: 'pengzhuang',
        sessions: ['c2'],
        companionsRoot: join(root, 'companions'),
        config,
        locale: 'zh',
      }),
      /already used by a thread/u,
    )
    const meta = JSON.parse(await readFile(join(root, 'companions', 'pengzhuang', 'meta.json'), 'utf8'))
    assert.equal(meta.kind, 'thread')
    assert.equal(await readFile(join(root, 'companions', 'pengzhuang', 'THREAD.md'), 'utf8'), briefBefore)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('separate mode skips thread slugs instead of reporting them as unchanged personas', async () => {
  const root = await tempRoot()
  try {
    const file = join(root, 'export.zip')
    const conv = conversation({
      id: 'c77',
      title: '独立线程甲',
      currentMessageId: 2,
      messages: [
        userMessage({ id: 1, parentId: null, time: '2025-02-01T00:00:00.000Z', text: '甲内容' }),
        assistantMessage({ id: 2, parentId: 1, time: '2025-02-01T00:00:01.000Z', text: '甲回应' }),
      ],
    })
    await writeFile(file, buildExportZip({ conversations: [conv] }))
    const thread = await importThread({
      path: file,
      sessions: ['c77'],
      name: '独立线程甲',
      companionsRoot: join(root, 'companions'),
      config,
      locale: 'zh',
    })
    const result = await importSeparate({
      path: file,
      sessions: ['c77'],
      companionsRoot: join(root, 'companions'),
      config,
      locale: 'zh',
    })
    assert.equal(result.personas.length, 1)
    assert.equal(result.personas[0].unchanged, false)
    assert.notEqual(result.personas[0].slug, thread.slug)
    const threadMeta = JSON.parse(await readFile(join(root, 'companions', thread.slug, 'meta.json'), 'utf8'))
    assert.equal(threadMeta.kind, 'thread')
    const personaMeta = JSON.parse(await readFile(join(root, 'companions', result.personas[0].slug, 'meta.json'), 'utf8'))
    assert.notEqual(personaMeta.kind, 'thread')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a single conversation JSON file imports directly', async () => {
  const root = await tempRoot()
  try {
    const file = join(root, 'conversation.json')
    await writeFile(file, JSON.stringify(sampleConversation()))
    const result = await importIntoCompanion({
      path: file, displayName: '小满', companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    assert.equal(result.messages, 8)
    assert.equal(result.sources[0].kind, 'deepseek-conversation')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('JSON Lines with role and content imports through the generic fallback', async () => {
  const root = await tempRoot()
  try {
    const file = join(root, 'messages.jsonl')
    const lines = [
      { role: 'user', content: '今天加班到十点。', time: '2024-03-02T10:00:00.000Z' },
      { role: 'assistant', content: '宝，又加班呀，先喝口水。', time: '2024-03-02T10:01:00.000Z' },
      { role: 'user', content: '我养的猫叫团子。', time: '2024-03-03T10:00:00.000Z' },
      { role: 'assistant', content: '团子今天乖不乖呀？', time: '2024-03-03T10:01:00.000Z' },
    ]
    await writeFile(file, lines.map(line => JSON.stringify(line)).join('\n'))
    const report = await inspectSource({ path: file, config })
    assert.equal(report.format.id, 'generic')
    assert.equal(report.totals.messages, 4)
    const result = await importIntoCompanion({
      path: file, displayName: '小满', companionsRoot: join(root, 'companions'), config, locale: 'zh',
    })
    assert.equal(result.messages, 4)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the streaming generic collector finds message arrays', async () => {
  const root = await tempRoot()
  try {
    const file = join(root, 'export.json')
    const document = {
      sessions: [
        { title: 'one', messages: [
          { role: 'user', content: '你好', time: '2024-01-01T00:00:00.000Z' },
          { role: 'assistant', content: '在呢', time: '2024-01-01T00:00:01.000Z' },
        ] },
        { title: 'two', messages: [
          { role: 'user', content: '再见', time: '2024-02-01T00:00:00.000Z' },
        ] },
      ],
    }
    await writeFile(file, JSON.stringify(document))
    const source = await openSource(file, config)
    try {
      const collected = await collectGenericStream(source, { maxMessages: 100, maxSessions: 10 })
      assert.equal(collected.sessions.length, 2)
      assert.equal(collected.sessions.reduce((sum, session) => sum + session.messages.length, 0), 3)
    } finally {
      await source.close()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an unrecognized structure yields diagnostics instead of throwing', async () => {
  const root = await tempRoot()
  try {
    const file = join(root, 'weird.json')
    await writeFile(file, JSON.stringify({ hello: 'world', list: [1, 2, 3] }))
    const report = await inspectSource({ path: file, config })
    assert.equal(report.totals.messages, 0)
    assert.ok(report.diagnostics.some(item => item.code === 'source.no-messages'))
    const text = join(root, 'notes.txt')
    await writeFile(text, 'this is not an export')
    const textReport = await inspectSource({ path: text, config })
    assert.equal(textReport.format.id, 'unknown')
    assert.equal(textReport.diagnostics[0].code, 'source.not-json')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
