/** Lock XHS/ordinary-user quickstart copy so the golden path stays discoverable. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'

const root = join(import.meta.dirname, '..')

test('QUICKSTART.zh.md documents share-first continue and zip fallback', async () => {
  const text = await readFile(join(root, 'docs', 'QUICKSTART.zh.md'), 'utf8')
  assert.match(text, /用重逢接着聊/u)
  assert.match(text, /chat\.deepseek\.com\/share/u)
  assert.match(text, /reunion_continue/u)
  assert.match(text, /export\.zip|导出 zip|导出/u)
  assert.match(text, /examples\/demo-export/u)
})

test('locale meta highlights one-shot continue', async () => {
  const zh = JSON.parse(await readFile(join(root, 'locale', 'zh.json'), 'utf8'))
  const en = JSON.parse(await readFile(join(root, 'locale', 'en.json'), 'utf8'))
  assert.match(zh.meta.title, /接着聊|一句话/u)
  assert.match(zh.meta.description, /reunion_continue|分享/u)
  assert.match(en.meta.description, /reunion_continue|share/iu)
  assert.equal(zh.meta.detail, 'docs/DETAIL.zh.md')
  assert.equal(en.meta.detail, 'docs/DETAIL.md')
})

test('README.zh.md leads with ready-after-install and links QUICKSTART', async () => {
  const text = await readFile(join(root, 'README.zh.md'), 'utf8')
  assert.match(text, /QUICKSTART\.zh\.md/u)
  assert.match(text, /装完就能用/u)
  assert.match(text, /用重逢接着聊/u)
  const quick = text.indexOf('装完就能用')
  const advanced = text.indexOf('进阶：先选对工具')
  assert.ok(quick >= 0 && advanced > quick, 'quickstart section should appear before advanced tool picker')
})
