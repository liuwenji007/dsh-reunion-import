/**
 * Tests for the read-only ZIP reader. Every archive is built byte by byte in
 * this file so the tests exercise the parser rather than a third-party writer.
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { openZip, ZipError } from '../lib/zip.mjs'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_DATA_DESCRIPTOR = 0x08074b50
const SIG_ZIP64_EOCD = 0x06064b50
const SIG_ZIP64_LOCATOR = 0x07064b50
const ZIP64_EXTRA_ID = 0x0001
const ZIP64_SENTINEL_32 = 0xffffffff

let directory
let fileCounter = 0
const readers = []

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'dsh-reunion-zip-'))
})

after(async () => {
  for (const reader of readers) await reader.close().catch(() => {})
  await rm(directory, { recursive: true, force: true })
})

async function writeArchive(bytes) {
  fileCounter += 1
  const file = join(directory, `archive-${fileCounter}.zip`)
  await writeFile(file, bytes)
  return file
}

async function openBytes(bytes, options) {
  const file = await writeArchive(bytes)
  const reader = await openZip(file, options)
  readers.push(reader)
  return reader
}

function isZipError(error, code) {
  return error instanceof ZipError && error.code === code
}

function isZipErrorIn(error, codes) {
  return error instanceof ZipError && codes.includes(error.code)
}

// --- pure-JS ZIP writer used only by these tests -----------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function buildZip64Extra(record) {
  const parts = []
  if (record.spec.zip64Sizes === true) {
    const sizes = Buffer.alloc(16)
    sizes.writeBigUInt64LE(BigInt(record.data.length), 0)
    sizes.writeBigUInt64LE(BigInt(record.payload.length), 8)
    parts.push(sizes)
  }
  if (record.spec.zip64Offset === true) {
    const offset = Buffer.alloc(8)
    offset.writeBigUInt64LE(BigInt(record.localOffset), 0)
    parts.push(offset)
  }
  if (parts.length === 0) return Buffer.alloc(0)
  const body = Buffer.concat(parts)
  const extra = Buffer.alloc(4 + body.length)
  extra.writeUInt16LE(ZIP64_EXTRA_ID, 0)
  extra.writeUInt16LE(body.length, 2)
  body.copy(extra, 4)
  return extra
}

/**
 * Build a complete ZIP archive.
 * Spec fields: name, data, deflate, method, flags, dataDescriptor,
 * zip64Sizes, zip64Offset, externalAttributes, declaredUncompressedSize.
 * Options: zip64 (write ZIP64 EOCD structures), comment.
 */
