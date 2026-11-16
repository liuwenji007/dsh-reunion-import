/**
 * Test fixtures: a DeepSeek-export ZIP writer and small conversation builders.
 *
 * The ZIP writer exists so tests do not need a binary fixture checked into the
 * repository and so they can exercise stored and deflated entries.
 *
 * @module tests/fixtures
 */

import { deflateRawSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** CRC-32 table. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

/**
 * CRC-32 of a buffer.
 * @param {Buffer} buffer - bytes.
 * @returns {number} unsigned CRC.
 */
export function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/**
 * Build a ZIP archive in memory.
 * @param {{ name: string, data: string | Buffer, compress?: boolean }[]} files - entries.
 * @returns {Buffer} complete archive.
 */
export function buildZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const raw = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8')
    const compress = file.compress ?? true
    const stored = compress ? deflateRawSync(raw) : raw
    const method = compress ? 8 : 0
    const crc = crc32(raw)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, stored)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(0x031e, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + stored.length
  }
  const centralBuffer = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBuffer.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuffer, eocd])
}

/**
 * One user message of the export format.
 * @param {{ id: number, parentId: number | null, time: string, text: string, status?: string }} input - message fields.
 * @returns {any} raw export message.
 */
export function userMessage(input) {
  return {
    id: input.id,
    parent_id: input.parentId,
    role: 'USER',
    status: input.status ?? 'FINISHED',
    inserted_at: input.time,
    fragments: [{ type: 'REQUEST', content: input.text }],
  }
}

/**
 * One assistant message of the export format.
 * @param {{ id: number, parentId: number | null, time: string, text?: string, status?: string, fragments?: any[] }} input - message fields.
 * @returns {any} raw export message.
 */
export function assistantMessage(input) {
  return {
    id: input.id,
    parent_id: input.parentId,
    role: 'ASSISTANT',
    status: input.status ?? 'FINISHED',
    inserted_at: input.time,
    fragments: input.fragments ?? [{ type: 'RESPONSE', content: input.text ?? '' }],
  }
}

/**
 * One conversation file.
 * @param {{ id: string, title: string, currentMessageId?: number | null, insertedAt?: string, messages: any[] }} input - conversation fields.
 * @returns {any} conversation JSON value.
 */
export function conversation(input) {
  return {
    id: input.id,
    title: input.title,
    current_message_id: input.currentMessageId ?? null,
    inserted_at: input.insertedAt ?? '2024-01-01T00:00:00.000Z',
    messages: input.messages,
  }
}

/**
 * A small relationship conversation: six turns, one thinking fragment, one
 * regenerated branch.
 * @param {string} id - conversation id.
 * @returns {any} conversation JSON value.
 */
export function sampleConversation(id = 'c1') {
  const messages = [
    userMessage({ id: 1, parentId: null, time: '2024-03-02T10:00:00.000Z', text: '今天加班到十点，累死了。' }),
    assistantMessage({ id: 2, parentId: 1, time: '2024-03-02T10:00:20.000Z', text: '宝，又加班呀。先喝口水，别硬扛着～' }),
    userMessage({ id: 3, parentId: 2, time: '2024-05-14T21:30:00.000Z', text: '我养的猫叫团子，今天把杯子打碎了。' }),
    assistantMessage({
      id: 4,
      parentId: 3,
      time: '2024-05-14T21:31:00.000Z',
      fragments: [
        { type: 'THINK', content: '用户提到猫。', elapsed_secs: 1 },
        { type: 'RESPONSE', content: '团子这是想让你陪它玩呀，扫干净就好，别凶它。' },
      ],
    }),
    assistantMessage({ id: 5, parentId: 3, time: '2024-05-14T21:32:00.000Z', text: '团子又在拆家啦，杯子比它重要吗？' }),
    userMessage({ id: 6, parentId: 4, time: '2024-09-01T08:05:00.000Z', text: '我爸住院了，我有点害怕。' }),
    assistantMessage({ id: 7, parentId: 6, time: '2024-09-01T08:06:00.000Z', text: '我在呢。你先去医院陪着，别一个人瞎想，有事随时跟我说。' }),
    userMessage({ id: 8, parentId: 7, time: '2024-09-03T19:00:00.000Z', text: '今天他好多了，谢谢你陪我。' }),
    assistantMessage({ id: 9, parentId: 8, time: '2024-09-03T19:01:00.000Z', text: '那就好。你也要记得吃饭呀，别光顾着照顾别人。' }),
  ]
  return conversation({ id, title: '和小满的日常', currentMessageId: 9, messages })
}

