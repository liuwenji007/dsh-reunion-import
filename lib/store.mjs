/**
 * Durable storage of persona directories under `companions/`.
 *
 * Nothing here imports plugin services: the store is plain filesystem work so
 * the CLI, the unit tests, and the Host tools share one implementation. Files
 * are written through a temporary sibling and renamed, so an interrupted write
 * never leaves a half persona behind.
 *
 * @module dsh-reunion-import/store
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { companionPath, isSlug } from './slug.mjs'
import { TRANSCRIPT_FILE } from './transcript.mjs'

/** Current meta.json schema version. */
export const META_SCHEMA = 1

/** File names inside one persona directory. */
export const FILES = Object.freeze({
  soul: 'SOUL.md',
  memory: 'MEMORY.md',
  thread: 'THREAD.md',
  core: 'CORE.md',
  transcript: TRANSCRIPT_FILE,
  meta: 'meta.json',
})

/**
 * Create a directory and its parents.
 * @param {string} dir - absolute directory.
 * @returns {Promise<void>} resolves once it exists.
 */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

/**
 * Read a file as UTF-8, or return null when it does not exist.
 * @param {string} path - absolute file path.
 * @returns {Promise<string | null>} the text, or null.
 */
export async function readTextIfExists(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/**
 * Read and parse a JSON file, or return null when it is missing or damaged.
 * @param {string} path - absolute file path.
 * @returns {Promise<any | null>} parsed JSON, or null.
 */
export async function readJsonIfExists(path) {
  const text = await readTextIfExists(path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Write text through a temporary sibling and rename it into place.
 * @param {string} path - destination file.
 * @param {string} text - complete UTF-8 content.
 * @returns {Promise<void>} resolves after the rename.
 */
export async function writeTextAtomic(path, text) {
  await ensureDir(dirname(path))
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temporary, text, 'utf8')
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

/**
 * Write a JSON document with a trailing newline.
 * @param {string} path - destination file.
 * @param {unknown} value - JSON-serializable value.
 * @returns {Promise<void>} resolves after the rename.
 */
export async function writeJsonAtomic(path, value) {
  await writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Stat a path, returning null when it does not exist.
 * @param {string} path - any path.
 * @returns {Promise<import('node:fs').Stats | null>} stats or null.
 */
export async function statSafe(path) {
  try {
    return await stat(path)
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

/**
 * Hash a file's bytes.
 * @param {string} path - file to hash.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {Promise<string>} lowercase hex SHA-256.
 */
export async function hashFile(path, signal) {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  try {
    for await (const chunk of stream) {
      if (signal?.aborted === true) throw signal.reason ?? new Error('aborted')
      hash.update(chunk)
    }
  } finally {
    stream.close()
  }
  return hash.digest('hex')
}

/**
 * Hash an extracted export directory by its file names and sizes.
 * @param {string} dir - export directory root.
 * @returns {Promise<string>} lowercase hex SHA-256 of the canonical listing.
 */
export async function hashDirectory(dir) {
  const rows = []
  const walk = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue
      const info = await stat(full)
      rows.push(`${full.slice(dir.length + 1)}\u0000${info.size}`)
    }
  }
  await walk(dir)
  rows.sort()
  return createHash('sha256').update(rows.join('\n')).digest('hex')
}

/**
 * List every persona directory that holds a readable meta.json.
 * @param {string} root - companions root.
 * @returns {Promise<{ slug: string, dir: string, meta: any, complete: boolean }[]>} entries sorted by slug.
 */
export async function listCompanions(root) {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  const companions = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSlug(entry.name)) continue
    const dir = join(root, entry.name)
    const meta = await readJsonIfExists(join(dir, FILES.meta))
    const transcript = await statSafe(join(dir, FILES.transcript))
    const soul = await statSafe(join(dir, FILES.soul))
    const memory = await statSafe(join(dir, FILES.memory))
    const thread = await statSafe(join(dir, FILES.thread))
    const kind = meta?.kind === 'thread' || (soul === null && thread !== null)
      ? 'thread'
      : soul !== null && memory !== null
        ? 'persona'
        : 'incomplete'
    companions.push({
      slug: entry.name,
      dir,
      meta,
      kind,
      complete: transcript !== null && kind !== 'incomplete',
    })
  }
  companions.sort((left, right) => left.slug.localeCompare(right.slug))
  return companions
}

/**
 * Read one persona, including its archived transcript path.
 * @param {string} root - companions root.
 * @param {string} slug - validated slug.
 * @returns {Promise<{ slug: string, dir: string, soul: string|null, memory: string|null, meta: any, transcriptPath: string, transcriptBytes: number } | null>} the persona or null.
 */
export async function readCompanion(root, slug) {
  if (!isSlug(slug)) return null
  const dir = companionPath(root, slug)
  const info = await statSafe(dir)
  if (info === null || !info.isDirectory()) return null
  const transcriptPath = join(dir, FILES.transcript)
  const transcript = await statSafe(transcriptPath)
  const soul = await readTextIfExists(join(dir, FILES.soul))
  const thread = await readTextIfExists(join(dir, FILES.thread))
  const meta = await readJsonIfExists(join(dir, FILES.meta))
  return {
    slug,
    dir,
    kind: meta?.kind === 'thread' || (soul === null && thread !== null) ? 'thread' : soul === null ? 'incomplete' : 'persona',
    soul,
    memory: await readTextIfExists(join(dir, FILES.memory)),
    thread,
    core: await readTextIfExists(join(dir, FILES.core)),
    meta,
    transcriptPath,
    transcriptBytes: transcript?.size ?? 0,
  }
}

/**
 * Write the distilled files of a persona. The transcript and meta are written
 * by their own steps; this function never touches the source export.
 * @param {string} root - companions root.
 * @param {string} slug - validated slug.
 * @param {{ soul: string, memory: string, meta: any }} content - distilled content and updated metadata.
 * @returns {Promise<{ dir: string, soulPath: string, memoryPath: string, metaPath: string }>} written paths.
 */
export async function writePersona(root, slug, content) {
  const dir = companionPath(root, slug)
  await ensureDir(dir)
  const soulPath = join(dir, FILES.soul)
  const memoryPath = join(dir, FILES.memory)
  const metaPath = join(dir, FILES.meta)
  await writeTextAtomic(soulPath, content.soul)
  await writeTextAtomic(memoryPath, content.memory)
  await writeJsonAtomic(metaPath, content.meta)
  return { dir, soulPath, memoryPath, metaPath }
}

/**
 * Write the thread brief and metadata of a thread persona.
 * @param {string} root - companions root.
 * @param {string} slug - validated slug.
 * @param {{ brief: string, meta: any, core?: string }} content - brief text and metadata.
 * @returns {Promise<{ dir: string, briefPath: string, metaPath: string, corePath?: string }>} written paths.
 */
export async function writeThread(root, slug, content) {
  const dir = companionPath(root, slug)
  await ensureDir(dir)
  const briefPath = join(dir, FILES.thread)
  const metaPath = join(dir, FILES.meta)
  await writeTextAtomic(briefPath, content.brief)
  let corePath
  if (typeof content.core === 'string') {
    corePath = join(dir, FILES.core)
    await writeTextAtomic(corePath, content.core)
  }
  await writeJsonAtomic(metaPath, content.meta)
  return { dir, briefPath, metaPath, corePath }
}

/**
 * Replace CORE.md for one companion.
 * @param {string} root - companions root.
 * @param {string} slug - validated slug.
 * @param {string} core - CORE.md text.
 * @returns {Promise<string>} written path.
 */
export async function writeCore(root, slug, core) {
  const dir = companionPath(root, slug)
  await ensureDir(dir)
  const corePath = join(dir, FILES.core)
  await writeTextAtomic(corePath, core)
  return corePath
}

/**
 * Remove one persona directory and everything inside it.
 * @param {string} root - companions root.
 * @param {string} slug - validated slug.
 * @returns {Promise<{ dir: string, files: number, bytes: number }>} what was removed.
 * @throws {Error} when the persona does not exist.
 */
export async function deleteCompanion(root, slug) {
  const dir = companionPath(root, slug)
  const info = await statSafe(dir)
  if (info === null) throw new Error(`persona not found: ${slug}`)
  let files = 0
  let bytes = 0
  const walk = async current => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      files++
      bytes += (await stat(full)).size
    }
  }
  await walk(dir)
  await rm(dir, { recursive: true, force: true })
  return { dir, files, bytes }
}

