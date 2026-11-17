/**
 * Plugin-contract test: `apply()` against a minimal Host stub, then the full
 * tool sequence through the tools' own `execute` functions. This is the closest
 * verification to the installed plugin that does not need a live Harness.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply, inject, name } from '../index.js'
import {
  assistantMessage, buildExportZip, conversation, sampleConversation, userMessage,
} from './fixtures.mjs'

/** Collect the tools a plugin registers. */
function hostStub(workspace) {
  const tools = []
  const disposers = []
  const ctx = {
    effect(callback) {
      const disposer = callback()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => disposer?.()
    },
    on() {
      return () => {}
    },
    get(service) {
      if (service === 'workingDirectory') return { get: () => workspace }
      return undefined
    },
    logger() {
      return { warn() {}, info() {}, error() {} }
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {}
      },
    },
  }
  return { ctx, tools, disposers }
}

/** One execution context carrying a fake agent with a scoped prompt registry. */
function execution(sections = []) {
  const systemPrompt = {
    section(definition) {
      sections.push(definition)
      return () => {
        const index = sections.indexOf(definition)
        if (index !== -1) sections.splice(index, 1)
      }
    },
    getSectionOrder: () => 0,
  }
  const ctx = {
    inject(_dependencies, callback) {
      callback({ systemPrompt })
      return { dispose() { sections.length = 0 } }
    },
  }
  return {
    agent: { id: 'session-1', session: { id: 'session-1' }, ctx },
    signal: new AbortController().signal,
    sections,
  }
}