function buildZip(specs, options = {}) {
  const chunks = []
  const records = []
  let offset = 0

  for (const spec of specs) {
    const data = Buffer.from(spec.data ?? Buffer.alloc(0))
    const method = spec.method ?? (spec.deflate === true ? 8 : 0)
    const payload = method === 8 ? deflateRawSync(data) : data
    const crc = crc32(data)
    const descriptor = spec.dataDescriptor === true
    const flags = (spec.flags ?? 0) | 0x0800 | (descriptor ? 0x0008 : 0)
    const nameBytes = Buffer.from(spec.name, 'utf8')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(descriptor ? 0 : crc, 14)
    local.writeUInt32LE(descriptor ? 0 : payload.length, 18)
    local.writeUInt32LE(descriptor ? 0 : data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)

    const localOffset = offset
    chunks.push(local, nameBytes, payload)
    offset += local.length + nameBytes.length + payload.length
    if (descriptor) {
      const descriptorBytes = Buffer.alloc(16)
      descriptorBytes.writeUInt32LE(SIG_DATA_DESCRIPTOR, 0)
      descriptorBytes.writeUInt32LE(crc, 4)
      descriptorBytes.writeUInt32LE(payload.length, 8)
      descriptorBytes.writeUInt32LE(data.length, 12)
      chunks.push(descriptorBytes)
      offset += descriptorBytes.length
    }
    records.push({ spec, data, payload, crc, flags, method, nameBytes, localOffset })
  }

  const cdOffset = offset
  for (const record of records) {
    const extra = buildZip64Extra(record)
    const compressedField = record.spec.zip64Sizes === true
      ? ZIP64_SENTINEL_32
      : record.payload.length
    const uncompressedField = record.spec.zip64Sizes === true
      ? ZIP64_SENTINEL_32
      : (record.spec.declaredUncompressedSize ?? record.data.length)
    const localOffsetField = record.spec.zip64Offset === true
      ? ZIP64_SENTINEL_32
      : record.localOffset

    const header = Buffer.alloc(46)
    header.writeUInt32LE(SIG_CENTRAL, 0)
    header.writeUInt16LE(0x031e, 4)
    header.writeUInt16LE(record.spec.zip64Sizes === true || record.spec.zip64Offset === true ? 45 : 20, 6)
    header.writeUInt16LE(record.flags, 8)
    header.writeUInt16LE(record.method, 10)
    header.writeUInt32LE(record.crc, 16)
    header.writeUInt32LE(compressedField, 20)
    header.writeUInt32LE(uncompressedField, 24)
    header.writeUInt16LE(record.nameBytes.length, 28)
    header.writeUInt16LE(extra.length, 30)
    header.writeUInt32LE(record.spec.externalAttributes ?? 0, 38)
    header.writeUInt32LE(localOffsetField, 42)
    chunks.push(header, record.nameBytes, extra)
    offset += header.length + record.nameBytes.length + extra.length
  }
  const cdSize = offset - cdOffset
  const count = specs.length
  const comment = Buffer.from(options.comment ?? '', 'utf8')

  if (options.zip64 === true) {
    const recordOffset = offset
    const record = Buffer.alloc(56)
    record.writeUInt32LE(SIG_ZIP64_EOCD, 0)
    record.writeBigUInt64LE(44n, 4)
    record.writeUInt16LE(45, 12)
    record.writeUInt16LE(45, 14)
    record.writeBigUInt64LE(BigInt(count), 24)
    record.writeBigUInt64LE(BigInt(count), 32)
    record.writeBigUInt64LE(BigInt(cdSize), 40)
    record.writeBigUInt64LE(BigInt(cdOffset), 48)

    const locator = Buffer.alloc(20)
    locator.writeUInt32LE(SIG_ZIP64_LOCATOR, 0)
    locator.writeBigUInt64LE(BigInt(recordOffset), 8)
    locator.writeUInt32LE(1, 16)
    chunks.push(record, locator)
  }

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(count, 8)
  eocd.writeUInt16LE(count, 10)
  eocd.writeUInt32LE(options.zip64 === true ? ZIP64_SENTINEL_32 : cdSize, 12)
  eocd.writeUInt32LE(options.zip64 === true ? ZIP64_SENTINEL_32 : cdOffset, 16)
  eocd.writeUInt16LE(comment.length, 20)
  chunks.push(eocd, comment)
  return Buffer.concat(chunks)
}

// --- tests -------------------------------------------------------------------

test('reads stored, deflated, unicode, nested, duplicate, and directory entries', async () => {
  const stored = Buffer.from('stored payload')
  const deflated = Buffer.from('deflated payload '.repeat(100))
  const unicodeName = '对话记录/你好.txt'
  const unicodeData = Buffer.from('你好，世界。')
  const archive = buildZip([
    { name: 'notes.txt', data: stored },
    { name: 'nested/hello.txt', data: deflated, deflate: true },
    { name: unicodeName, data: unicodeData, deflate: true },
    { name: 'nested/', data: Buffer.alloc(0), externalAttributes: 0x10 },
    { name: 'attrs-directory', data: Buffer.alloc(0), externalAttributes: 0x10 },
    { name: '/slashy.txt', data: Buffer.from('leading slash') },
    { name: 'duplicate.txt', data: Buffer.from('first') },
    { name: 'duplicate.txt', data: Buffer.from('second') },
  ])
  const zip = await openBytes(archive)

  assert.equal(zip.entries.length, 8)
  assert.equal(zip.has('notes.txt'), true)
  assert.equal(zip.has('elsewhere.txt'), false)
  assert.equal(zip.get('notes.txt').method, 0)
  assert.equal(zip.get('nested/hello.txt').method, 8)
  assert.equal(zip.get('nested/hello.txt').compressedSize, deflateRawSync(deflated).length)
  assert.equal(zip.get('nested/hello.txt').uncompressedSize, deflated.length)
  assert.equal(zip.get('nested/').isDirectory, true)
  assert.equal(zip.get('attrs-directory').isDirectory, true)
  assert.equal(zip.get('notes.txt').isDirectory, false)

  assert.deepEqual(await zip.read('notes.txt'), stored)
  assert.deepEqual(await zip.read('nested/hello.txt'), deflated)
  assert.deepEqual(await zip.read(unicodeName), unicodeData)
  assert.equal(await zip.read('missing.txt'), undefined)
  assert.equal(zip.get('missing.txt'), undefined)

  assert.equal(zip.get('slashy.txt').name, 'slashy.txt')
  assert.equal(zip.has('/slashy.txt'), true)
  assert.deepEqual(await zip.read('/slashy.txt'), Buffer.from('leading slash'))

  assert.equal(zip.names().filter(name => name === 'duplicate.txt').length, 2)
  assert.deepEqual(await zip.read('duplicate.txt'), Buffer.from('first'))
  assert.equal(zip.get('duplicate.txt').uncompressedSize, 5)
})

