/** Tests for result rendering and the persona document builders. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMemory, buildSoul, renderInspect, renderList, renderLoad, renderPreview } from '../lib/render.mjs'
import { resolveConfig } from '../lib/config.mjs'

const config = resolveConfig({}).config

test('SOUL.md separates its title, prose, and anchors with blank lines', () => {
  const text = buildSoul({ displayName: '小满', soul: '你是小满。', fewShots: ['第一句', '第二句'], locale: 'zh' })
  assert.equal(text, '# 小满 · SOUL\n\n你是小满。\n\n## 原句锚点（逐字来自存档）\n\n> 第一句\n> 第二句\n')
})

test('MEMORY.md appends the unconfirmed section only when needed', () => {
  const withItems = buildMemory({ memory: '# 记忆\n\n- 一', uncertain: ['可能住在南方'], locale: 'zh' })
  assert.match(withItems, /\n\n## 待确认（置信度低）\n\n- 可能住在南方\n$/u)
  const without = buildMemory({ memory: '# 记忆\n\n- 一', uncertain: [], locale: 'zh' })
  assert.equal(without, '# 记忆\n\n- 一\n')
})

test('a load result mentions the generated skill once', () => {
  const text = renderLoad({
    slug: 'xiaoman',
    displayName: '小满',
    userNickname: '宝',
    messages: 12,
    skillPath: '.dsh/skills/reunion-xiaoman/SKILL.md',
    skillName: 'reunion-xiaoman',
    opening: '我回来啦。',
    mode: 'skill',
  }, 'zh')
  assert.equal(text.split('reunion-xiaoman/SKILL.md').length - 1, 1)
  assert.match(text, /技能/u)
})

test('the inspect report is clamped and localized', () => {
  const report = {
    path: '/tmp/x.zip',
    name: 'x.zip',
    kind: 'zip',
    bytes: 1024,
    sha256: 'a'.repeat(64),
    format: { id: 'deepseek-chat-export', version: 3, layout: { entries: 3, manifest: true, index: true, conversations: ['c1'] } },
    totals: { sessions: 1, analyzed: 1, messages: 2, users: 1, assistants: 1, from: 0, to: 1 },
    fields: [{ scope: 'message', name: 'role', meaning: 'field.role' }],
    sessions: [{ id: 'c1', title: '标题', messages: 2, from: 0, to: 1, alternateMessages: 0 }],
    previews: { first: [{ role: 'user', ts: 0, text: '你好' }], last: [] },
    diagnostics: [{ level: 'warn', code: 'export.index-missing', detail: 'x' }],
    truncated: false,
  }
  const text = renderInspect(report, 'zh', 2000)
  assert.match(text, /结构探测/u)
  assert.match(text, /会话 1/u)
  assert.match(text, /父消息|角色/u)
  assert.match(text, /缺少 chat_session_index/u)
  const clamped = renderInspect(report, 'en', 100)
  assert.ok(clamped.length <= 100)
})

test('list renders imported-but-uncommitted personas instead of marking them broken', () => {
  const text = renderList([
    {
      slug: 'jindao',
      dir: '/tmp/companions/jindao',
      kind: 'incomplete',
      complete: false,
      meta: {
        displayName: '仅导入',
        userNickname: '',
        messages: 8,
        timeRange: { from: 0, to: 1 },
      },
    },
    {
      slug: 'broken',
      dir: '/tmp/companions/broken',
      kind: 'incomplete',
      complete: false,
      meta: null,
    },
  ], 'zh')
  assert.match(text, /仅导入/u)
  assert.doesNotMatch(text, /jindao — 目录不完整/u)
  assert.match(text, /broken — 目录不完整/u)
})

test('a preview lists errors instead of a draft id', () => {
  const text = renderPreview({
    slug: 'xiaoman',
    draft: {
      displayName: '小满',
      soul: '你是小满。',
      memory: '# 记忆\n- 一',
      samples: ['一', '二', '三'],
    },
    validation: {
      errors: [{ code: 'fewshot.count', detail: '3/5-10' }],
      warnings: [{ code: 'memory.hedge' }],
      stats: { memoryChars: 5, memoryLimit: 8000, memoryCjk: 2, soulChars: 4, fewShots: 3, samples: 3 },
    },
    draftId: undefined,
    ttlMinutes: 60,
  }, 'zh')
  assert.match(text, /未通过/u)
  assert.match(text, /原句锚点数量/u)
  assert.doesNotMatch(text, /草稿 id/u)
})
