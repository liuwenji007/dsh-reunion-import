/**
 * End-to-end test of the deterministic half of the product: import a JSONL
 * export, digest it, validate a draft built from the digest's own anchors,
 * then render and write SOUL.md / MEMORY.md. No model is involved.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../lib/config.mjs'
import { buildDigest } from '../lib/digest.mjs'
import { importIntoCompanion } from '../lib/import.mjs'
import { buildMemory, buildSoul } from '../lib/render.mjs'
import { readCompanion, writePersona } from '../lib/store.mjs'
import { iterateTranscript } from '../lib/transcript.mjs'
import { validateDraft } from '../lib/validate.mjs'
import { digestTranscript } from './fixtures.mjs'

const config = resolveConfig({}).config

test('import → digest → validate → render → write produces the four files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-pipeline-'))
  try {
    const jsonl = join(root, 'messages.jsonl')
    const lines = digestTranscript().map(entry => JSON.stringify({
      role: entry.role,
      content: entry.content,
      time: new Date(entry.ts).toISOString(),
    }))
    await import('node:fs/promises').then(fs => fs.writeFile(jsonl, lines.join('\n')))
    const imported = await importIntoCompanion({
      path: jsonl,
      displayName: '小满',
      companionsRoot: join(root, 'companions'),
      config,
      locale: 'zh',
    })
    assert.equal(imported.messages, 10)
    const companion = await readCompanion(join(root, 'companions'), imported.slug)
    assert.ok(companion)
    const digest = await buildDigest({
      entries: iterateTranscript(companion.transcriptPath),
      slug: imported.slug,
      config,
    })
    assert.equal(digest.messages, 10)
    assert.ok(digest.fewShots.length >= 5)

    const anchors = digest.fewShots.slice(0, 5).map(item => item.text)
    const draft = {
      displayName: '小满',
      userNickname: '宝',
      soul: [
        '你是小满。说话短、软，先把情绪接住，再考虑讲不讲道理。',
        '',
        '### 称呼',
        '叫她「宝」。心疼她的时候才用，平常不必每句都喊。',
        '',
        '### 留白',
        '她累的时候只回一两句，把话留给她，不追问。',
      ].join('\n'),
      memory: [
        '# 小满 × 宝',
        '',
        '## 关系骨架',
        '- 她叫我小满，我叫她宝。',
        '- 团子是她养的猫，2024 年 5 月打碎过杯子。',
        '',
        '## 用户画像',
        '- 加班多，常到十点。',
        '- 在意家人，爸爸住院时很害怕。',
        '- 喜欢猫，把团子的照片设成壁纸。',
      ].join('\n'),
      fewShots: anchors,
      samples: [
        '好呀，那我在门口等你，不急。',
        '你先睡嘛，明天的事明天再说。',
        '团子今天没闹吧。',
      ],
      uncertain: ['她可能住在南方（未证实）'],
    }

    const validation = await validateDraft({
      draft,
      transcriptPath: companion.transcriptPath,
      config,
    })
    assert.deepEqual(validation.errors, [])

    const soulText = buildSoul({ displayName: '小满', soul: draft.soul, fewShots: draft.fewShots, locale: 'zh' })
    const memoryText = buildMemory({ memory: draft.memory, uncertain: draft.uncertain, locale: 'zh' })
    assert.match(soulText, /^# 小满 · SOUL\n\n/u)
    assert.match(soulText, /\n\n## 原句锚点/u)
    for (const anchor of anchors) assert.ok(soulText.includes(anchor))
    assert.match(memoryText, /\n\n## 待确认（置信度低）\n\n- /u)
    assert.ok(memoryText.includes('她可能住在南方'))

    const meta = {
      ...(companion.meta ?? {}),
      displayName: '小满',
      userNickname: '宝',
      budget: validation.stats,
      distill: { fewShots: anchors.length, samples: 3 },
    }
    const written = await writePersona(join(root, 'companions'), imported.slug, { soul: soulText, memory: memoryText, meta })
    const soul = await readFile(written.soulPath, 'utf8')
    const memory = await readFile(written.memoryPath, 'utf8')
    assert.ok(soul.length > 0 && memory.length > 0)
    assert.ok(!soul.includes('今天加班到十点，累死了。'), 'SOUL must not contain the user transcript')
    const reread = await readCompanion(join(root, 'companions'), imported.slug)
    assert.equal(reread.meta.displayName, '小满')
    assert.equal(reread.meta.userNickname, '宝')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