test('reads entries written with a data descriptor', async () => {
  const payload = Buffer.from('data descriptor payload '.repeat(50))
  const archive = buildZip([
    { name: 'descriptor.txt', data: payload, deflate: true, dataDescriptor: true },
    { name: 'stored-descriptor.txt', data: payload, dataDescriptor: true },
  ])
  const zip = await openBytes(archive)

  assert.deepEqual(await zip.read('descriptor.txt'), payload)
  assert.deepEqual(await zip.read('stored-descriptor.txt'), payload)
})

test('tolerates an archive comment and trailing bytes after EOCD', async () => {
  const payload = Buffer.from('comment and trailing bytes')
  const archive = Buffer.concat([
    buildZip([{ name: 'alpha.txt', data: payload }], { comment: 'an archive comment' }),
    Buffer.from('TRAILING BYTES AFTER THE COMMENT'),
  ])
  const zip = await openBytes(archive)
  assert.deepEqual(await zip.read('alpha.txt'), payload)
})

test('ignores an EOCD-looking record inside a comment or trailing bytes', async () => {
  const fakeEocd = Buffer.alloc(22)
  fakeEocd.writeUInt32LE(SIG_EOCD, 0)
  const payload = Buffer.from('the real entry')
  const commented = buildZip([{ name: 'real.txt', data: payload }], { comment: fakeEocd })
  const commentedZip = await openBytes(commented)
  assert.equal(commentedZip.entries.length, 1)
  assert.deepEqual(await commentedZip.read('real.txt'), payload)

  const withTrailing = Buffer.concat([
    buildZip([{ name: 'real.txt', data: payload }]),
    fakeEocd,
  ])
  const trailingZip = await openBytes(withTrailing)
  assert.equal(trailingZip.entries.length, 1)
  assert.deepEqual(await trailingZip.read('real.txt'), payload)
})

test('opens an empty archive', async () => {
  const zip = await openBytes(buildZip([]))
  assert.deepEqual(zip.entries, [])
  assert.equal(zip.names().length, 0)
  assert.equal(await zip.read('anything'), undefined)
})

test('rejects an encrypted entry with ENCRYPTED', async () => {
  const archive = buildZip([
    { name: 'secret.txt', data: Buffer.from('secret'), flags: 0x0001 },
  ])
  const zip = await openBytes(archive)
  await assert.rejects(zip.read('secret.txt'), error => isZipError(error, 'ENCRYPTED'))
})

test('rejects an unsupported compression method with UNSUPPORTED_METHOD', async () => {
  const archive = buildZip([
    { name: 'weird.bin', data: Buffer.from('raw bytes'), method: 12 },
  ])
  const zip = await openBytes(archive)
  assert.equal(zip.get('weird.bin').method, 12)
  await assert.rejects(zip.read('weird.bin'), error => isZipError(error, 'UNSUPPORTED_METHOD'))
})

test('rejects garbage, truncated files, and a truncated central directory as ZIP errors', async () => {
  const garbage = await writeArchive(Buffer.from('this is definitely not a zip archive'))
  await assert.rejects(openZip(garbage), error => isZipError(error, 'NOT_ZIP'))

  const valid = buildZip([{ name: 'a.txt', data: Buffer.from('a') }])
  const truncatedFile = await writeArchive(valid.subarray(0, valid.length - 10))
  await assert.rejects(openZip(truncatedFile),
    error => isZipErrorIn(error, ['NOT_ZIP', 'TRUNCATED']))

  const lyingEocd = Buffer.from(valid)
  const eocdOffset = lyingEocd.length - 22
  lyingEocd.writeUInt32LE(lyingEocd.readUInt32LE(eocdOffset + 12) + 1024, eocdOffset + 12)
  const truncatedCentral = await writeArchive(lyingEocd)
  await assert.rejects(openZip(truncatedCentral),
    error => isZipErrorIn(error, ['NOT_ZIP', 'TRUNCATED']))
})

test('enforces maxEntryBytes against the declared size before reading', async () => {
  const data = Buffer.alloc(1024, 7)
  const archive = buildZip([{ name: 'large.bin', data }])
  const zip = await openBytes(archive)

  await assert.rejects(zip.read('large.bin', { maxEntryBytes: 100 }),
    error => isZipError(error, 'TOO_LARGE'))
  assert.deepEqual(await zip.read('large.bin', { maxEntryBytes: 2048 }), data)

  const limited = await openBytes(archive, { maxEntryBytes: 100 })
  await assert.rejects(limited.read('large.bin'), error => isZipError(error, 'TOO_LARGE'))
})

