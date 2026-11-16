/** Tests for the DeepSeek export reader: branch selection, fragments, damage. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  analyzeConversation, exportLayout, parseConversation, selectChain,
} from '../lib/deepseek.mjs'
import { assistantMessage, conversation, sampleConversation, userMessage } from './fixtures.mjs'

test('exportLayout recognizes manifest, index, and conversation entries', () => {
  const layout = exportLayout([
    'manifest.json',
    'chat_session_index.json',
    'chat_sessions/a.json',
    'chat_sessions/a_files/x.png',
    'chat_sessions/b.json',
  ])
  assert.equal(layout.manifest, true)
  assert.equal(layout.index, true)
  assert.deepEqual(layout.conversations, ['a', 'b'])
})

test('parseConversation reports unknown fields and fragment types without throwing', () => {
  const raw = conversation({
    id: 'c1',
    title: 't',
    currentMessageId: 1,
    messages: [
      userMessage({ id: 1, parentId: null, time: '2024-01-01T00:00:00.000Z', text: 'hi' }),
      { ...assistantMessage({ id: 2, parentId: 1, time: '2024-01-01T00:00:02.000Z', text: 'hello' }), new_field: 7 },
    ],
  })
  raw.messages[1].fragments.push({ type: 'FUTURE_THING', payload: {} })
  raw.something_new = true
  const parsed = parseConversation(JSON.stringify(raw), 'c1')
  assert.equal(parsed.file.messages.length, 2)
  assert.deepEqual(parsed.file.unknownKeys, ['something_new'])
  const codes = parsed.diagnostics.map(item => item.code)
  assert.ok(codes.includes('export.conversation-fields'))
  assert.ok(codes.includes('export.message-fields'))
  assert.ok(codes.includes('export.fragment-types'))
})

test('selectChain follows current_message_id and ignores the alternate branch', () => {
  const parsed = parseConversation(JSON.stringify(sampleConversation()), 'c1')
  const chain = selectChain(parsed.file)
  assert.deepEqual(chain.chain.map(message => message.id), [1, 2, 3, 4, 6, 7, 8, 9])
  assert.equal(chain.alternates, 1)
  assert.equal(chain.fallback, false)
})

test('selectChain falls back to the greatest id when current_message_id is absent', () => {
  const raw = sampleConversation()
  delete raw.current_message_id
  const parsed = parseConversation(JSON.stringify(raw), 'c1')
  const chain = selectChain(parsed.file)
  assert.equal(chain.fallback, true)
  assert.equal(chain.selectedId, 9)
})

test('chainToMessages excludes THINK fragments and content-filtered pairs', () => {
  const raw = conversation({
    id: 'c2',
    title: null,
    currentMessageId: 4,
    messages: [
      userMessage({ id: 1, parentId: null, time: '2024-01-01T00:00:00.000Z', text: '问题一' }),
      assistantMessage({ id: 2, parentId: 1, time: '2024-01-01T00:00:02.000Z', text: '回答一' }),
      userMessage({ id: 3, parentId: 2, time: '2024-01-02T00:00:00.000Z', text: '被过滤的问题' }),
      assistantMessage({ id: 4, parentId: 3, time: '2024-01-02T00:00:02.000Z', text: '', status: 'CONTENT_FILTER' }),
    ],
  })
  const analysis = analyzeConversation('c2', parseConversation(JSON.stringify(raw), 'c2'))
  assert.equal(analysis.summary.skippedFiltered, 1)
  assert.deepEqual(analysis.transcript.messages.map(message => message.content), ['问题一', '回答一'])
  assert.equal(analysis.summary.messages, 2)
})

test('a reply that never finished keeps the user question only', () => {
  const raw = conversation({
    id: 'c3',
    title: null,
    currentMessageId: 3,
    messages: [
      userMessage({ id: 1, parentId: null, time: '2024-01-01T00:00:00.000Z', text: '在吗' }),
      assistantMessage({ id: 2, parentId: 1, time: '2024-01-01T00:00:02.000Z', text: '', status: 'TIMEOUT' }),
      userMessage({ id: 3, parentId: 2, time: '2024-01-01T00:01:00.000Z', text: '算了' }),
    ],
  })
  const analysis = analyzeConversation('c3', parseConversation(JSON.stringify(raw), 'c3'))
  assert.equal(analysis.summary.unanswered, 1)
  assert.deepEqual(analysis.transcript.messages.map(message => message.content), ['在吗', '算了'])
})

test('a missing parent truncates the branch with a diagnostic instead of throwing', () => {
  const raw = conversation({
    id: 'c4',
    title: null,
    currentMessageId: 2,
    messages: [
      userMessage({ id: 1, parentId: null, time: '2024-01-01T00:00:00.000Z', text: 'a' }),
      assistantMessage({ id: 2, parentId: 99, time: '2024-01-01T00:00:02.000Z', text: 'b' }),
    ],
  })
  const parsed = parseConversation(JSON.stringify(raw), 'c4')
  const chain = selectChain(parsed.file)
  assert.deepEqual(chain.chain.map(message => message.id), [2])
  assert.equal(chain.diagnostics.some(item => item.code === 'export.parent-missing'), true)
})

test('a damaged conversation file is a diagnostic, not an exception', () => {
  const parsed = parseConversation('{not json', 'c5')
  assert.equal(parsed.file, null)
  assert.equal(parsed.diagnostics[0].code, 'export.conversation-damaged')
})

test('a reply stamped before its question keeps conversational order', async () => {
  const { importIntoCompanion } = await import('../lib/import.mjs')
  const { monotonicTimestamps, iterateTranscript } = await import('../lib/transcript.mjs')
  const { resolveConfig } = await import('../lib/config.mjs')
  const { buildExportZip, conversation, userMessage, assistantMessage } = await import('./fixtures.mjs')
  const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  assert.deepEqual(
    monotonicTimestamps([
      { role: 'user', content: 'a', ts: 100 },
      { role: 'assistant', content: 'b', ts: 50 },
      { role: 'user', content: 'c', ts: 200 },
    ]).map(message => message.ts),
    [100, 100, 200],
  )
  const root = await mkdtemp(join(tmpdir(), 'reunion-order-'))
  try {
    const raw = conversation({
      id: 'late', title: '时间戳异常', currentMessageId: 2,
      messages: [
        userMessage({ id: 1, parentId: null, time: '2026-01-01T10:00:05.000Z', text: '问题' }),
        assistantMessage({ id: 2, parentId: 1, time: '2026-01-01T10:00:00.000Z', text: '回答' }),
      ],
    })
    const file = join(root, 'export.zip')
    await writeFile(file, buildExportZip({ conversations: [raw] }))
    const result = await importIntoCompanion({
      path: file, displayName: '异常', companionsRoot: join(root, 'companions'),
      config: resolveConfig({}).config, locale: 'zh', all: true,
    })
    const entries = []
    for await (const entry of iterateTranscript(join(root, 'companions', result.slug, 'transcript.jsonl'))) entries.push(entry)
    assert.deepEqual(entries.map(entry => entry.content), ['问题', '回答'])
    assert.deepEqual(entries.map(entry => entry.ts), [Date.parse('2026-01-01T10:00:05.000Z'), Date.parse('2026-01-01T10:00:05.000Z')])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
