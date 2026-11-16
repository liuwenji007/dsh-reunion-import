/** Tests for conversation ordering, diagnostic aggregation, and fragment coverage. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../lib/config.mjs'
import { aggregateDiagnostics, inspectSource, orderSessions } from '../lib/probe.mjs'
import { parseConversation } from '../lib/deepseek.mjs'
import {
  assistantMessage, buildExportZip, conversation, sampleConversation, userMessage,
} from './fixtures.mjs'

const config = resolveConfig({}).config

test('orderSessions sorts by messages, span, and recency and filters by text', () => {
  const sessions = [
    { id: 'a', title: '短线', messages: 5, from: 0, to: 1000 },
    { id: 'b', title: '长跨度', messages: 10, from: 0, to: 100_000 },
    { id: 'c', title: '最近活跃', messages: 3, from: 90_000, to: 95_000 },
    { id: 'd', title: '坏会话', error: 'unreadable' },
  ]
  assert.deepEqual(orderSessions(sessions, { sort: 'messages' }).map(item => item.id), ['b', 'a', 'c', 'd'])
  assert.deepEqual(orderSessions(sessions, { sort: 'span' }).map(item => item.id), ['b', 'c', 'a', 'd'])
  assert.deepEqual(orderSessions(sessions, { sort: 'recent' }).map(item => item.id), ['b', 'c', 'a', 'd'])
  assert.deepEqual(orderSessions(sessions, { query: '长' }).map(item => item.id), ['b'])
  assert.deepEqual(orderSessions(sessions, { query: 'a' }).map(item => item.id), ['a'])
})

test('aggregateDiagnostics collapses repeated codes and keeps counts', () => {
  const raw = [
    { level: 'info', code: 'x', detail: 'one' },
    { level: 'info', code: 'x', detail: 'two' },
    { level: 'warn', code: 'y', detail: 'three' },
  ]
  const grouped = aggregateDiagnostics(raw)
  assert.equal(grouped.length, 2)
  assert.equal(grouped[0].code, 'x')
  assert.equal(grouped[0].count, 2)
  assert.equal(grouped[1].count, 1)
})

test('inspect filters and orders conversations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-inspect-'))
  try {
    const big = sampleConversation('c1')
    const small = conversation({
      id: 'c2', title: '短线', currentMessageId: 2,
      messages: [
        userMessage({ id: 1, parentId: null, time: '2025-01-01T00:00:00.000Z', text: '一个问题' }),
        assistantMessage({ id: 2, parentId: 1, time: '2025-01-01T00:00:01.000Z', text: '一个回答' }),
      ],
    })
    const file = join(root, 'export.zip')
    await writeFile(file, buildExportZip({ conversations: [small, big] }))
    const report = await inspectSource({ path: file, config, sort: 'messages' })
    assert.equal(report.matches, 2)
    assert.equal(report.sessionsTotal, 2)
    assert.equal(report.sessions[0].id, 'c1')
    const filtered = await inspectSource({ path: file, config, query: '短线' })
    assert.equal(filtered.matches, 1)
    assert.equal(filtered.sessions[0].id, 'c2')
    assert.equal(filtered.previews.first[0].text, '一个问题')
    assert.equal(filtered.diagnostics.every(item => typeof item.count === 'number'), true)

    const empty = await inspectSource({ path: file, config, query: '绝对不存在的关键词XYZ' })
    assert.equal(empty.matches, 0)
    assert.deepEqual(empty.sessions, [])
    assert.deepEqual(empty.previews, { first: [], last: [] })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('CONTENT_RISK and newer export fields are recognized', () => {
  const raw = conversation({
    id: 'c1', title: 't', currentMessageId: 1,
    messages: [
      userMessage({ id: 1, parentId: null, time: '2024-01-01T00:00:00.000Z', text: 'hi' }),
    ],
  })
  raw.pinned = false
  raw.messages[0].accumulated_token_usage = 12
  raw.messages[0].fragments.push({ type: 'CONTENT_RISK', content: 'notice' })
  const parsed = parseConversation(JSON.stringify(raw), 'c1')
  const codes = parsed.diagnostics.map(item => item.code)
  assert.equal(codes.includes('export.fragment-types'), false)
  assert.equal(codes.includes('export.conversation-fields'), false)
  assert.equal(codes.includes('export.message-fields'), false)
})
