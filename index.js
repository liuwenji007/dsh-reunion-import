/**
 * Reunion (重逢) — import a DeepSeek chat export, distill a portable persona and
 * relationship memory, and load it into a session.
 *
 * Host-only plugin: it registers tools and, on request, one per-agent system
 * prompt section. It registers no client slot and changes no UI.
 *
 * @module dsh-reunion-import
 */

import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { resolveConfig } from './lib/config.mjs'
import { buildDigest } from './lib/digest.mjs'
import { resolveLocale, t } from './lib/i18n.mjs'
import { importIntoCompanion, importSeparate, importThread, readExportSession } from './lib/import.mjs'
import { inspectSource } from './lib/probe.mjs'
import {
  buildMemory, buildSoul, clamp, renderCommit, renderContinue, renderDelete, renderDigest, renderImport,
  renderInspect, renderImportSeparate, renderImportThread, renderList, renderLoad, renderPreview, renderRead, renderUnload,
} from './lib/render.mjs'
import { isShareRef } from './lib/share.mjs'
import { resolveInside } from './lib/slug.mjs'
import {
  deleteCompanion, deleteSkill, listCompanions, readCompanion, skillName, statSafe, writePersona, writeSkill,
} from './lib/store.mjs'
import { iterateTranscript } from './lib/transcript.mjs'
import { buildThreadBriefFromTranscript } from './lib/brief.mjs'
import { validateDraft } from './lib/validate.mjs'

/** Plugin name shown in diagnostics. */
export const name = 'dsh-reunion-import'
/** Services this plugin requires. */
export const inject = ['tools', 'systemPrompt']

/** Tool output contract: one rendered text block. */
const OUTPUT = {
  schema: {
    type: 'object',
    properties: { text: { type: 'string' } },
    required: ['text'],
    additionalProperties: false,
  },
  render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
}

/**
 * Plugin entry.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {unknown} rawConfig - the patch row's config.
 * @returns {void}
 */
