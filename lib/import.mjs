/**
 * Import one export into a persona directory.
 *
 * Shared by the Host tools and the CLI so both produce byte-identical results:
 * read the export, normalize the selected conversations, merge them into the
 * archive without duplicates, then record the source and its hash in meta.json.
 *
 * @module dsh-reunion-import/import
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { analyzeConversation, exportLayout, openDeepseekExport, parseConversation } from './deepseek.mjs'
import { collectGenericLines, collectGenericStream, collectGenericText } from './generic.mjs'
import { openSource, stripBom } from './source.mjs'
import { t } from './i18n.mjs'
import { isShareRef, loadDeepseekShare } from './share.mjs'
import { companionPath, isSlug, slugify } from './slug.mjs'
import { FILES, ensureDir, readJsonIfExists, statSafe, writeJsonAtomic, writeThread } from './store.mjs'
import { fingerprint, iterateTranscript, mergeIntoTranscript, monotonicTimestamps } from './transcript.mjs'
import { buildThreadBrief, buildThreadBriefFromTranscript } from './brief.mjs'

/** Smallest document size still parsed in one piece. */
const INLINE_PARSE_BYTES = 8 * 1024 * 1024

/**
 * Read the selected conversations of one source.
 * @param {any} source - opened source.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} config - resolved config.
 * @param {string[]} [selectedSessions] - conversation ids to keep; all when omitted.
 * @param {AbortSignal} [signal] - cancellation.
 * @returns {Promise<{
 *   formatId: string,
 *   version: number | null,
 *   sessions: { id: string, title: string | null, messages: any[], stats: any }[],
 *   missing: string[],
 *   diagnostics: any[],
 *   skippedFiltered: number,
 *   unanswered: number,
 * }>} normalized conversations.
 */
export async function readSelectedConversations(source, config, selectedSessions, signal) {
  if (source.kind === 'zip' || source.kind === 'dir') {
    const layout = exportLayout(source.entryNames())
    if (!layout.manifest && layout.conversations.length === 0) {
      return { formatId: 'unknown', version: null, sessions: [], missing: [], diagnostics: [{ level: 'error', code: 'source.unrecognized', detail: String(source.entryNames().length) }], skippedFiltered: 0, unanswered: 0 }
    }
    const exported = await openDeepseekExport(source, config)
    const wanted = selectedSessions === undefined ? exported.conversations.map(item => item.id) : selectedSessions
    const known = new Set(exported.conversations.map(item => item.id))
    const missing = wanted.filter(id => !known.has(id))
    const sessions = []
    const diagnostics = [...exported.diagnostics]
    let skippedFiltered = 0
    let unanswered = 0
    for (const id of wanted) {
      if (!known.has(id)) continue
      const parsed = await exported.readConversation(id)
      if (signal?.aborted === true) throw signal.reason ?? new Error('aborted')
      const analysis = analyzeConversation(id, parsed)
      diagnostics.push(...analysis.diagnostics)
      if (analysis.summary === null) continue
      skippedFiltered += analysis.summary.skippedFiltered
      unanswered += analysis.summary.unanswered
      sessions.push({
        id,
        title: analysis.summary.title,
        messages: analysis.transcript.messages,
        stats: analysis.summary,
      })
    }
    return { formatId: 'deepseek-chat-export', version: exported.version, sessions, missing, diagnostics, skippedFiltered, unanswered }
  }

  if (source.kind === 'json') {
    if (source.bytes > config.maxJsonBytes) {
      return { formatId: 'unknown', version: null, sessions: [], missing: [], diagnostics: [{ level: 'error', code: 'source.too-large', detail: String(source.bytes) }], skippedFiltered: 0, unanswered: 0 }
    }
    const text = stripBom(await readFile(source.path, 'utf8'))
    const root = tryParse(text)
    if (root !== undefined && isConversationFile(root)) {
      const parsed = parseConversation(text, String(root.id ?? 'conversation'))
      const analysis = analyzeConversation(String(root.id ?? 'conversation'), parsed)
      const id = String(root.id ?? 'conversation')
      return {
        formatId: 'deepseek-conversation',
        version: 3,
        sessions: analysis.summary === null ? [] : [{ id, title: analysis.summary.title, messages: analysis.transcript.messages, stats: analysis.summary }],
        missing: [],
        diagnostics: [...parsed.diagnostics, ...analysis.diagnostics],
        skippedFiltered: analysis.summary?.skippedFiltered ?? 0,
        unanswered: analysis.summary?.unanswered ?? 0,
      }
    }
    if (source.bytes <= INLINE_PARSE_BYTES) {
      const collected = collectGenericText(text, { maxMessages: config.maxMessages, maxSessions: config.maxInspectSessions })
      if (!collected.ok) {
        return { formatId: 'unknown', version: null, sessions: [], missing: [], diagnostics: [{ level: 'error', code: 'source.not-json', detail: collected.error }], skippedFiltered: 0, unanswered: 0 }
      }
      return genericResult(collected, selectedSessions, 'generic')
    }
    const collected = await collectGenericStream(source, { maxMessages: config.maxMessages, maxSessions: config.maxInspectSessions })
    return genericResult(collected, selectedSessions, 'generic')
  }

  if (source.kind === 'jsonl') {
    const collected = await collectGenericLines(source.lines(signal), { maxMessages: config.maxMessages, maxSessions: config.maxInspectSessions })
    const result = genericResult(collected, selectedSessions, 'generic-jsonl')
    if (collected.badLines > 0) result.diagnostics.push({ level: 'warn', code: 'source.bad-lines', detail: String(collected.badLines) })
    return result
  }

  return { formatId: 'unknown', version: null, sessions: [], missing: [], diagnostics: [{ level: 'error', code: source.kind === 'empty' ? 'file.empty' : 'source.not-json' }], skippedFiltered: 0, unanswered: 0 }
}

