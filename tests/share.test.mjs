/** Tests for DeepSeek public share-link parsing and normalization. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../lib/config.mjs'
import { importThread } from '../lib/import.mjs'
import { inspectSource } from '../lib/probe.mjs'
import {
  extractShareId,
  isShareRef,
  normalizeShareConversation,
  loadDeepseekShare,
} from '../lib/share.mjs'

const config = resolveConfig({}).config

test('extractShareId accepts share URLs and bare ids', () => {
  assert.equal(extractShareId('https://chat.deepseek.com/share/abc_12-XY'), 'abc_12-XY')
  assert.equal(extractShareId('http://chat.deepseek.com/share/abc_12-XY?x=1'), 'abc_12-XY')
  assert.equal(extractShareId('chat.deepseek.com/share/abc_12-XY'), 'abc_12-XY')
  assert.equal(extractShareId('abc_12-XY'), 'abc_12-XY')
  assert.equal(isShareRef('https://chat.deepseek.com/share/abc_12-XY'), true)
  assert.equal(isShareRef('/tmp/export.zip'), false)
  assert.equal(isShareRef('companions/xiaoman'), false)
  assert.throws(() => extractShareId('https://example.com/share/abc'), /not a DeepSeek share/u)
})

test('normalizeShareConversation maps public share payloads into transcript messages', () => {
  const session = normalizeShareConversation({
    shareId: 'demo123',
    biz: {
      title: '加班吐槽',
      messages: [
        { role: 'USER', content: '今天加班到十点', inserted_at: '2025-01-01T10:00:00.000Z' },
        {
          role: 'ASSISTANT',
          content: '先喝口水',
          thinking_content: 'should be ignored',
          inserted_at: '2025-01-01T10:00:01.000Z',
        },
        { role: 'USER', content: '', message: '还好吗' },
        { role: 'ASSISTANT', content: '   ' },
      ],
    },
  })
  assert.equal(session.id, 'share-demo123')
  assert.equal(session.title, '加班吐槽')
  assert.deepEqual(session.messages.map(item => item.role), ['user', 'assistant', 'user'])
  assert.equal(session.messages[0].content, '今天加班到十点')
  assert.equal(session.messages[1].content, '先喝口水')
  assert.equal(session.messages[2].content, '还好吗')
  assert.equal(typeof session.messages[0].ts, 'number')
})

test('loadDeepseekShare fetches the public share API through the injected fetch', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), signal: init?.signal })
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: 0,
          data: {
            biz_code: 0,
            biz_data: {
              title: '分享会话',
              messages: [
                { role: 'user', content: '你好' },
                { role: 'assistant', content: '嗨' },
              ],
            },
          },
        }
      },
    }
  }
  const loaded = await loadDeepseekShare('https://chat.deepseek.com/share/demo123', { fetch: fetchImpl })
  assert.match(calls[0].url, /share_id=demo123/u)
  assert.equal(loaded.shareId, 'demo123')
  assert.equal(loaded.session.title, '分享会话')
  assert.equal(loaded.session.messages.length, 2)
  assert.match(loaded.sha256, /^[0-9a-f]{64}$/u)
  assert.equal(loaded.formatId, 'deepseek-share')
})

test('loadDeepseekShare rejects deleted or empty shares', async () => {
  await assert.rejects(
    loadDeepseekShare('gone01', {
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { code: 0, data: { biz_code: 3, biz_msg: 'original session deleted', biz_data: null } }
        },
      }),
    }),
    /original session deleted|share unavailable/u,
  )
  await assert.rejects(
    loadDeepseekShare('empty1', {
      fetch: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { code: 0, data: { biz_code: 0, biz_data: { title: '空', messages: [] } } }
        },
      }),
    }),
    /no usable messages/u,
  )
})

test('inspect and thread import accept a DeepSeek share link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-share-'))
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        code: 0,
        data: {
          biz_code: 0,
          biz_data: {
            title: '论文选题',
            messages: [
              { role: 'USER', content: '选题方向？', inserted_at: '2025-03-01T00:00:00.000Z' },
              { role: 'ASSISTANT', content: '先缩小范围。', inserted_at: '2025-03-01T00:00:01.000Z' },
            ],
          },
        },
      }
    },
  })
  try {
    const report = await inspectSource({
      path: 'https://chat.deepseek.com/share/thread1',
      config,
      fetch: fetchImpl,
    })
    assert.equal(report.format.id, 'deepseek-share')
    assert.equal(report.sessions.length, 1)
    assert.equal(report.sessions[0].id, 'share-thread1')
    assert.equal(report.previews.first[0].text, '选题方向？')

    const result = await importThread({
      path: 'https://chat.deepseek.com/share/thread1',
      companionsRoot: join(root, 'companions'),
      config,
      locale: 'zh',
      fetch: fetchImpl,
    })
    assert.equal(result.kind, 'thread')
    assert.equal(result.unchanged, false)
    assert.equal(result.messages, 2)
    assert.equal(result.displayName, '论文选题')

    const again = await importThread({
      path: 'https://chat.deepseek.com/share/thread1',
      companionsRoot: join(root, 'companions'),
      config,
      locale: 'zh',
      fetch: fetchImpl,
    })
    assert.equal(again.unchanged, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
