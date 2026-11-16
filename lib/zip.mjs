/**
 * Minimal read-only ZIP archive reader.
 *
 * A chat export arrives as one large `.zip`. This module reads only the End Of
 * Central Directory record, the central directory, and the requested entries,
 * never the whole file. Every failure is a {@link ZipError} with a stable
 * `code`, so callers can map damage onto a user-facing message without matching
 * error strings.
 *
 * @module dsh-reunion-import/zip
 */

import { open as openFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
const ZIP64_EXTRA_ID = 0x0001
const EOCD_MIN_BYTES = 22
const EOCD_SCAN_BYTES = EOCD_MIN_BYTES + 0xffff
const DEFAULT_MAX_ENTRY_BYTES = 64 * 1024 * 1024

/**
 * One entry from the archive's central directory.
 * @typedef {object} ZipEntry
 * @property {string} name - entry path with forward slashes and no leading `/`.
 * @property {number} method - compression method: `0` stored, `8` deflated.
 * @property {number} compressedSize - number of bytes stored in the archive.
 * @property {number} uncompressedSize - declared size after decompression.
 * @property {boolean} isDirectory - whether the entry denotes a directory.
 */

/**
 * Read-only view of one open archive. The file handle is released by `close`;
 * entry metadata stays readable afterwards but `read` throws `CLOSED`.
 * @typedef {object} ZipReader
 * @property {readonly ZipEntry[]} entries - central directory order, duplicates kept.
 * @property {(name: string) => boolean} has - whether an entry with this name exists.
 * @property {(name: string) => ZipEntry | undefined} get - first entry with this name.
 * @property {() => readonly string[]} names - entry names in central directory order.
 * @property {(name: string, options?: { maxEntryBytes?: number }) => Promise<Uint8Array | undefined>} read - decompressed bytes, or `undefined` when absent.
 * @property {() => Promise<void>} close - release the file handle; idempotent.
 */

/** Error raised by every public ZIP API. */
export class ZipError extends Error {
  /**
   * @param {'NOT_ZIP' | 'TRUNCATED' | 'CORRUPT' | 'ENCRYPTED' | 'UNSUPPORTED_METHOD' | 'TOO_LARGE' | 'CLOSED' | 'IO'} code - stable machine-readable failure code.
   * @param {string} message - human-readable description.
   * @param {{ cause?: unknown }} [options] - standard error options.
   */
  constructor(code, message, options) {
    super(message, options)
    this.name = 'ZipError'
    this.code = code
  }
}

/** @typedef {{ entryCount: number, cdSize: number, cdOffset: number, boundary: number }} Eocd */
/** @typedef {{ name: string, method: number, compressedSize: number, uncompressedSize: number, isDirectory: boolean, flags: number, localOffset: number }} InternalEntry */

/**
 * Open a ZIP archive and read its central directory. Only the EOCD, ZIP64
 * structures, and central directory are read here; entry data is read lazily.
 * @param {string} filePath - path of the `.zip` archive.
 * @param {{ maxEntryBytes?: number }} [options] - default cap for one decompressed entry.
 * @returns {Promise<ZipReader>} reader over the archive.
 * @throws {ZipError} with a stable code when the file cannot be read or parsed.
 */
export async function openZip(filePath, options = {}) {
  const defaultMaxEntryBytes = normalizeLimit(options?.maxEntryBytes, DEFAULT_MAX_ENTRY_BYTES)
  let handle
  try {
    handle = await openFile(filePath, 'r')
  } catch (cause) {
    throw new ZipError('IO', `cannot open ZIP archive: ${errorMessage(cause)}`, { cause })
  }

  try {
    const { size } = await handle.stat()
    const eocd = await locateEocd(handle, size)
    const internalEntries = await readCentralDirectory(handle, eocd)
    const byName = new Map()
    for (const entry of internalEntries) {
      if (!byName.has(entry.name)) byName.set(entry.name, entry)
    }
    const entries = Object.freeze(internalEntries.map(toPublicEntry))
    const publicByName = new Map()
    for (const entry of entries) {
      if (!publicByName.has(entry.name)) publicByName.set(entry.name, entry)
    }
    const names = Object.freeze(entries.map(entry => entry.name))

    let fileHandle = handle
    let closed = false

    return {
      entries,
      has(name) {
        return typeof name === 'string' && byName.has(stripLeadingSlashes(name))
      },
      get(name) {
        return typeof name === 'string' ? publicByName.get(stripLeadingSlashes(name)) : undefined
      },
      names() {
        return names
      },
      async read(name, readOptions = {}) {
        if (closed || fileHandle === null) throw new ZipError('CLOSED', 'ZIP archive is closed')
        if (typeof name !== 'string') return undefined
        const entry = byName.get(stripLeadingSlashes(name))
        if (entry === undefined) return undefined
        const requested = readOptions !== null && typeof readOptions === 'object'
          ? readOptions.maxEntryBytes
          : undefined
        return readEntry(fileHandle, entry, size, normalizeLimit(requested, defaultMaxEntryBytes))
      },
      async close() {
        if (closed) return
        closed = true
        const closing = fileHandle
        fileHandle = null
        try {
          await closing.close()
        } catch (cause) {
          throw new ZipError('IO', `cannot close ZIP archive: ${errorMessage(cause)}`, { cause })
        }
      },
    }
  } catch (error) {
    await handle.close().catch(() => {})
    if (error instanceof ZipError) throw error
    throw new ZipError('IO', `cannot read ZIP archive: ${errorMessage(error)}`, { cause: error })
  }
}

// Find the EOCD in the tail, resolving ZIP64 when classic fields are sentinels.
// A candidate must also lead to a plausible central directory, so a stray
// signature inside a zip comment normally cannot win.
async function locateEocd(handle, fileSize) {
  if (fileSize < EOCD_MIN_BYTES) throw new ZipError('NOT_ZIP', 'file is too small to be a ZIP archive')
  const scanLength = Math.min(fileSize, EOCD_SCAN_BYTES)
  const scanStart = fileSize - scanLength
  const scan = await readAt(handle, scanStart, scanLength)
  let sawCandidate = false
  let best

  for (let index = scanLength - EOCD_MIN_BYTES; index >= 0; index -= 1) {
    if (scan.readUInt32LE(index) !== EOCD_SIGNATURE) continue
    const commentLength = scan.readUInt16LE(index + 20)
    if (index + EOCD_MIN_BYTES + commentLength > scanLength) continue
    sawCandidate = true

    const eocdPosition = scanStart + index
    const entryCount = scan.readUInt16LE(index + 10)
    const cdSize = scan.readUInt32LE(index + 12)
    const cdOffset = scan.readUInt32LE(index + 16)
    const needsZip64 = entryCount === 0xffff
      || scan.readUInt16LE(index + 8) === 0xffff
      || cdSize === 0xffffffff
      || cdOffset === 0xffffffff
    const resolved = needsZip64
      ? await readZip64Eocd(handle, eocdPosition, fileSize)
      : { entryCount, cdSize, cdOffset, boundary: eocdPosition }

    if (!isPlausibleCentralDirectory(resolved, fileSize)) continue
    // An empty classic archive has its EOCD at byte 0. A zero-entry record
    // anywhere else is a comment, trailing bytes, or a stray signature.
    if (resolved.entryCount === 0 && !needsZip64 && eocdPosition !== 0) continue
    if (resolved.entryCount > 0) {
      const signature = await readAt(handle, resolved.cdOffset, 4)
      if (signature.readUInt32LE(0) !== CENTRAL_SIGNATURE) continue
    }
    // A real EOCD precedes its own comment and any trailing bytes, so an
    // EOCD-looking record inside either cannot replace this earlier match.
    best = resolved
  }

  if (best !== undefined) return best
  throw new ZipError('NOT_ZIP', sawCandidate
    ? 'no usable end of central directory record was found'
    : 'end of central directory record not found')
}

// Resolve the ZIP64 EOCD record through the locator that precedes the EOCD.
async function readZip64Eocd(handle, eocdPosition, fileSize) {
  if (eocdPosition < 20) throw new ZipError('CORRUPT', 'ZIP64 end of central directory locator is missing')
  const locator = await readAt(handle, eocdPosition - 20, 20)
  if (locator.readUInt32LE(0) !== ZIP64_LOCATOR_SIGNATURE) {
    throw new ZipError('CORRUPT', 'ZIP64 end of central directory locator is missing')
  }
  if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) > 1) {
    throw new ZipError('CORRUPT', 'multi-disk ZIP64 archives are not supported')
  }

  const recordOffset = locator.readBigUInt64LE(8)
  const locatorPosition = BigInt(eocdPosition - 20)
  if (recordOffset + 56n > locatorPosition) {
    throw new ZipError('CORRUPT', 'ZIP64 end of central directory is out of range')
  }
  const record = await readAt(handle, Number(recordOffset), 56)
  if (record.readUInt32LE(0) !== ZIP64_EOCD_SIGNATURE) {
    throw new ZipError('CORRUPT', 'ZIP64 end of central directory signature is missing')
  }
  const recordSize = record.readBigUInt64LE(4)
  if (recordSize < 44n || recordOffset + 12n + recordSize > locatorPosition) {
    throw new ZipError('CORRUPT', 'ZIP64 end of central directory is malformed')
  }
  if (record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0) {
    throw new ZipError('CORRUPT', 'multi-disk ZIP64 archives are not supported')
  }

  return {
    entryCount: zip64Number(record.readBigUInt64LE(32), 'entry count'),
    cdSize: zip64Number(record.readBigUInt64LE(40), 'central directory size'),
    cdOffset: zip64Number(record.readBigUInt64LE(48), 'central directory offset'),
    boundary: Number(recordOffset),
  }
}