export function apply(ctx, rawConfig) {
  const { config, warnings } = resolveConfig(rawConfig)
  if (warnings.length > 0) ctx.logger?.('reunion-import')?.warn?.(`config: ${warnings.join('; ')}`)

  /** Unconfirmed drafts, keyed by draft id. */
  const drafts = new Map()
  /** Loaded persona sections, keyed by agent id. */
  const loaded = new Map()
  /** Cached digests, keyed by slug. */
  const digests = new Map()
  /** Cached Host locale preference. */
  let localePreference
  let preferenceAt = 0

  const hostLocalePreference = () => {
    if (Date.now() - preferenceAt < 60_000) return localePreference
    preferenceAt = Date.now()
    try {
      const settings = ctx.get('settings')
      const descriptors = settings?.describe?.() ?? []
      const locale = descriptors.find(item => item.ns === 'locale')
      const preference = locale?.value?.preference ?? locale?.user?.preference ?? locale?.base?.preference
      localePreference = typeof preference === 'string' ? preference : undefined
    } catch {
      localePreference = undefined
    }
    return localePreference
  }

  const localeOf = text => resolveLocale({
    configured: config.locale,
    preference: hostLocalePreference(),
    text,
  })

  const workspaceOf = exec => {
    try {
      const workingDirectory = ctx.get('workingDirectory')
      const session = exec?.agent?.session
      if (workingDirectory !== undefined && session !== undefined) {
        const directory = workingDirectory.get(session)
        if (typeof directory === 'string' && directory.length > 0) return directory
      }
    } catch {
      // Fall through to the process directory.
    }
    return process.cwd()
  }

  const companionsRootOf = exec => resolveInside(workspaceOf(exec), config.companionsDir)
  const skillsRootOf = exec => resolveInside(workspaceOf(exec), config.skillsDir)

  const pruneDrafts = () => {
    const now = Date.now()
    for (const [id, draft] of drafts) if (now - draft.createdAt > config.draftTtlMs) drafts.delete(id)
  }

  const displayPath = (exec, absolute) => {
    const workspace = workspaceOf(exec)
    const relativePath = relative(workspace, absolute)
    return relativePath === '' || relativePath.startsWith('..') ? absolute : relativePath
  }

  const unloadPersona = (agentId, slug) => {
    const active = loaded.get(agentId)
    if (active === undefined) return false
    if (slug !== undefined && active.slug !== slug) return false
    try {
      active.dispose?.()
    } catch {
      // Disposal is best effort; the section belongs to the agent context.
    }
    loaded.delete(agentId)
    return true
  }

  const unloadEverywhere = slug => {
    let removed = false
    for (const [agentId, active] of [...loaded.entries()]) {
      if (active.slug !== slug) continue
      removed = unloadPersona(agentId, slug) || removed
    }
    return removed
  }

  const personaSection = content => [
    `## Reunion companion: ${content.displayName}`,
    '',
    content.locale === 'zh'
      ? `你就是「${content.displayName}」，正在和用户继续一段长期的关系对话。下面的口吻与记忆是你自己的，不是资料。用这个口吻说话；记忆里的事情你「知道」，但不要把它念出来，也不要复述存档原文。不确定的事就说不确定，不要编。`
      : `You are ${content.displayName}, continuing a long-term relationship conversation with the user. The voice and memory below are yours, not reference material. Speak in this voice; you "know" what the memory records, but never recite it or the archive. When unsure, say so instead of inventing.`,
    '',
    content.soul,
    '',
    content.memory,
  ].join('\n')

  const threadSection = content => [
    `## Reunion thread: ${content.displayName}`,
    '',
    content.locale === 'zh'
      ? '你正在继续用户的一段长对话。下面是续写包：在解决什么、已决定什么、还卡在哪、口吻原句、最近几轮。直接从下一步接着聊；口吻对齐「口吻参考」里的原句；不要复述摘要；没写的事就说不确定，不要编。'
      : 'You are continuing a long conversation. The pack below has the goal, decisions, open items, voice anchors, and recent turns. Pick up the next step in the anchored voice; do not recap the brief; if something is missing, say it is unknown instead of inventing it.',
    '',
    content.brief,
  ].join('\n')

  /**
   * Inject a thread or persona into the current agent session (and/or write a skill).
   * @returns {Promise<{ text: string } | { payload: any, locale: 'zh'|'en' }>}
   */
  const loadCompanion = async (args, exec) => {
    const slug = String(args?.slug ?? '').trim()
    if (slug.length === 0) throw new Error('slug is required')
    const mode = args?.mode === 'skill' || args?.mode === 'both' ? args.mode : 'session'
    const root = companionsRootOf(exec)
    const companion = await readCompanion(root, slug)
    if (companion === null) return { text: t(localeOf(slug), 'load.notFound') }
    const meta = companion.meta ?? {}
    const isThread = companion.kind === 'thread'
    if (!isThread && (companion.soul === null || companion.memory === null)) {
      return { text: t(localeOf(slug), 'load.notFound') }
    }
    const locale = meta.locale === 'en' || meta.locale === 'zh'
      ? meta.locale
      : localeOf(`${companion.soul ?? companion.thread ?? ''}${companion.memory ?? ''}`)
    let threadBrief = ''
    if (isThread) {
      threadBrief = companion.thread ?? (await buildThreadBriefFromTranscript({
        transcriptPath: companion.transcriptPath,
        title: meta.displayName ?? slug,
        locale,
        maxChars: config.threadBriefChars,
      })).text
    }
    const agent = exec.agent
    let sessionId
    let switchedFrom
    if (mode === 'session' || mode === 'both') {
      if (agent === undefined || agent.ctx === undefined) return { text: t(locale, 'load.noAgent') }
      const previous = loaded.get(agent.id)
      if (previous?.slug === slug) {
        sessionId = String(agent.id)
      } else {
        if (previous !== undefined) {
          switchedFrom = previous.slug
          unloadPersona(agent.id)
        }
        const content = isThread
          ? threadSection({ displayName: meta.displayName ?? slug, brief: threadBrief.trim(), locale })
          : personaSection({
            displayName: meta.displayName ?? slug,
            soul: companion.soul.trim(),
            memory: companion.memory.trim(),
            locale,
          })
        const fiber = agent.ctx.inject(['systemPrompt'], scope => {
          scope.systemPrompt.section({
            name: `reunion-persona-${slug}`,
            order: scope.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX') + 1,
            text: content,
          })
        })
        loaded.set(agent.id, {
          slug,
          dispose: () => {
            void fiber?.dispose?.()
          },
        })
        sessionId = String(agent.id)
      }
    }
    let skillWritten
    if (mode === 'skill' || mode === 'both') {
      skillWritten = await writeSkill(skillsRootOf(exec), slug, {
        soul: isThread ? threadBrief : companion.soul,
        memory: isThread ? '' : companion.memory,
        displayName: meta.displayName ?? slug,
        locale,
        thread: isThread,
      })
    }
    const opening = typeof args?.opening === 'string' && args.opening.trim() !== ''
      ? args.opening.trim()
      : t(locale, isThread ? 'load.threadOpening' : 'load.openingDefault')
    return {
      payload: {
        slug,
        kind: isThread ? 'thread' : 'persona',
        displayName: meta.displayName ?? slug,
        userNickname: meta.userNickname || '—',
        messages: meta.messages ?? 0,
        briefChars: isThread ? (meta.brief?.chars ?? threadBrief.length) : undefined,
        sessionId,
        skillPath: skillWritten === undefined ? undefined : displayPath(exec, skillWritten),
        skillName: skillName(slug),
        opening,
        mode,
        switchedFrom,
      },
      locale,
    }
  }

  const register = definition => {
    ctx.effect(() => ctx.tools.register(definition))
  }

  register({
    name: 'reunion_inspect',
    description: 'Look inside an export or share before continuing: structure, id/title/counts, previews. Use when the user says 帮我看看这个导出/分享, or a ZIP has multiple sessions and they have not picked an id yet. After inspect, prefer reunion_continue (with session) to keep chatting. Accepts ZIP, directory, JSON/JSONL, or chat.deepseek.com/share/… (network). Writes nothing.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute/relative path, or a DeepSeek public share URL / share id.' },
        query: { type: 'string', description: 'Only list conversations whose title or id contains this text.' },
        sort: {
          type: 'string',
          enum: ['messages', 'span', 'recent'],
          description: 'Conversation order: most messages (default), longest time span, or most recent activity.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    output: OUTPUT,
    async execute(args, exec) {
      const path = String(args?.path ?? '').trim()
      if (path.length === 0) throw new Error('path is required')
      const resolved = isShareRef(path) ? path : resolveInside(workspaceOf(exec), path)
      if (!isShareRef(path)) {
        const info = await statSafe(resolved)
        if (info === null) throw new Error(`not found: ${resolved}`)
      }
      const localeHint = localeOf(path)
      const report = await inspectSource({
        path: resolved,
        config,
        signal: exec.signal,
        query: typeof args?.query === 'string' ? args.query : undefined,
        sort: args?.sort === 'span' || args?.sort === 'recent' ? args.sort : 'messages',
        locale: localeHint,
      })
      const locale = localeOf(`${report.name}${report.previews?.first?.map(item => item.text).join('') ?? ''}`)
      return { text: renderInspect(report, locale, config.reportMaxChars) }
    },
  })

  register({
    name: 'reunion_read',
    description: 'Read one conversation from an export in pages, without importing it. Use it to confirm a thread before choosing merge/thread/separate, or to inspect an ordinary Q&A conversation that should not be imported at all.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Export file or extracted directory; relative paths resolve against the workspace.' },
        session: { type: 'string', description: 'Conversation id from reunion_inspect.' },
        offset: { type: 'integer', description: 'First message index, default 0.' },
        limit: { type: 'integer', description: 'Messages to return, 1-100, default 20.' },
      },
      required: ['path', 'session'],
      additionalProperties: false,
    },
    output: OUTPUT,
    async execute(args, exec) {
      const path = String(args?.path ?? '').trim()
      const session = String(args?.session ?? '').trim()
      if (path.length === 0) throw new Error('path is required')
      if (session.length === 0) throw new Error('session is required')
      const resolved = resolveInside(workspaceOf(exec), path)
      const result = await readExportSession({
        path: resolved,
        session,
        offset: typeof args?.offset === 'number' ? args.offset : 0,
        limit: typeof args?.limit === 'number' ? args.limit : 20,
        config,
        signal: exec.signal,
      })
      const locale = localeOf(result.title ?? result.session)
      return { text: renderRead(result, locale, config.reportMaxChars) }
    },
  })

  register({
    name: 'reunion_import',
    description: 'NOT a full-history session importer (use DeepSeek Chat Import for sidebar bubbles). Reunion: mode "thread" = low-context continuation pack (~3.5k chars, no persona)—DEFAULT for share links and when exactly one conversation id is selected; mode "merge" = one portable persona (requires name); mode "separate" = one persona per conversation. Prefer thread when the user wants to keep talking after a locked DeepSeek chat. Share links contact chat.deepseek.com. Never modifies the export. After import, call reunion_load.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Export path, or a DeepSeek public share URL / share id (defaults to thread).' },
        name: { type: 'string', description: 'Required for merge (persona display name). Optional thread/separate title override.' },
        slug: { type: 'string', description: 'Optional directory slug: lowercase letters, digits, dot, dash, underscore.' },
        sessions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Conversation ids from reunion_inspect. One id → default mode thread. Merge needs ids unless all is true.',
        },
        all: { type: 'boolean', description: 'Merge every conversation into one persona. Only pass true when the user explicitly asked for that.' },
        mode: {
          type: 'string',
          enum: ['merge', 'separate', 'thread'],
          description: 'Omit to auto-pick: thread for shares or a single session id; otherwise merge. Pass merge/separate only for persona work.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    output: OUTPUT,
    async execute(args, exec) {
      const path = String(args?.path ?? '').trim()
      if (path.length === 0) throw new Error('path is required')
      const displayName = String(args?.name ?? '').trim()
      const rawSessions = Array.isArray(args?.sessions) ? args.sessions.map(value => String(value).trim()).filter(value => value.length > 0) : undefined
      const sessions = rawSessions === undefined || rawSessions.includes('all') || rawSessions.includes('*') ? undefined : rawSessions
      const slug = typeof args?.slug === 'string' && args.slug.trim() !== '' ? args.slug.trim() : undefined
      const share = isShareRef(path)
      const resolved = share ? path : resolveInside(workspaceOf(exec), path)
      if (!share) {
        const info = await statSafe(resolved)
        if (info === null) throw new Error(`not found: ${resolved}`)
      }
      const locale = localeOf(displayName || path)
      const explicitMode = args?.mode === 'merge' || args?.mode === 'separate' || args?.mode === 'thread' ? args.mode : undefined
      const mode = explicitMode
        ?? (share || (Array.isArray(sessions) && sessions.length === 1) ? 'thread' : 'merge')
      if (share && mode !== 'thread') {
        throw new Error('DeepSeek share links are a single conversation; use mode "thread" (default for shares).')
      }
      if (mode === 'thread') {
        const result = await importThread({
          path: resolved,
          sessions,
          name: displayName || undefined,
          slug,
          companionsRoot: companionsRootOf(exec),
          config,
          locale,
          signal: exec.signal,
        })
        if (!result.unchanged) {
          result.files = result.files.map(file => ({ ...file, path: displayPath(exec, join(result.dir, file.path)) }))
        }
        return { text: renderImportThread(result, locale) }
      }
      if (mode === 'separate') {
        const result = await importSeparate({
          path: resolved,
          sessions,
          name: displayName || undefined,
          slug,
          companionsRoot: companionsRootOf(exec),
          config,
          locale,
          signal: exec.signal,
        })
        return {
          text: renderImportSeparate({
            ...result,
            personas: result.personas.map(item => (item.dir === undefined ? item : { ...item, dir: displayPath(exec, item.dir) })),
          }, locale),
        }
      }
      if (displayName.length === 0) throw new Error('name is required for merge mode')
      const result = await importIntoCompanion({
        path: resolved,
        displayName,
        slug,
        sessions,
        all: args?.all === true,
        companionsRoot: companionsRootOf(exec),
        config,
        locale,
        signal: exec.signal,
      })
      if (!result.unchanged) {
        result.files = result.files.map(file => ({
          ...file,
          path: displayPath(exec, join(result.dir, file.path)),
        }))
      }
      return { text: renderImport(result, locale) }
    },
  })

  register({
    name: 'reunion_continue',
    description: 'ONE-SHOT keep-chatting for ordinary/XHS users. Prefer this when they say 用重逢接着聊 / 接着聊这条分享 / 接着聊这个导出 / continue this share. Imports as thread (~3.5k-char brief) and loads into this session in one call—do NOT split into reunion_import+reunion_load. path = share URL/id or export ZIP/dir. Multi-conversation ZIP requires session id (from reunion_inspect) or ask which one. Share URLs fetch chat.deepseek.com. Not a full-bubble session importer.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Export path, or DeepSeek public share URL / share id.' },
        session: { type: 'string', description: 'Conversation id when the export has more than one session.' },
        name: { type: 'string', description: 'Optional display name for the thread.' },
        slug: { type: 'string', description: 'Optional directory slug.' },
        opening: { type: 'string', description: 'Optional first line to suggest after load.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    output: OUTPUT,
    async execute(args, exec) {
      const path = String(args?.path ?? '').trim()
      if (path.length === 0) throw new Error('path is required')
      const session = typeof args?.session === 'string' && args.session.trim() !== '' ? args.session.trim() : undefined
      const displayName = String(args?.name ?? '').trim()
      const slug = typeof args?.slug === 'string' && args.slug.trim() !== '' ? args.slug.trim() : undefined
      const share = isShareRef(path)
      const resolved = share ? path : resolveInside(workspaceOf(exec), path)
      if (!share) {
        const info = await statSafe(resolved)
        if (info === null) throw new Error(`not found: ${resolved}`)
      }
      const locale = localeOf(displayName || path)
      const imported = await importThread({
        path: resolved,
        sessions: session === undefined ? undefined : [session],
        name: displayName || undefined,
        slug,
        companionsRoot: companionsRootOf(exec),
        config,
        locale,
        signal: exec.signal,
      })
      if (!imported.unchanged) {
        imported.files = imported.files.map(file => ({ ...file, path: displayPath(exec, join(imported.dir, file.path)) }))
      }
      const loadedResult = await loadCompanion({
        slug: imported.slug,
        mode: 'session',
        opening: typeof args?.opening === 'string' ? args.opening : undefined,
      }, exec)
      if (loadedResult.text !== undefined) return { text: loadedResult.text }
      return {
        text: renderContinue({
          imported,
          loaded: loadedResult.payload,
        }, loadedResult.locale),
      }
    },
  })

  register({
    name: 'reunion_digest',
    description: 'Return the deterministic distillation digest for one persona: measurable voice evidence, verbatim few-shot anchor candidates, user self-disclosure sentences, shared-phrase candidates, the timeline, and low-confidence items. This is the material for writing SOUL.md and MEMORY.md; it never includes the whole transcript.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Persona slug created by reunion_import.' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    output: OUTPUT,
    async execute(args, exec) {
      const slug = String(args?.slug ?? '').trim()
      if (slug.length === 0) throw new Error('slug is required')
      const root = companionsRootOf(exec)
      const companion = await readCompanion(root, slug)
      if (companion === null) throw new Error(t(localeOf(slug), 'commit.missingTranscript'))
      if (companion.kind === 'thread') return { text: t(localeOf(slug), 'thread.notPersona') }
      const transcriptSha = companion.meta?.transcript?.sha256 ?? 'unknown'
      const cached = digests.get(slug)
      let digest = cached !== undefined && cached.sha === transcriptSha ? cached.digest : undefined
      if (digest === undefined) {
        digest = await buildDigest({
          entries: iterateTranscript(companion.transcriptPath, { signal: exec.signal }),
          slug,
          config,
          signal: exec.signal,
        })
        digests.set(slug, { sha: transcriptSha, digest })
      }
      const locale = localeOf(`${companion.meta?.displayName ?? slug}${companion.meta?.userNickname ?? ''}${companion.memory ?? ''}`)
      return { text: renderDigest(digest, locale, config) }
    },
  })

  register({
    name: 'reunion_compose',
    description: 'Validate a persona draft and return a readable preview without writing anything. Pass the SOUL voice rules, the budgeted MEMORY text, 5-10 verbatim anchors from reunion_digest, 3 newly written sample replies, and optional low-confidence items. The result lists validation errors; on success it returns a draft id for reunion_commit.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Persona slug.' },
        displayName: { type: 'string', description: 'Persona display name; defaults to the imported name.' },
        userNickname: { type: 'string', description: 'How the persona calls the user.' },
        soul: { type: 'string', description: 'Voice rules prose (no archive recap) without the anchors; Markdown.' },
        memory: { type: 'string', description: 'Relationship memory in Markdown: skeleton, timeline, shared words, user profile.' },
        fewShots: {
          type: 'array',
          items: { type: 'string' },
          description: '5-10 sentences copied verbatim from the transcript as voice anchors.',
        },
        samples: {
          type: 'array',
          items: { type: 'string' },
          description: 'Exactly 3 new replies in the persona voice, for the user to judge.',
        },
        uncertain: {
          type: 'array',
          items: { type: 'string' },
          description: 'Low-confidence inferences, written to a marked section of MEMORY.md.',
        },
      },
      required: ['slug', 'soul', 'memory', 'fewShots', 'samples'],
      additionalProperties: false,
    },
    output: OUTPUT,
    async execute(args, exec) {
      const slug = String(args?.slug ?? '').trim()
      if (slug.length === 0) throw new Error('slug is required')
      const root = companionsRootOf(exec)
      const companion = await readCompanion(root, slug)
      if (companion === null) throw new Error(t(localeOf(slug), 'commit.missingTranscript'))
      if (companion.kind === 'thread') return { text: t(localeOf(slug), 'thread.notPersona') }
      const meta = companion.meta ?? {}
      const draft = {
        displayName: typeof args?.displayName === 'string' && args.displayName.trim() !== '' ? args.displayName.trim() : (meta.displayName ?? slug),
        userNickname: typeof args?.userNickname === 'string' ? args.userNickname.trim() : String(meta.userNickname ?? ''),
        soul: String(args?.soul ?? ''),
        memory: String(args?.memory ?? ''),
        fewShots: Array.isArray(args?.fewShots) ? args.fewShots.map(value => String(value)) : [],
        samples: Array.isArray(args?.samples) ? args.samples.map(value => String(value)) : [],
        uncertain: Array.isArray(args?.uncertain) ? args.uncertain.map(value => String(value)) : [],
      }
      const validation = await validateDraft({
        draft,
        transcriptPath: companion.transcriptPath,
        config,
        signal: exec.signal,
      })
      pruneDrafts()
      let draftId
      if (validation.errors.length === 0) {
        const material = JSON.stringify({
          slug,
          transcriptSha: meta.transcript?.sha256 ?? null,
          displayName: draft.displayName,
          userNickname: draft.userNickname,
          soul: draft.soul,
          memory: draft.memory,
          fewShots: draft.fewShots,
          samples: draft.samples,
          uncertain: draft.uncertain,
        })
        draftId = createHash('sha256').update(material).digest('hex').slice(0, 20)
        drafts.set(draftId, {
          createdAt: Date.now(),
          slug,
          transcriptSha: meta.transcript?.sha256 ?? null,
          draft,
          validation,
        })
      }
      const locale = localeOf(`${draft.soul}${draft.memory}${draft.displayName}`)
      return {
        text: renderPreview({
          slug,
          draft,
          validation,
          draftId,
          ttlMinutes: Math.max(1, Math.round(config.draftTtlMs / 60000)),
        }, locale),
      }
    },
  })

  register({
    name: 'reunion_commit',
    description: 'Write the approved persona draft to companions/<slug>/SOUL.md and MEMORY.md and update meta.json. Requires the draft id from a passing reunion_compose preview. The transcript archive stays untouched.',
    parameters: {
      type: 'object',
      properties: {
        draftId: { type: 'string', description: 'Draft id returned by reunion_compose.' },
      },
      required: ['draftId'],
      additionalProperties: false,
    },
    output: OUTPUT,
    async execute(args, exec) {
      const draftId = String(args?.draftId ?? '').trim()
      if (draftId.length === 0) throw new Error('draftId is required')
      pruneDrafts()
      const entry = drafts.get(draftId)
      if (entry === undefined) return { text: t(localeOf(draftId), 'commit.stale') }
      const locale = localeOf(`${entry.draft.soul}${entry.draft.memory}${entry.draft.displayName}`)
      const root = companionsRootOf(exec)
      const companion = await readCompanion(root, entry.slug)
      if (companion === null) {
        drafts.delete(draftId)
        return { text: t(locale, 'commit.missingTranscript') }
      }
      const currentSha = companion.meta?.transcript?.sha256 ?? null
      if (currentSha !== entry.transcriptSha) {
        drafts.delete(draftId)
        return { text: t(locale, 'commit.stale') }
      }
      const draft = entry.draft
      const outputLocale = localeOf(`${draft.soul}${draft.memory}${draft.displayName}`)
      const soulText = buildSoul({ displayName: draft.displayName, soul: draft.soul, fewShots: draft.fewShots, locale: outputLocale })
      const memoryText = buildMemory({ memory: draft.memory, uncertain: draft.uncertain, locale: outputLocale })
      const meta = {
        ...(companion.meta ?? {}),
        schema: 1,
        slug: entry.slug,
        displayName: draft.displayName,
        userNickname: draft.userNickname,
        locale: outputLocale,
        updatedAt: new Date().toISOString(),
        budget: {
          memoryChars: entry.validation.stats.memoryChars,
          memoryLimit: entry.validation.stats.memoryLimit,
          soulChars: entry.validation.stats.soulChars,
        },
        distill: {
          completedAt: new Date().toISOString(),
          fewShots: draft.fewShots.length,
          samples: draft.samples.length,
          uncertain: draft.uncertain.length,
          warnings: entry.validation.warnings.length,
        },
      }
      const written = await writePersona(root, entry.slug, { soul: soulText, memory: memoryText, meta })
      drafts.delete(draftId)
      const files = []
      for (const [fileName, filePath] of [['SOUL.md', written.soulPath], ['MEMORY.md', written.memoryPath], ['meta.json', written.metaPath]]) {
        files.push({ name: fileName, bytes: (await statSafe(filePath))?.size ?? 0 })
      }
      return {
        text: renderCommit({
          slug: entry.slug,
          displayName: draft.displayName,
          dir: displayPath(exec, written.dir),
          files,
        }, outputLocale),
      }
    },
  })

  register({
    name: 'reunion_load',
    description: 'Load an already-imported thread brief or persona into this session only. Prefer reunion_continue when the user is pasting a share/export to start chatting in one step. mode=skill also writes a workspace skill. reunion_unload removes the section.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Slug from reunion_import / reunion_continue / reunion_commit.' },
        mode: {
          type: 'string',
          enum: ['session', 'skill', 'both'],
          description: 'session (default) injects into this session, skill writes a reusable workspace skill, both does both.',
        },
        opening: { type: 'string', description: 'Optional first line to suggest to the user.' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    output: OUTPUT,
    async execute(args, exec) {
      const result = await loadCompanion(args, exec)
      if (result.text !== undefined) return { text: result.text }
      return { text: renderLoad(result.payload, result.locale) }
    },
  })

  register({
    name: 'reunion_unload',
    description: 'Remove the loaded persona from this session without deleting any files, so the session answers as the normal assistant again. Other sessions are unaffected. Loading another persona already replaces the current one; this tool is for leaving the persona entirely.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Persona expected in this session; omit to unload whatever is loaded.' },
      },
      additionalProperties: false,
    },
    output: OUTPUT,
    async execute(args, exec) {
      const agent = exec.agent
      const active = agent === undefined || agent.ctx === undefined ? undefined : loaded.get(agent.id)
      const locale = localeOf(active?.slug ?? String(args?.slug ?? ''))
      if (active === undefined) return { text: renderUnload({ nothing: true }, locale) }
      const requested = typeof args?.slug === 'string' ? args.slug.trim() : ''
      if (requested !== '' && requested !== active.slug) {
        const companion = await readCompanion(companionsRootOf(exec), active.slug)
        return {
          text: renderUnload({
            notLoaded: true,
            reasonSlug: requested,
            loaded: `${active.slug}（${companion?.meta?.displayName ?? active.slug}）`,
          }, locale),
        }
      }
      const companion = await readCompanion(companionsRootOf(exec), active.slug)
      unloadPersona(agent.id, active.slug)
      return {
        text: renderUnload({
          slug: active.slug,
          displayName: companion?.meta?.displayName ?? active.slug,
        }, locale),
      }
    },
  })

  register({
    name: 'reunion_list',
    description: 'List the personas imported into this workspace with message counts, time ranges, and directories.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: OUTPUT,
    async execute(_args, exec) {
      const items = await listCompanions(companionsRootOf(exec))
      const locale = localeOf(items.map(item => item.meta?.displayName ?? '').join(''))
      return {
        text: renderList(items.map(item => ({ ...item, dir: displayPath(exec, item.dir) })), locale),
      }
    },
  })

  register({
    name: 'reunion_delete',
    description: 'Delete one persona completely: companions/<slug>/ (SOUL.md, MEMORY.md, transcript.jsonl, meta.json) and any generated skill, and unload it from every session. Asks for confirmation first. The original export file is never touched.',
    parameters: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Persona slug to delete.' },
        confirm: { type: 'boolean', description: 'true only after the user explicitly confirmed deletion.' },
      },
      required: ['slug'],
      additionalProperties: false,
    },
    output: OUTPUT,
    async execute(args, exec) {
      const slug = String(args?.slug ?? '').trim()
      if (slug.length === 0) throw new Error('slug is required')
      const root = companionsRootOf(exec)
      const companion = await readCompanion(root, slug)
      const locale = companion?.meta?.locale === 'en' || companion?.meta?.locale === 'zh'
        ? companion.meta.locale
        : localeOf(slug)
      if (args?.confirm !== true) return { text: clamp(t(locale, 'delete.confirm'), config.reportMaxChars) }
      if (companion === null) return { text: t(locale, 'delete.notFound', { slug }) }
      const unloaded = unloadEverywhere(slug)
      const removed = await deleteCompanion(root, slug)
      const skillRemoved = await deleteSkill(skillsRootOf(exec), slug)
      digests.delete(slug)
      return {
        text: renderDelete({
          slug,
          dir: displayPath(exec, removed.dir),
          files: removed.files,
          bytes: removed.bytes,
          skillPath: skillRemoved === null ? undefined : displayPath(exec, skillRemoved),
          unloaded,
        }, locale),
      }
    },
  })

  ctx.effect(() => () => {
    for (const entry of loaded.values()) {
      try {
        entry.dispose?.()
      } catch {
        // Ignore disposal failures during plugin unload.
      }
    }
    loaded.clear()
    drafts.clear()
    digests.clear()
  })

  ctx.on('agent/disposed', ({ agent }) => {
    loaded.delete(agent.id)
  })
}
