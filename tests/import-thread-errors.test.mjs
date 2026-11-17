/** Multi-session ZIP must ask for one session before thread/continue. */
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { DEFAULT_CONFIG } from '../lib/config.mjs'
import { importThread } from '../lib/import.mjs'

const demo = join(import.meta.dirname, '..', 'examples', 'demo-export')

test('importThread rejects multi-session export without session id (zh)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-multi-'))
  try {
    await assert.rejects(
      importThread({
        path: demo,
        companionsRoot: join(root, 'companions'),
        config: DEFAULT_CONFIG,
        locale: 'zh',
      }),
      error => {
        assert.match(String(error.message), /个会话|接着聊一次只能选一个|reunion_continue/u)
        assert.match(String(error.message), /demo-thread|demo-companion/u)
        return true
      },
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('importThread rejects multi-session export without session id (en)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-multi-en-'))
  try {
    await assert.rejects(
      importThread({
        path: demo,
        companionsRoot: join(root, 'companions'),
        config: DEFAULT_CONFIG,
        locale: 'en',
      }),
      /exactly one|reunion_continue|demo-thread|demo-companion/u,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
