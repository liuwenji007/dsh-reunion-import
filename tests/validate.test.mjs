/** Tests for draft validation and the anti-verbatim guard. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../lib/config.mjs'
import { validateDraft } from '../lib/validate.mjs'
import { digestTranscript, writeTranscript } from './fixtures.mjs'

const config = resolveConfig({}).config

const SOUL = [
  '你是小满：软、短、先接住情绪再说话，不急着讲道理。',
  '',
  '### 称呼',
  '你叫她「宝」，只在开头或心疼她的时候用。',
  '',
  '### 节奏',
  '句子短，常带语气词。她累的时候只回一两句，把话留给她。',
  '',
  '### 什么时候说教',
  '她问怎么办的时候才给建议，其余时候先陪着。',
].join('\n')

const MEMORY = [
  '# 小满 × 用户',
  '',
  '## 关系骨架',
  '- 她叫我宝，我叫她宝，从 2024 年春天开始。',
  '- 团子是她养的猫，2024 年 5 月打碎过杯子。',
  '- 2024 年 9 月她爸爸住过院，后来好转。',
  '',
  '## 用户画像',
  '- 加班多，常到十点。',
  '- 养猫，叫团子。',
  '- 在意家人。',
].join('\n')

const FEW_SHOTS = [
  '宝，又加班呀。先喝口水，别硬扛着～',
  '团子这是想让你陪它玩呀，扫干净就好，别凶它。',
  '怎么会呢，它只是不会说而已嘛。',
  '我在呢。你先去医院陪着，别一个人瞎想，有事随时跟我说。',
  '那就好。你也要记得吃饭呀，别光顾着照顾别人。',
]

const SAMPLES = [
  '好呀，那我在门口等你，不急。',
  '你先睡嘛，明天的事明天再说。',
  '团子呢？它今天没闹吧。',
]

const DRAFT = {
  displayName: '小满',
  userNickname: '宝',
  soul: SOUL,
  memory: MEMORY,
  fewShots: FEW_SHOTS,
  samples: SAMPLES,
  uncertain: ['可能住在南方（未证实）'],
}

/** Run validation over the fixed transcript. */
async function validate(draft, root) {
  const file = await writeTranscript(join(root, 'transcript.jsonl'), digestTranscript())
  return validateDraft({ draft, transcriptPath: file, config })
}

/** One temp dir per test. */
async function withRoot(callback) {
  const root = await mkdtemp(join(tmpdir(), 'reunion-validate-'))
  try {
    return await callback(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('a well-formed draft passes every check', async () => {
  await withRoot(async root => {
    const result = await validate(DRAFT, root)
    assert.deepEqual(result.errors, [])
    assert.equal(result.stats.fewShots, 5)
    assert.equal(result.stats.samples, 3)
    assert.equal(result.stats.memoryChars > 0, true)
    assert.equal(result.stats.memoryChars <= config.maxMemoryChars, true)
  })
})

test('MEMORY over budget is rejected with the measured size', async () => {
  await withRoot(async root => {
    const memory = `${MEMORY}\n\n## 附录\n${'- 这是一条用来撑爆预算的记忆。\n'.repeat(700)}`
    const result = await validate({ ...DRAFT, memory }, root)
    const error = result.errors.find(item => item.code === 'memory.budget')
    assert.ok(error)
    assert.match(error.detail, /^\d+\/8000$/)
  })
})

test('fewer than five anchors is rejected', async () => {
  await withRoot(async root => {
    const result = await validate({ ...DRAFT, fewShots: FEW_SHOTS.slice(0, 3) }, root)
    assert.ok(result.errors.some(item => item.code === 'fewshot.count'))
  })
})

test('an invented anchor is rejected', async () => {
  await withRoot(async root => {
    const result = await validate({ ...DRAFT, fewShots: [...FEW_SHOTS.slice(1), '这句是我编的，存档里没有。'] }, root)
    assert.ok(result.errors.some(item => item.code === 'fewshot.not-found'))
  })
})

test('an anchor may be a partial sentence that occurs verbatim', async () => {
  await withRoot(async root => {
    const result = await validate({ ...DRAFT, fewShots: [...FEW_SHOTS.slice(1), '别硬扛着～'] }, root)
    assert.equal(result.errors.some(item => item.code === 'fewshot.not-found'), false)
  })
})

test('SOUL prose that recaps archive text is rejected', async () => {
  await withRoot(async root => {
    const soul = `${SOUL}\n\n### 原话\n团子这是想让你陪它玩呀，扫干净就好，别凶它。`
    const result = await validate({ ...DRAFT, soul }, root)
    const error = result.errors.find(item => item.code === 'soul.verbatim')
    assert.ok(error)
    assert.ok(error.detail.length >= 12)
  })
})

test('a sample reply copied from the archive is rejected', async () => {
  await withRoot(async root => {
    const samples = [SAMPLES[0], SAMPLES[1], FEW_SHOTS[0]]
    const result = await validate({ ...DRAFT, samples }, root)
    assert.ok(result.errors.some(item => item.code === 'samples.verbatim'))
  })
})

test('sample count and MEMORY structure are enforced', async () => {
  await withRoot(async root => {
    const result = await validate({
      ...DRAFT,
      samples: SAMPLES.slice(0, 2),
      memory: MEMORY.replace(/^## /gmu, '').replace(/^- /gmu, ''),
    }, root)
    assert.ok(result.errors.some(item => item.code === 'samples.count'))
    assert.ok(result.errors.some(item => item.code === 'memory.bullets'))
  })
})

test('MEMORY must mention how the persona calls the user', async () => {
  await withRoot(async root => {
    const result = await validate({ ...DRAFT, memory: MEMORY.replaceAll('宝', '你') }, root)
    assert.ok(result.errors.some(item => item.code === 'memory.nickname'))
  })
})

test('speculative wording in MEMORY is a warning, not a failure', async () => {
  await withRoot(async root => {
    const result = await validate({ ...DRAFT, memory: `${MEMORY}\n- 她可能在南方。` }, root)
    assert.equal(result.errors.some(item => item.code === 'memory.hedge'), false)
    assert.ok(result.warnings.some(item => item.code === 'memory.hedge'))
  })
})