// The central directory must fit the file and end before the EOCD structures.
function isPlausibleCentralDirectory(eocd, fileSize) {
  const end = eocd.cdOffset + eocd.cdSize
  if (!Number.isSafeInteger(end) || end > fileSize || end > eocd.boundary) return false
  if (eocd.entryCount > 0 && eocd.cdSize < 46) return false
  return true
}

// Read the central directory and parse each entry in order.
async function readCentralDirectory(handle, eocd) {
  if (eocd.entryCount === 0) return []
  const directory = await readAt(handle, eocd.cdOffset, eocd.cdSize)
  const entries = []
  let position = 0
  for (let index = 0; index < eocd.entryCount; index += 1) {
    const parsed = parseCentralEntry(directory, position)
    entries.push(parsed.entry)
    position = parsed.next
  }
  return entries
}

// Parse one central header: fixed fields, name, extra field, and directory bits.
function parseCentralEntry(directory, position) {
  if (position + 46 > directory.length) {
    throw new ZipError('TRUNCATED', 'central directory ended before all entries were read')
  }
  if (directory.readUInt32LE(position) !== CENTRAL_SIGNATURE) {
    throw new ZipError('CORRUPT', 'invalid central directory entry signature')
  }
  const flags = directory.readUInt16LE(position + 8)
  const method = directory.readUInt16LE(position + 10)
  const compressedSize = directory.readUInt32LE(position + 20)
  const uncompressedSize = directory.readUInt32LE(position + 24)
  const nameLength = directory.readUInt16LE(position + 28)
  const extraLength = directory.readUInt16LE(position + 30)
  const commentLength = directory.readUInt16LE(position + 32)
  const diskStart = directory.readUInt16LE(position + 34)
  const externalAttributes = directory.readUInt32LE(position + 38)
  const localOffset = directory.readUInt32LE(position + 42)
  const entryEnd = position + 46 + nameLength + extraLength + commentLength
  if (entryEnd > directory.length) {
    throw new ZipError('TRUNCATED', 'central directory entry is truncated')
  }

  const nameStart = position + 46
  const name = stripLeadingSlashes(directory.toString('utf8', nameStart, nameStart + nameLength))
  const extraStart = nameStart + nameLength
  const extra = directory.subarray(extraStart, extraStart + extraLength)
  const resolved = resolveZip64Extra(extra, { compressedSize, uncompressedSize, localOffset, diskStart })
  const isDirectory = name.endsWith('/')
    || ((externalAttributes >>> 16) & 0xf000) === 0x4000
    || (externalAttributes & 0x10) !== 0

  return {
    entry: {
      name,
      method,
      compressedSize: resolved.compressedSize,
      uncompressedSize: resolved.uncompressedSize,
      isDirectory,
      flags,
      localOffset: resolved.localOffset,
    },
    next: entryEnd,
  }
}