/** Parse JSON text, or undefined. */
function tryParse(text) {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Whether a parsed JSON value is one DeepSeek conversation file. */
function isConversationFile(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Array.isArray(value.messages)
    && value.messages.length > 0
    && value.messages[0] !== null && typeof value.messages[0] === 'object'
    && Array.isArray(value.messages[0].fragments)
}

/** Normalize a generic inference result. */
function genericResult(collected, selectedSessions, formatId) {
  const wanted = selectedSessions === undefined
    ? collected.sessions
    : collected.sessions.filter(session => selectedSessions.includes(session.id))
  const missing = selectedSessions === undefined
    ? []
    : selectedSessions.filter(id => !collected.sessions.some(session => session.id === id))
  return {
    formatId,
    version: null,
    sessions: wanted.map(session => ({
      id: session.id,
      title: session.title,
      messages: session.messages,
      stats: {
        users: session.messages.filter(message => message.role === 'user').length,
        assistants: session.messages.filter(message => message.role === 'assistant').length,
      },
    })),
    missing,
    diagnostics: collected.sessions.length === 0 ? [{ level: 'error', code: 'source.no-messages' }] : [],
    skippedFiltered: 0,
    unanswered: 0,
  }
}

/**
 * Write one persona directory from already-normalized conversations.
 *
 * This is the shared second half of both import modes: merge the messages into
 * the archive, record each source conversation's turn range so the thread
 * boundaries survive the merge, then update meta.json.
 *
 * @param {object} request - write inputs.
 * @param {string} request.companionsRoot - resolved companions root.
 * @param {string} request.slug - persona slug.
 * @param {string} request.displayName - persona display name.
 * @param {any} request.selected - normalized conversations from {@link readSelectedConversations}.
 * @param {string} request.path - source path recorded in meta.
 * @param {number} request.size - source size in bytes.
 * @param {string} request.sha256 - source hash.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} request.config - resolved config.
 * @param {'zh'|'en'} request.locale - output language recorded in meta.
 * @param {AbortSignal} [request.signal] - cancellation.
 * @returns {Promise<any>} import outcome for rendering.
 */
async function writeCompanion(request) {
  const { companionsRoot, slug, displayName, selected, path, size, sha256, config, locale, signal } = request
  if (!isSlug(slug)) throw new Error(`invalid persona slug: ${slug}`)
  const incoming = selected.sessions.flatMap(session => monotonicTimestamps(session.messages))
  if (incoming.length === 0) throw new Error('the selected conversations contain no usable messages')
  if (incoming.length > config.maxMessages) throw new Error(`import holds ${incoming.length} messages, above config.maxMessages (${config.maxMessages})`)

  const dir = companionPath(companionsRoot, slug)
  await ensureDir(dir)
  const metaPath = join(dir, FILES.meta)
  const transcriptPath = join(dir, FILES.transcript)
  const existing = await readJsonIfExists(metaPath)
  const importedAt = new Date().toISOString()
  if (existing !== null && existing.kind === 'thread') {
    throw new Error(`slug already used by a thread: ${slug}`)
  }
  if (existing !== null && Array.isArray(existing.sources) && existing.sources.some(item => item.sha256 === sha256)) {
    return {
      unchanged: true,
      slug,
      displayName: existing.displayName ?? displayName,
      dir,
      existed: true,
      messages: existing.messages ?? 0,
      sources: existing.sources,
    }
  }

  const merge = await mergeIntoTranscript({
    file: transcriptPath,
    incoming,
    maxMessages: config.maxMessages,
    signal,
  })

  // Turn ranges per source conversation: map each imported fingerprint to the
  // session that produced it, then read the merged archive once.
  const sessionOfPrint = new Map()
  for (const session of selected.sessions) {
    for (const message of session.messages) {
      const key = fingerprint(message)
      if (!sessionOfPrint.has(key)) sessionOfPrint.set(key, session.id)
    }
  }
  const ranges = new Map()
  if (sessionOfPrint.size > 0) {
    for await (const entry of iterateTranscript(transcriptPath, { signal })) {
      const sessionId = sessionOfPrint.get(fingerprint(entry))
      if (sessionId === undefined) continue
      const range = ranges.get(sessionId)
      if (range === undefined) ranges.set(sessionId, { from: entry.turn, to: entry.turn })
      else range.to = entry.turn
    }
  }

  const sessionSummaries = selected.sessions.map(session => {
    const times = session.messages.map(message => message.ts).filter(ts => ts !== null)
    const range = ranges.get(session.id)
    return {
      id: session.id,
      title: session.title,
      messages: session.messages.length,
      from: times.length > 0 ? times.reduce((min, value) => (value < min ? value : min), Number.POSITIVE_INFINITY) : null,
      to: times.length > 0 ? times.reduce((max, value) => (value > max ? value : max), Number.NEGATIVE_INFINITY) : null,
      turnFrom: range?.from ?? null,
      turnTo: range?.to ?? null,
    }
  })
  const sourceRecord = {
    path,
    kind: selected.formatId,
    version: selected.version,
    size,
    sha256,
    importedAt,
    sessions: sessionSummaries,
  }
  const previousSources = Array.isArray(existing?.sources) ? existing.sources : []
  const meta = {
    ...(existing ?? {}),
    schema: 1,
    slug,
    displayName: existing?.displayName ?? displayName,
    userNickname: existing?.userNickname ?? '',
    locale: existing?.locale ?? locale,
    createdAt: existing?.createdAt ?? importedAt,
    updatedAt: importedAt,
    sources: [...previousSources, sourceRecord].slice(-20),
    messages: merge.total,
    users: merge.users,
    turns: merge.turns,
    timeRange: { from: merge.from, to: merge.to },
    transcript: {
      path: FILES.transcript,
      bytes: merge.bytes,
      sha256: merge.sha256,
      lines: merge.total,
    },
    budget: existing?.budget ?? null,
    distill: existing?.distill ?? null,
  }
  await writeJsonAtomic(metaPath, meta)
  return {
    unchanged: false,
    slug,
    displayName: meta.displayName,
    dir,
    existed: existing !== null,
    sessions: selected.sessions.length,
    read: incoming.length,
    added: merge.added,
    duplicates: merge.duplicates,
    skipped: (selected.skippedFiltered ?? 0) + (selected.unanswered ?? 0),
    from: merge.from,
    to: merge.to,
    messages: merge.total,
    sha256,
    sources: meta.sources,
    transcriptSha: merge.sha256,
    mergeWarning: request.mergeWarning === true,
    files: [
      { path: `${FILES.transcript}`, bytes: merge.bytes },
      { path: `${FILES.meta}`, bytes: (await statSafe(metaPath))?.size ?? 0 },
    ],
    diagnostics: selected.diagnostics,
  }
}

/**
 * Import one export path into one persona.
 *
 * When the export holds several conversations and the caller named none of
 * them, the import refuses instead of silently merging unrelated threads: the
 * caller must pass `sessions` (the ids from `reunion_inspect`) or set `all`.
 * `mode: "separate"` imports each conversation as its own persona instead.
 *
 * @param {object} request - import inputs.
 * @param {string} request.path - export file or extracted directory.
 * @param {string} request.displayName - persona display name.
 * @param {string} [request.slug] - target slug; derived from the name when omitted.
 * @param {string[]} [request.sessions] - conversation ids to merge; all only with `all`.
 * @param {boolean} [request.all] - explicitly merge every conversation into this persona.
 * @param {string} request.companionsRoot - resolved companions root.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} request.config - resolved config.
 * @param {'zh'|'en'} request.locale - output language recorded in meta.
 * @param {AbortSignal} [request.signal] - cancellation.
 * @returns {Promise<any>} import outcome for rendering.
 */
export async function importIntoCompanion(request) {
  const { path, displayName, companionsRoot, config, locale, signal } = request
  const slug = (request.slug === undefined || request.slug === null || request.slug === '')
    ? slugify(displayName)
    : request.slug
  const source = await openSource(path, config)
  try {
    const selected = await readSelectedConversations(source, config, request.sessions, signal)
    if (selected.missing.length > 0) throw new Error(`missing conversations: ${selected.missing.join(', ')}`)
    if (selected.sessions.length === 0) throw new Error('no conversation was selected')
    if (selected.sessions.length > 1 && request.sessions === undefined && request.all !== true) {
      const listed = selected.sessions.slice(0, 10)
        .map(session => `${session.id}${session.title === null ? '' : ` "${session.title}"`} (${session.messages.length})`)
        .join(', ')
      throw new Error(
        `this export holds ${selected.sessions.length} conversations: ${listed}${selected.sessions.length > listed.length ? ', …' : ''}. `
        + 'Pass the ids to merge as `sessions`, or `all: true` to merge every conversation into one persona, '
        + 'or use mode "separate" to import each conversation as its own persona.',
      )
    }
    const sha256 = await source.hash(signal)
    return await writeCompanion({
      companionsRoot,
      slug,
      displayName,
      selected,
      path,
      size: source.bytes,
      sha256,
      config,
      locale,
      signal,
      mergeWarning: selected.sessions.length > 1 && request.all !== true,
    })
  } finally {
    await source.close()
  }
}

/**
 * Import one export with each conversation as its own persona, mirroring the
 * separate threads of the website. Slugs come from conversation titles and get
 * a numeric suffix when two titles collide; an already imported conversation is
 * reported as unchanged instead of merged.
 *
 * @param {object} request - separate import inputs.
 * @param {string} request.path - export file or extracted directory.
 * @param {string[]} [request.sessions] - conversation ids; every conversation when omitted.
 * @param {string} [request.name] - display name; only valid with one selected conversation.
 * @param {string} [request.slug] - slug; only valid with one selected conversation.
 * @param {string} request.companionsRoot - resolved companions root.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} request.config - resolved config.
 * @param {'zh'|'en'} request.locale - output language recorded in meta.
 * @param {AbortSignal} [request.signal] - cancellation.
 * @returns {Promise<any>} separate import summary.
 */
export async function importSeparate(request) {
  const { path, companionsRoot, config, locale, signal } = request
  const single = request.sessions !== undefined && request.sessions.length === 1
  const source = await openSource(path, config)
  try {
    const sha256 = await source.hash(signal)
    const personas = []
    let sessionsSeen = 0
    let skipped = 0
    const diagnostics = []

    /** Write one normalized conversation as its own persona. */
    const writeOne = async session => {
      sessionsSeen++
      skipped += (session.stats?.skippedFiltered ?? 0) + (session.stats?.unanswered ?? 0)
      if (session.messages.length === 0) return
      const title = typeof session.title === 'string' && session.title.trim() !== '' ? session.title.trim() : ''
      const displayName = single && typeof request.name === 'string' && request.name.trim() !== ''
        ? request.name.trim()
        : (title || session.id)
      const base = (single && typeof request.slug === 'string' && isSlug(request.slug)
        ? request.slug
        : slugify(title) || slugify(session.id))
      let slug = base.slice(0, 40)
      let suffix = 1
      let unchanged = null
      for (;;) {
        const existing = await readJsonIfExists(join(companionPath(companionsRoot, slug), FILES.meta))
        if (existing === null) break
        // Thread directories are a different shape; never report them as an
        // unchanged persona — pick the next free slug instead.
        if (existing.kind === 'thread') {
          slug = `${base.slice(0, 40)}-${suffix++}`
          continue
        }
        if (Array.isArray(existing.sources) && existing.sources.some(item => item.sha256 === sha256 && item.sessions?.some(entry => entry.id === session.id))) {
          unchanged = existing
          break
        }
        slug = `${base.slice(0, 40)}-${suffix++}`
      }
      if (unchanged !== null) {
        personas.push({ slug, displayName: unchanged.displayName ?? displayName, messages: unchanged.messages ?? 0, unchanged: true })
        return
      }
      const result = await writeCompanion({
        companionsRoot,
        slug,
        displayName,
        selected: { sessions: [session], skippedFiltered: session.stats?.skippedFiltered ?? 0, unanswered: session.stats?.unanswered ?? 0 },
        path,
        size: source.bytes,
        sha256,
        config,
        locale,
        signal,
      })
      personas.push({
        slug: result.slug,
        displayName: result.displayName,
        messages: result.messages,
        added: result.added,
        unchanged: result.unchanged,
        dir: result.dir,
      })
    }

    if (source.kind === 'zip' || source.kind === 'dir') {
      const exported = await openDeepseekExport(source, config)
      diagnostics.push(...exported.diagnostics)
      const wanted = request.sessions ?? exported.conversations.map(conversation => conversation.id)
      const known = new Set(exported.conversations.map(conversation => conversation.id))
      const missing = wanted.filter(id => !known.has(id))
      if (missing.length > 0) throw new Error(`missing conversations: ${missing.join(', ')}`)
      // One conversation at a time: a large export is never fully resident.
      for (const id of wanted) {
        const selected = await readSelectedConversations(source, config, [id], signal)
        diagnostics.push(...selected.diagnostics)
        const session = selected.sessions[0]
        if (session === undefined) continue
        await writeOne(session)
      }
    } else {
      const selected = await readSelectedConversations(source, config, request.sessions, signal)
      diagnostics.push(...selected.diagnostics)
      if (selected.missing.length > 0) throw new Error(`missing conversations: ${selected.missing.join(', ')}`)
      const usable = selected.sessions.filter(session => session.messages.length > 0)
      if (usable.length === 0) throw new Error('the selected conversations contain no usable messages')
      for (const session of usable) await writeOne(session)
    }
    if (personas.length === 0) throw new Error('the selected conversations contain no usable messages')
    return {
      separate: true,
      sessions: sessionsSeen,
      personas,
      skipped,
      sources: [{ path, sha256, size: source.bytes }],
      diagnostics,
    }
  } finally {
    await source.close()
  }
}

/**
 * Import exactly one conversation as a thread persona: the full archive plus a
 * deterministic THREAD.md brief, with no SOUL.md or MEMORY.md. This is the
 * "keep talking about the same problem" path for long threads that do not need
 * a character.
 *
 * @param {object} request - thread import inputs.
 * @param {string} request.path - export file or extracted directory.
 * @param {string[]} [request.sessions] - exactly one conversation id; required when the export holds several.
 * @param {string} [request.name] - thread display name; defaults to the conversation title.
 * @param {string} [request.slug] - directory slug.
 * @param {string} request.companionsRoot - resolved companions root.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} request.config - resolved config.
 * @param {'zh'|'en'} request.locale - output language recorded in meta.
 * @param {AbortSignal} [request.signal] - cancellation.
 * @param {typeof fetch} [request.fetch] - injectable fetch for DeepSeek share links.
 * @returns {Promise<any>} thread import outcome for rendering.
 */
export async function importThread(request) {
  const { path, companionsRoot, config, locale, signal } = request
  if (isShareRef(path)) {
    const loaded = await loadDeepseekShare(path, { fetch: request.fetch, signal, locale })
    return writeThreadImport({
      path: loaded.url,
      companionsRoot,
      config,
      locale,
      signal,
      displayNameOverride: request.name,
      slugOverride: request.slug,
      session: loaded.session,
      formatId: loaded.formatId,
      version: loaded.version,
      sha256: loaded.sha256,
      size: loaded.bytes,
      skippedFiltered: 0,
      unanswered: 0,
      diagnostics: loaded.diagnostics,
    })
  }
  const source = await openSource(path, config)
  try {
    const selected = await readSelectedConversations(source, config, request.sessions, signal)
    if (selected.missing.length > 0) throw new Error(`missing conversations: ${selected.missing.join(', ')}`)
    if (selected.sessions.length > 1) {
      const list = selected.sessions
        .slice(0, 8)
        .map(session => `${session.title ?? '(untitled)'} · ${session.id}`)
        .join(locale === 'en' ? '; ' : '；')
      throw new Error(t(locale === 'en' ? 'en' : 'zh', 'errors.threadNeedOneSession', {
        count: selected.sessions.length,
        list,
      }))
    }
    const session = selected.sessions[0]
    if (session === undefined || session.messages.length === 0) throw new Error('the selected conversation contains no usable messages')
    const sha256 = await source.hash(signal)
    return writeThreadImport({
      path,
      companionsRoot,
      config,
      locale,
      signal,
      displayNameOverride: request.name,
      slugOverride: request.slug,
      session,
      formatId: selected.formatId,
      version: selected.version,
      sha256,
      size: source.bytes,
      skippedFiltered: selected.skippedFiltered ?? 0,
      unanswered: selected.unanswered ?? 0,
      diagnostics: selected.diagnostics,
    })
  } finally {
    await source.close()
  }
}

/**
 * Shared write path for thread imports from a local export or a share link.
 * @param {object} request - normalized thread write inputs.
 * @returns {Promise<any>} thread import outcome.
 */
async function writeThreadImport(request) {
  const {
    path, companionsRoot, config, locale, signal, session, formatId, version, sha256, size,
    skippedFiltered, unanswered, diagnostics,
  } = request
  const title = typeof session.title === 'string' && session.title.trim() !== '' ? session.title.trim() : session.id
  const displayName = typeof request.displayNameOverride === 'string' && request.displayNameOverride.trim() !== ''
    ? request.displayNameOverride.trim()
    : title
  const slug = (request.slugOverride === undefined || request.slugOverride === null || request.slugOverride === '')
    ? slugify(displayName)
    : request.slugOverride
  if (!isSlug(slug)) throw new Error(`invalid thread slug: ${slug}`)
  const dir = companionPath(companionsRoot, slug)
  const metaPath = join(dir, FILES.meta)
  const existing = await readJsonIfExists(metaPath)
  if (existing !== null && existing.kind !== 'thread') throw new Error(`slug already used by a persona: ${slug}`)
  if (existing !== null && Array.isArray(existing.sources) && existing.sources.some(item => item.sha256 === sha256 && item.sessions?.some(entry => entry.id === session.id))) {
    return {
      unchanged: true,
      kind: 'thread',
      slug,
      displayName: existing.displayName ?? displayName,
      dir,
      messages: existing.messages ?? 0,
      briefChars: existing.brief?.chars ?? 0,
    }
  }
  await ensureDir(dir)
  const merge = await mergeIntoTranscript({
    file: join(dir, FILES.transcript),
    incoming: monotonicTimestamps(session.messages),
    maxMessages: config.maxMessages,
    signal,
  })
  const brief = await buildThreadBriefFromTranscript({
    transcriptPath: join(dir, FILES.transcript),
    title: existing?.displayName ?? displayName,
    locale,
    maxChars: config.threadBriefChars,
  })
  const times = session.messages.map(message => message.ts).filter(ts => ts !== null)
  const importedAt = new Date().toISOString()
  const sourceRecord = {
    path,
    kind: formatId,
    version,
    size,
    sha256,
    importedAt,
    sessions: [{
      id: session.id,
      title: session.title,
      messages: session.messages.length,
      from: times.length > 0 ? times.reduce((min, value) => (value < min ? value : min), Number.POSITIVE_INFINITY) : null,
      to: times.length > 0 ? times.reduce((max, value) => (value > max ? value : max), Number.NEGATIVE_INFINITY) : null,
    }],
  }
  const previousSources = Array.isArray(existing?.sources) ? existing.sources : []
  const meta = {
    ...(existing ?? {}),
    schema: 1,
    kind: 'thread',
    slug,
    displayName: existing?.displayName ?? displayName,
    userNickname: '',
    locale: existing?.locale ?? locale,
    createdAt: existing?.createdAt ?? importedAt,
    updatedAt: importedAt,
    sources: [...previousSources, sourceRecord].slice(-20),
    messages: merge.total,
    users: merge.users,
    turns: merge.turns,
    timeRange: { from: merge.from, to: merge.to },
    transcript: { path: FILES.transcript, bytes: merge.bytes, sha256: merge.sha256, lines: merge.total },
    brief: { path: FILES.thread, chars: brief.stats.chars, builtAt: importedAt },
    budget: null,
    distill: null,
  }
  const written = await writeThread(companionsRoot, slug, { brief: brief.text, meta })
  return {
    unchanged: false,
    kind: 'thread',
    slug,
    displayName: meta.displayName,
    dir,
    messages: merge.total,
    read: session.messages.length,
    added: merge.added,
    duplicates: merge.duplicates,
    skipped: skippedFiltered + unanswered,
    from: merge.from,
    to: merge.to,
    briefChars: brief.stats.chars,
    files: [
      { path: FILES.transcript, bytes: merge.bytes },
      { path: FILES.thread, bytes: (await statSafe(written.briefPath))?.size ?? 0 },
      { path: FILES.meta, bytes: (await statSafe(written.metaPath))?.size ?? 0 },
    ],
    sha256,
    sources: meta.sources,
    diagnostics,
  }
}

/**
 * Read one conversation from an export without importing it.
 * @param {object} request - read inputs.
 * @param {string} request.path - export file or extracted directory.
 * @param {string} request.session - conversation id.
 * @param {number} [request.offset] - first message index.
 * @param {number} [request.limit] - number of messages.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} request.config - resolved config.
 * @param {AbortSignal} [request.signal] - cancellation.
 * @returns {Promise<any>} paged conversation.
 */
export async function readExportSession(request) {
  const { path, config, signal } = request
  const offset = Math.max(0, Number.isInteger(request.offset) ? request.offset : 0)
  const limit = Math.min(100, Math.max(1, Number.isInteger(request.limit) ? request.limit : 20))
  const source = await openSource(path, config)
  try {
    const selected = await readSelectedConversations(source, config, [request.session], signal)
    if (selected.missing.length > 0) throw new Error(`missing conversations: ${selected.missing.join(', ')}`)
    const session = selected.sessions[0]
    if (session === undefined) throw new Error(`missing conversations: ${request.session}`)
    const messages = session.messages.slice(offset, offset + limit).map(message => ({
      role: message.role,
      ts: message.ts,
      text: message.content.length > 800 ? `${message.content.slice(0, 800)}…` : message.content,
    }))
    return {
      session: session.id,
      title: session.title,
      total: session.messages.length,
      offset,
      limit,
      messages,
    }
  } finally {
    await source.close()
  }
}
