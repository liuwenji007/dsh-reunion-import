/** The shipped demo export must stay valid, because the README uses it. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from '../lib/config.mjs'
import { importThread } from '../lib/import.mjs'
import { inspectSource } from '../lib/probe.mjs'

const config = resolveConfig({}).config
const demo = fileURLToPath(new URL('../examples/demo-export', import.meta.url))

test('the fictional demo export is inspectable and documented', async () => {
  const report = await inspectSource({ path: demo, config })
  assert.equal(report.format.id, 'deepseek-chat-export')
  assert.equal(report.sessionsTotal, 2)
  assert.equal(report.totals.messages, 18)
  const thread = report.sessions.find(session => session.id === 'demo-thread')
  assert.equal(thread.messages, 10)
  assert.equal(thread.title, '论文选题讨论')
})

test('the demo thread imports as a continuation brief', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-demo-'))
  try {
    const result = await importThread({
      path: demo,
      sessions: ['demo-thread'],
      name: '论文选题',
      companionsRoot: join(root, 'companions'),
      config,
      locale: 'zh',
    })
    assert.equal(result.kind, 'thread')
    const brief = await readFile(join(root, 'companions', result.slug, 'THREAD.md'), 'utf8')
    assert.match(brief, /论文选题/u)
    assert.match(brief, /导师/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