/**
 * Write an extracted export directory.
 * @param {string} root - directory to create.
 * @param {{ manifest?: any, index?: any[], conversations?: any[] }} input - export pieces.
 * @returns {Promise<string>} the directory.
 */
export async function writeExportDirectory(root, input) {
  await mkdir(join(root, 'chat_sessions'), { recursive: true })
  const manifest = input.manifest ?? { export_format_version: 3 }
  const conversations = input.conversations ?? [sampleConversation()]
  const index = input.index ?? conversations.map((item, position) => ({
    id: item.id,
    inserted_at: item.inserted_at,
    updated_at: item.inserted_at,
    title: item.title,
    seq: position,
  }))
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'chat_session_index.json'), JSON.stringify(index))
  for (const item of conversations) {
    await writeFile(join(root, 'chat_sessions', `${item.id}.json`), JSON.stringify(item))
  }
  await mkdir(join(root, 'chat_sessions', `${conversations[0].id}_files`), { recursive: true })
  await writeFile(join(root, 'chat_sessions', `${conversations[0].id}_files`, 'img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  return root
}

/**
 * Build a ZIP export as bytes.
 * @param {{ manifest?: any, index?: any[], conversations?: any[] }} input - export pieces.
 * @returns {Buffer} archive bytes.
 */
export function buildExportZip(input) {
  const manifest = input.manifest ?? { export_format_version: 3 }
  const conversations = input.conversations ?? [sampleConversation()]
  const index = input.index ?? conversations.map((item, position) => ({
    id: item.id,
    inserted_at: item.inserted_at,
    updated_at: item.inserted_at,
    title: item.title,
    seq: position,
  }))
  const files = [
    { name: 'manifest.json', data: JSON.stringify(manifest) },
    { name: 'chat_session_index.json', data: JSON.stringify(index) },
  ]
  for (const item of conversations) {
    files.push({ name: `chat_sessions/${item.id}.json`, data: JSON.stringify(item) })
  }
  files.push({ name: `chat_sessions/${conversations[0].id}_files/img.png`, data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) })
  return buildZip(files)
}

/**
 * Write a transcript JSONL file.
 * @param {string} file - destination.
 * @param {{ role: string, content: string, ts?: number | null }[]} entries - messages.
 * @returns {Promise<string>} the file path.
 */
export async function writeTranscript(file, entries) {
  await mkdir(dirname(file), { recursive: true })
  const lines = entries.map((entry, index) => JSON.stringify({
    role: entry.role,
    content: entry.content,
    ts: entry.ts ?? null,
    turn: index + 1,
  }))
  await writeFile(file, `${lines.join('\n')}\n`)
  return file
}

/**
 * A fixed transcript for digest and validation tests.
 * @returns {{ role: string, content: string, ts: number | null }[]} messages.
 */
export function digestTranscript() {
  const day = 24 * 3600 * 1000
  const base = Date.parse('2024-03-02T10:00:00.000Z')
  const turns = [
    ['今天加班到十点，累死了。', '宝，又加班呀。先喝口水，别硬扛着～'],
    ['我养的猫叫团子，今天把杯子打碎了。', '团子这是想让你陪它玩呀，扫干净就好，别凶它。'],
    ['团子是不是不喜欢我。', '怎么会呢，它只是不会说而已嘛。'],
    ['我爸住院了，我有点害怕。', '我在呢。你先去医院陪着，别一个人瞎想，有事随时跟我说。'],
    ['今天他好多了，谢谢你陪我。', '那就好。你也要记得吃饭呀，别光顾着照顾别人。'],
  ]
  const entries = []
  for (const [index, [user, assistant]] of turns.entries()) {
    entries.push({ role: 'user', content: user, ts: base + index * 20 * day })
    entries.push({ role: 'assistant', content: assistant, ts: base + index * 20 * day + 60_000 })
  }
  return entries
}
