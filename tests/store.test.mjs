/** Tests for persona storage: directories, skills, listing, deletion, slugs. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { companionPath, isSlug, slugify } from '../lib/slug.mjs'
import {
  deleteCompanion, deleteSkill, listCompanions, readCompanion, skillName, writePersona, writeSkill,
} from '../lib/store.mjs'

/** One temp dir per test. */
async function withRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'reunion-store-'))
  try {
    return await callback(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** A minimal persona record. */
function persona(slug = 'xiaoman') {
  return {
    soul: '# 小满 · SOUL\n',
    memory: '# 小满 × 用户\n',
    meta: { schema: 1, slug, displayName: '小满', messages: 2, transcript: { sha256: 'abc' } },
  }
}

test('slugs allow unicode names and reject path tricks', () => {
  assert.equal(isSlug('小满'), true)
  assert.equal(isSlug('xiaoman'), true)
  assert.equal(isSlug('a_b.c-d'), true)
  assert.equal(isSlug('../x'), false)
  assert.equal(isSlug('a/b'), false)
  assert.equal(isSlug('.hidden'), false)
  assert.equal(isSlug('CON'), false)
  assert.equal(isSlug('x'.repeat(49)), false)
  assert.equal(slugify('小满'), '小满')
  assert.equal(slugify('Xiao Man!'), 'xiao-man')
  assert.match(slugify('!!!'), /^companion-[0-9a-f]{8}$/)
  assert.throws(() => companionPath('/tmp/companions', '../x'))
})

test('personas write, read, list, and delete completely', async () => {
  await withRoot(async root => {
    const companions = join(root, 'companions')
    const written = await writePersona(companions, 'xiaoman', persona())
    const read = await readCompanion(companions, 'xiaoman')
    assert.equal(read.soul, '# 小满 · SOUL\n')
    assert.equal(read.memory, '# 小满 × 用户\n')
    assert.equal(read.meta.displayName, '小满')
    const listed = await listCompanions(companions)
    assert.equal(listed.length, 1)
    assert.equal(listed[0].slug, 'xiaoman')
    assert.equal(listed[0].complete, false)
    const removed = await deleteCompanion(companions, 'xiaoman')
    assert.equal(removed.files, 3)
    await assert.rejects(stat(written.dir))
    assert.deepEqual(await listCompanions(companions), [])
  })
})

test('a missing persona reads as null and cannot be deleted twice', async () => {
  await withRoot(async root => {
    assert.equal(await readCompanion(join(root, 'companions'), 'nobody'), null)
    await assert.rejects(deleteCompanion(join(root, 'companions'), 'nobody'))
  })
})

test('a generated skill is ASCII-named even for a unicode slug', async () => {
  await withRoot(async root => {
    assert.equal(skillName('小满'), skillName('小满'))
    assert.match(skillName('小满'), /^reunion-persona-[0-9a-f]{8}$/)
    assert.equal(skillName('xiaoman'), 'reunion-xiaoman')
    const skills = join(root, 'skills')
    const file = await writeSkill(skills, '小满', {
      soul: '# 小满 · SOUL\n\n## 原句锚点\n> 宝，又加班呀。\n',
      memory: '# 记忆\n',
      displayName: '小满',
      locale: 'zh',
    })
    const text = await readFile(file, 'utf8')
    assert.match(text, /^---\nname: reunion-persona-[0-9a-f]{8}\n/u)
    assert.match(text, /原句锚点/u)
    assert.equal(await deleteSkill(skills, '小满'), join(skills, skillName('小满')))
    assert.equal(await deleteSkill(skills, '小满'), null)
  })
})

test('listCompanions tolerates an absent root and ignores stray entries', async () => {
  await withRoot(async root => {
    assert.deepEqual(await listCompanions(join(root, 'does-not-exist')), [])
    await writePersona(join(root, 'companions'), 'good', persona('good'))
    await writePersona(join(root, 'companions'), '小满', persona('小满'))
    const listed = await listCompanions(join(root, 'companions'))
    assert.deepEqual(listed.map(item => item.slug), ['good', '小满'])
  })
})