test('enforces maxEntryBytes against the inflated output', async () => {
  const archive = buildZip([
    {
      name: 'bomb.txt',
      data: Buffer.alloc(512, 65),
      deflate: true,
      declaredUncompressedSize: 10,
    },
  ])
  const zip = await openBytes(archive)
  await assert.rejects(zip.read('bomb.txt', { maxEntryBytes: 100 }),
    error => isZipError(error, 'TOO_LARGE'))
})

test('rejects a declared/actual size mismatch and a bad local header as CORRUPT', async () => {
  const mismatched = buildZip([
    {
      name: 'short.txt',
      data: Buffer.from('hello'),
      deflate: true,
      declaredUncompressedSize: 6,
    },
  ])
  const mismatchZip = await openBytes(mismatched)
  await assert.rejects(mismatchZip.read('short.txt'), error => isZipError(error, 'CORRUPT'))

  const corrupted = buildZip([{ name: 'x.txt', data: Buffer.from('x') }])
  corrupted[0] = 0
  const corruptedZip = await openBytes(corrupted)
  await assert.rejects(corruptedZip.read('x.txt'), error => isZipError(error, 'CORRUPT'))
})

test('reads a 4 MB entry byte-identically', async () => {
  const data = Buffer.alloc(4 * 1024 * 1024)
  let state = 0x12345678
  for (let index = 0; index < data.length; index += 1) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    data[index] = state & 0xff
  }
  const archive = buildZip([{ name: 'big.bin', data, deflate: true }])
  const zip = await openBytes(archive)
  const read = await zip.read('big.bin')
  assert.equal(read.length, data.length)
  assert.deepEqual(read, data)
})

test('resolves ZIP64 sizes, offsets, and EOCD fields', async () => {
  const data = Buffer.from('zip64 entry payload '.repeat(10))
  const archive = buildZip([
    {
      name: 'zip64.txt',
      data,
      deflate: true,
      zip64Sizes: true,
      zip64Offset: true,
    },
  ], { zip64: true })
  const zip = await openBytes(archive)

  const entry = zip.get('zip64.txt')
  assert.equal(entry.compressedSize, deflateRawSync(data).length)
  assert.equal(entry.uncompressedSize, data.length)
  assert.deepEqual(await zip.read('zip64.txt'), data)

  // Count sentinels in the classic EOCD must also be resolved via ZIP64.
  const countSentinels = Buffer.from(archive)
  const eocdOffset = countSentinels.length - 22
  countSentinels.writeUInt16LE(0xffff, eocdOffset + 8)
  countSentinels.writeUInt16LE(0xffff, eocdOffset + 10)
  const countZip = await openBytes(countSentinels)
  assert.equal(countZip.entries.length, 1)
  assert.deepEqual(await countZip.read('zip64.txt'), data)

  // A ZIP64 extra field without ZIP64 EOCD structures is also valid.
  const sizesOnly = await openBytes(buildZip([
    { name: 'sizes.txt', data, deflate: true, zip64Sizes: true },
  ]))
  assert.deepEqual(await sizesOnly.read('sizes.txt'), data)
})

test('rejects malformed ZIP64 structures as CORRUPT', async () => {
  const archive = buildZip([
    { name: 'zip64.txt', data: Buffer.from('payload'), zip64Sizes: true, zip64Offset: true },
  ], { zip64: true })
  const broken = Buffer.from(archive)
  const locatorOffset = broken.length - 22 - 20
  assert.equal(broken.readUInt32LE(locatorOffset), SIG_ZIP64_LOCATOR)
  broken[locatorOffset] = 0
  const file = await writeArchive(broken)
  await assert.rejects(openZip(file), error => isZipError(error, 'CORRUPT'))
})

test('close releases the handle and makes later reads throw CLOSED', async () => {
  const archive = buildZip([{ name: 'a.txt', data: Buffer.from('alpha') }])
  const zip = await openBytes(archive)
  assert.deepEqual(await zip.read('a.txt'), Buffer.from('alpha'))

  await zip.close()
  await assert.rejects(zip.read('a.txt'), error => isZipError(error, 'CLOSED'))
  await zip.close()
  assert.equal(zip.has('a.txt'), true)
})

test('wraps a missing file as IO', async () => {
  await assert.rejects(openZip(join(directory, 'does-not-exist.zip')),
    error => isZipError(error, 'IO'))
})