/**
 * Skill name of the generated persona skill: ASCII kebab-case, because skill
 * names cannot carry the CJK characters a slug may.
 * @param {string} slug - validated persona slug.
 * @returns {string} skill name such as `reunion-xiaoman`.
 */
export function skillName(slug) {
  const ascii = String(slug)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  const suffix = ascii.length > 0 ? ascii : `persona-${createHash('sha256').update(String(slug)).digest('hex').slice(0, 8)}`
  return `reunion-${suffix}`.slice(0, 64)
}

/**
 * Directory of the generated skill for one persona.
 * @param {string} skillsRoot - resolved skills directory.
 * @param {string} slug - validated slug.
 * @returns {string} absolute skill directory.
 */
export function skillPath(skillsRoot, slug) {
  return join(skillsRoot, skillName(slug))
}

/**
 * Write the generated persona skill so a later session can load the persona
 * without this session's state.
 * @param {string} skillsRoot - resolved skills directory (workspace `.dsh/skills`).
 * @param {string} slug - validated slug.
 * @param {{ soul: string, memory: string, displayName: string, locale: 'zh'|'en' }} content - persona text.
 * @returns {Promise<string>} path of the written SKILL.md.
 */
export async function writeSkill(skillsRoot, slug, content) {
  const dir = skillPath(skillsRoot, slug)
  await ensureDir(dir)
  const name = skillName(slug)
  const isThread = content.thread === true
  const description = isThread
    ? (content.locale === 'zh'
      ? `继续「${content.displayName}」这段长对话（由重逢生成的线程摘要）。`
      : `Continue the long conversation "${content.displayName}" with a brief generated by Reunion.`)
    : (content.locale === 'zh'
      ? `装载「${content.displayName}」的人格与关系记忆（由重逢生成），接着之前的对话聊。`
      : `Load ${content.displayName}'s voice and relationship memory (generated by Reunion) and continue the previous conversation.`)
  const body = [
    '---',
    `name: ${name}`,
    `description: ${description}`,
    '---',
    '',
    `# ${content.displayName}`,
    '',
    isThread
      ? (content.locale === 'zh'
        ? '下面先是核心记忆（重要的事），再是近期续写。不要复述。细节不在这里就用 reunion_recall 回想，不要编造。当前会话里刚回想的内容，要重新装载后才会进入常驻段落。'
        : 'Core memory comes first, then the recent brief. Do not recap them. If a detail is missing, call reunion_recall instead of inventing it. A recall updates the file; reload to refresh the standing section.')
      : (content.locale === 'zh'
        ? '下面的口吻与记忆来自用户自己导入的历史对话。用这个人物的口吻接着聊；不要把存档原文大段复述出来。'
        : 'The voice and memory below come from a chat history the user imported. Continue the conversation in this voice; do not recite the archive in bulk.'),
    '',
    content.soul.trim(),
    ...(content.memory !== undefined && content.memory.trim() !== '' ? ['', '---', '', content.memory.trim()] : []),
    '',
  ].join('\n')
  const file = join(dir, 'SKILL.md')
  await writeTextAtomic(file, body)
  return file
}

/**
 * Remove the generated skill of one persona, if it exists.
 * @param {string} skillsRoot - resolved skills directory.
 * @param {string} slug - validated slug.
 * @returns {Promise<string | null>} the removed directory, or null.
 */
export async function deleteSkill(skillsRoot, slug) {
  const dir = skillPath(skillsRoot, slug)
  const info = await statSafe(dir)
  if (info === null) return null
  await rm(dir, { recursive: true, force: true })
  return dir
}