// Resolve the ZIP64 extra field: only sentinel-valued header fields are stored,
// in the fixed order uncompressed size, compressed size, local offset, disk.
function resolveZip64Extra(extra, raw) {
  const needed = raw.uncompressedSize === 0xffffffff
    || raw.compressedSize === 0xffffffff
    || raw.localOffset === 0xffffffff
    || raw.diskStart === 0xffff
  if (!needed) return raw

  let position = 0
  while (position + 4 <= extra.length) {
    const headerId = extra.readUInt16LE(position)
    const size = extra.readUInt16LE(position + 2)
    const start = position + 4
    const end = start + size
    if (end > extra.length) throw new ZipError('CORRUPT', 'central directory extra field is truncated')
    if (headerId !== ZIP64_EXTRA_ID) {
      position = end
      continue
    }

    const resolved = { ...raw }
    let cursor = start
    const readSize = field => {
      if (cursor + 8 > end) throw new ZipError('CORRUPT', `ZIP64 extra field is missing the ${field}`)
      const value = zip64Number(extra.readBigUInt64LE(cursor), field)
      cursor += 8
      return value
    }
    if (raw.uncompressedSize === 0xffffffff) resolved.uncompressedSize = readSize('uncompressed size')
    if (raw.compressedSize === 0xffffffff) resolved.compressedSize = readSize('compressed size')
    if (raw.localOffset === 0xffffffff) resolved.localOffset = readSize('local header offset')
    if (raw.diskStart === 0xffff) {
      if (cursor + 4 > end) throw new ZipError('CORRUPT', 'ZIP64 extra field is missing the disk number')
      resolved.diskStart = extra.readUInt32LE(cursor)
    }
    return resolved
  }

  throw new ZipError('CORRUPT', 'ZIP64 extra field is missing')
}