test('the bundle registers twelve tools and exposes the plugin contract', () => {
  assert.equal(name, 'dsh-reunion-import')
  assert.deepEqual(inject, ['tools', 'systemPrompt'])
  const host = hostStub(tmpdir())
  apply(host.ctx, { locale: 'zh' })
  const names = host.tools.map(tool => tool.name)
  assert.deepEqual(names, [
    'reunion_inspect', 'reunion_read', 'reunion_import', 'reunion_continue', 'reunion_recall', 'reunion_digest',
    'reunion_compose', 'reunion_commit', 'reunion_load', 'reunion_unload', 'reunion_list', 'reunion_delete',
  ])
  assert.equal(new Set(names).size, 12)
  for (const tool of host.tools) {
    assert.equal(typeof tool.description, 'string')
    assert.equal(tool.parameters.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.deepEqual(tool.output.render({}, { text: 'hi' }), [{ type: 'text', text: 'hi' }])
    assert.equal(typeof tool.execute, 'function')
  }
})

test('the tool sequence imports, previews, commits, loads, lists, and deletes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-plugin-'))
  try {
    const exportFile = join(root, 'export.zip')
    const second = conversation({
      id: 'c2',
      title: '第二个线程',
      currentMessageId: 4,
      messages: [
        userMessage({ id: 1, parentId: null, time: '2025-01-04T09:00:00.000Z', text: '新年第一天上班，好困。' }),
        assistantMessage({ id: 2, parentId: 1, time: '2025-01-04T09:01:00.000Z', text: '新年快乐呀，困就早点睡，别熬夜。' }),
        userMessage({ id: 3, parentId: 2, time: '2025-01-05T22:00:00.000Z', text: '我把团子的照片设成壁纸了。' }),
        assistantMessage({ id: 4, parentId: 3, time: '2025-01-05T22:01:00.000Z', text: '那它天天陪你上班，挺好嘛。' }),
      ],
    })
    await writeFile(exportFile, buildExportZip({ conversations: [sampleConversation(), second] }))
    const host = hostStub(root)
    apply(host.ctx, { locale: 'zh' })
    const tool = toolName => host.tools.find(item => item.name === toolName)
    const sections = []
    const run = (toolName, args) => tool(toolName).execute(args, execution(sections))

    const inspect = await run('reunion_inspect', { path: exportFile })
    assert.match(inspect.text, /结构探测/u)
    assert.match(inspect.text, /会话 2/u)
    assert.match(inspect.text, /12/u)

    const imported = await run('reunion_import', { path: exportFile, name: '小满', sessions: ['c1', 'c2'] })
    assert.match(imported.text, /导入/u)
    assert.match(imported.text, /会话: 2/u)
    assert.match(imported.text, /读取: 12/u)
    const companionDir = join(root, 'companions', '小满')
    assert.match(await readFile(join(companionDir, 'transcript.jsonl'), 'utf8'), /"role":"user"/u)

    const again = await run('reunion_import', { path: exportFile, name: '小满', sessions: ['c1', 'c2'] })
    assert.match(again.text, /已经导入过/u)

    const digest = await run('reunion_digest', { slug: '小满' })
    assert.match(digest.text, /蒸馏素材/u)
    const transcript = (await readFile(join(companionDir, 'transcript.jsonl'), 'utf8'))
      .trim().split('\n').map(line => JSON.parse(line))
    const anchors = transcript
      .filter(entry => entry.role === 'assistant' && entry.content.length >= 12)
      .slice(0, 5)
      .map(entry => entry.content)
    assert.ok(anchors.length >= 5)

    const draft = {
      slug: '小满',
      userNickname: '宝',
      displayName: '小满',
      soul: [
        '你是小满：说话短、软，先把情绪接住，再决定讲不讲道理。',
        '',
        '### 称呼',
        '叫她「宝」，只在开头或心疼她的时候用。',
        '',
        '### 节奏',
        '句子短，常带语气词。她累的时候只回一两句，把话留给她。',
        '',
        '### 什么时候说教',
        '她问怎么办的时候才给建议，其余时候先陪着。',
      ].join('\n'),
      memory: [
        '# 小满 × 宝',
        '',
        '## 关系骨架',
        '- 她叫我小满，我叫她宝，从 2024 年春天开始。',
        '- 团子是她养的猫，2024 年 5 月打碎过杯子。',
        '- 2024 年 9 月她爸爸住过院，后来好转。',
        '',
        '## 用户画像',
        '- 加班多，常到十点。',
        '- 在意家人，爸爸住院时很害怕。',
        '- 喜欢猫，把团子的照片设成壁纸。',
      ].join('\n'),
      fewShots: anchors,
      samples: ['好呀，那我在门口等你，不急。', '你先睡嘛，明天的事明天再说。', '团子今天没闹吧。'],
      uncertain: ['可能住在南方（未证实）'],
    }
    const preview = await run('reunion_compose', draft)
    assert.match(preview.text, /人格预览/u)
    assert.match(preview.text, /全部检查通过/u)
    const draftId = /## 草稿 id: ([0-9a-f]{20})/u.exec(preview.text)?.[1]
    assert.ok(draftId, preview.text)

    const committed = await run('reunion_commit', { draftId })
    assert.match(committed.text, /已保存/u)
    const soul = await readFile(join(companionDir, 'SOUL.md'), 'utf8')
    const memory = await readFile(join(companionDir, 'MEMORY.md'), 'utf8')
    assert.match(soul, /原句锚点/u)
    assert.match(memory, /待确认/u)

    const loaded = await run('reunion_load', { slug: '小满' })
    assert.match(loaded.text, /已装载/u)
    assert.match(loaded.text, /只作用于当前会话/u)
    assert.equal(sections.length, 1)
    assert.match(sections[0].text, /你就是「小满」/u)

    const unloaded = await run('reunion_unload', { slug: '小满' })
    assert.match(unloaded.text, /已卸载/u)
    assert.equal(sections.length, 0)
    const nothing = await run('reunion_unload', {})
    assert.match(nothing.text, /没有装载任何人格/u)

    const skill = await run('reunion_load', { slug: '小满', mode: 'skill' })
    assert.match(skill.text, /技能/u)
    const skillRelative = /(\.dsh\/skills\/reunion-persona-[0-9a-f]{8}\/SKILL\.md)/u.exec(skill.text)?.[1]
    assert.ok(skillRelative, skill.text)
    const skillFile = join(root, skillRelative)
    assert.match(await readFile(skillFile, 'utf8'), /name: reunion-persona-/u)

    const listed = await run('reunion_list', {})
    assert.match(listed.text, /小满/u)

    const confirmation = await run('reunion_delete', { slug: '小满' })
    assert.match(confirmation.text, /删除/u)
    assert.match(confirmation.text, /confirm/u)

    const deleted = await run('reunion_delete', { slug: '小满', confirm: true })
    assert.match(deleted.text, /已删除/u)
    await assert.rejects(readFile(join(companionDir, 'SOUL.md'), 'utf8'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('reunion_continue imports a thread and loads it in one call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-continue-'))
  try {
    const exportFile = join(root, 'export.zip')
    await writeFile(exportFile, buildExportZip({ conversations: [sampleConversation()] }))
    const host = hostStub(root)
    apply(host.ctx, { locale: 'zh' })
    const tool = toolName => host.tools.find(item => item.name === toolName)
    const sections = []
    const run = (toolName, args) => tool(toolName).execute(args, execution(sections))

    const result = await run('reunion_continue', {
      path: exportFile,
      session: 'c1',
      name: '一句话续聊',
    })
    assert.match(result.text, /已就绪 · 可以接着聊/u)
    assert.match(result.text, /请用户直接说下一句/u)
    assert.equal(sections.length, 1)
    assert.match(sections[0].text, /Reunion thread/u)
    assert.match(sections[0].text, /核心记忆/u)
    assert.match(await readFile(join(root, 'companions', '一句话续聊', 'THREAD.md'), 'utf8'), /对话线程/u)
    assert.match(await readFile(join(root, 'companions', '一句话续聊', 'CORE.md'), 'utf8'), /核心记忆/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recall pins a thread hit and a skill contains core plus the brief', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-recall-'))
  try {
    const exportFile = join(root, 'export.zip')
    await writeFile(exportFile, buildExportZip({ conversations: [sampleConversation()] }))
    const host = hostStub(root)
    apply(host.ctx, { locale: 'zh' })
    const tool = toolName => host.tools.find(item => item.name === toolName)
    const exec = execution([])
    await tool('reunion_continue').execute({ path: exportFile, session: 'c1', name: '团子' }, exec)
    const recalled = await tool('reunion_recall').execute({ query: '团子' }, exec)
    assert.match(recalled.text, /团子/u)
    assert.match(recalled.text, /已写入核心记忆/u)
    const core = await readFile(join(root, 'companions', '团子', 'CORE.md'), 'utf8')
    assert.match(core, /## 回想/u)
    assert.match(core, /团子/u)
    await tool('reunion_load').execute({ slug: '团子', mode: 'skill' }, execution([]))
    const skills = await readdir(join(root, '.dsh', 'skills'))
    const skill = await readFile(join(root, '.dsh', 'skills', skills[0], 'SKILL.md'), 'utf8')
    assert.match(skill, /核心记忆/u)
    assert.match(skill, /对话线程/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a single selected session defaults to thread without an explicit mode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-thread-default-'))
  try {
    const exportFile = join(root, 'export.zip')
    await writeFile(exportFile, buildExportZip({ conversations: [sampleConversation()] }))
    const host = hostStub(root)
    apply(host.ctx, { locale: 'zh' })
    const tool = toolName => host.tools.find(item => item.name === toolName)
    const run = (toolName, args) => tool(toolName).execute(args, execution([]))

    const imported = await run('reunion_import', {
      path: exportFile,
      sessions: ['c1'],
      name: '默认线程',
    })
    assert.match(imported.text, /线程导入/u)
    assert.match(imported.text, /THREAD\.md/u)
    await assert.rejects(readFile(join(root, 'companions', '默认线程', 'SOUL.md'), 'utf8'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a thread imports, loads a continuation brief, and unloads without a persona', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reunion-thread-plugin-'))
  try {
    const exportFile = join(root, 'export.zip')
    await writeFile(exportFile, buildExportZip({ conversations: [sampleConversation()] }))
    const host = hostStub(root)
    apply(host.ctx, { locale: 'zh' })
    const tool = toolName => host.tools.find(item => item.name === toolName)
    const sections = []
    const run = (toolName, args) => tool(toolName).execute(args, execution(sections))

    const read = await run('reunion_read', { path: exportFile, session: 'c1', limit: 3 })
    assert.match(read.text, /读取会话/u)
    assert.match(read.text, /第 1–3 条/u)
    assert.match(read.text, /宝，又加班呀/u)

    const imported = await run('reunion_import', {
      path: exportFile,
      mode: 'thread',
      sessions: ['c1'],
      name: '线程测试',
    })
    assert.match(imported.text, /线程导入/u)
    assert.match(imported.text, /THREAD\.md/u)
    await assert.rejects(readFile(join(root, 'companions', '线程测试', 'SOUL.md'), 'utf8'))

    const digest = await run('reunion_digest', { slug: '线程测试' })
    assert.match(digest.text, /不是人格/u)

    const loaded = await run('reunion_load', { slug: '线程测试' })
    assert.match(loaded.text, /线程已装载/u)
    assert.equal(sections.length, 1)
    assert.match(sections[0].text, /Reunion thread/u)
    assert.match(sections[0].text, /对话线程/u)

    const listed = await run('reunion_list', {})
    assert.match(listed.text, /线程测试/u)
    assert.match(listed.text, /（线程）/u)

    const unloaded = await run('reunion_unload', { slug: '线程测试' })
    assert.match(unloaded.text, /已卸载/u)
    assert.equal(sections.length, 0)

    const deleted = await run('reunion_delete', { slug: '线程测试', confirm: true })
    assert.match(deleted.text, /已删除/u)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