// Read one entry through its local header. Central-directory sizes are
// authoritative, so data-descriptor archives (flag bit 3) work even though
// their local header sizes are zero.
async function readEntry(handle, entry, fileSize, maxEntryBytes) {
  if ((entry.flags & 0x0001) !== 0) throw new ZipError('ENCRYPTED', `entry "${entry.name}" is encrypted`)
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipError('UNSUPPORTED_METHOD', `entry "${entry.name}" uses unsupported compression method ${entry.method}`)
  }
  if (entry.uncompressedSize > maxEntryBytes) {
    throw new ZipError('TOO_LARGE', `entry "${entry.name}" declares ${entry.uncompressedSize} bytes, above the ${maxEntryBytes} byte limit`)
  }
  if (entry.localOffset + 30 > fileSize) {
    throw new ZipError('TRUNCATED', `local header of entry "${entry.name}" is outside the archive`)
  }

  const local = await readAt(handle, entry.localOffset, 30)
  if (local.readUInt32LE(0) !== LOCAL_SIGNATURE) {
    throw new ZipError('CORRUPT', `entry "${entry.name}" has an invalid local header signature`)
  }
  const dataOffset = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28)
  const dataEnd = dataOffset + entry.compressedSize
  if (dataEnd > fileSize) throw new ZipError('TRUNCATED', `data of entry "${entry.name}" is outside the archive`)
  const compressed = await readAt(handle, dataOffset, entry.compressedSize)

  if (entry.method === 0) {
    if (compressed.length !== entry.uncompressedSize) {
      throw new ZipError('CORRUPT', `entry "${entry.name}" has inconsistent stored sizes`)
    }
    return compressed
  }

  let inflated
  try {
    inflated = inflateRawSync(compressed, { maxOutputLength: maxEntryBytes + 1 })
  } catch (cause) {
    if (cause !== null && typeof cause === 'object' && cause.code === 'ERR_BUFFER_TOO_LARGE') {
      throw new ZipError('TOO_LARGE', `entry "${entry.name}" inflates beyond the ${maxEntryBytes} byte limit`, { cause })
    }
    throw new ZipError('CORRUPT', `entry "${entry.name}" cannot be inflated: ${errorMessage(cause)}`, { cause })
  }
  if (inflated.length > maxEntryBytes) {
    throw new ZipError('TOO_LARGE', `entry "${entry.name}" inflates beyond the ${maxEntryBytes} byte limit`)
  }
  if (inflated.length !== entry.uncompressedSize) {
    throw new ZipError('CORRUPT', `entry "${entry.name}" inflates to ${inflated.length} bytes instead of ${entry.uncompressedSize}`)
  }
  return inflated
}

// Read exactly `length` bytes at an absolute offset, or fail as TRUNCATED.
async function readAt(handle, position, length) {
  if (!Number.isSafeInteger(position) || position < 0
    || !Number.isSafeInteger(length) || length < 0) {
    throw new ZipError('CORRUPT', 'invalid ZIP archive offset or length')
  }
  let buffer
  try {
    buffer = Buffer.allocUnsafe(length)
  } catch (cause) {
    throw new ZipError('TOO_LARGE', `ZIP archive region of ${length} bytes is too large to read`, { cause })
  }

  let filled = 0
  while (filled < length) {
    let result
    try {
      result = await handle.read(buffer, filled, length - filled, position + filled)
    } catch (cause) {
      throw new ZipError('IO', `cannot read ZIP archive: ${errorMessage(cause)}`, { cause })
    }
    if (result.bytesRead === 0) {
      throw new ZipError('TRUNCATED', `unexpected end of ZIP archive at byte ${position + filled}`)
    }
    filled += result.bytesRead
  }
  return buffer
}

// Project an internal record onto the public, immutable entry shape.
function toPublicEntry(entry) {
  return Object.freeze({
    name: entry.name,
    method: entry.method,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    isDirectory: entry.isDirectory,
  })
}

// Remove leading slashes, which some writers put on entry names.
function stripLeadingSlashes(name) {
  return name.replace(/^\/+/u, '')
}

// Convert a ZIP64 64-bit value into a safe JavaScript number.
function zip64Number(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ZipError('TOO_LARGE', `ZIP64 ${label} is too large to handle`)
  }
  return Number(value)
}

// Coerce an optional byte limit; unusable values fall back to the default.
function normalizeLimit(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback
  return Math.min(Math.floor(value), Number.MAX_SAFE_INTEGER)
}

// Extract a readable message from an unknown thrown value.
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
