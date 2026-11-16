/**
 * Markdown rendering of tool results and the persona documents themselves.
 *
 * Results are model-facing text: bounded, sectioned, and localized. The
 * document builders are the only place that decides the on-disk shape of
 * SOUL.md and MEMORY.md, so the appended "anchors" and "unconfirmed" sections
 * have one definition.
 *
 * @module dsh-reunion-import/render
 */

import { formatBytes, formatCount, formatDate, formatDateTime, t } from './i18n.mjs'

/**
 * Join lines, dropping empty ones between sections but keeping structure.
 * @param {Array<string | false | null | undefined>} lines - lines.
 * @returns {string} joined text.
 */
function lines(...parts) {
  return parts.flat().filter(part => typeof part === 'string' && part.length > 0).join('\n')
}

/**
 * Clamp rendered text to a character budget.
 * @param {string} text - rendered text.
 * @param {number} max - maximum characters.
 * @returns {string} clamped text.
 */
export function clamp(text, max) {
  if (typeof max !== 'number' || !Number.isFinite(max) || text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 20)).trimEnd()}\n…`
}

/**
 * Render validation items.
 * @param {{ code: string, detail?: string }[]} items - validation items.
 * @param {'zh'|'en'} locale - output language.
 * @returns {string[]} one line per item.
 */
export function renderValidationItems(items, locale) {
  return items.map(item => `- ${t(locale, `valid.${item.code}`, { detail: item.detail ?? '' })}`)
}

/**
 * Render the inspect report.
 * @param {any} report - probe report.
 * @param {'zh'|'en'} locale - output language.
 * @param {number} maxChars - output budget.
 * @returns {string} markdown report.
 */
export function renderInspect(report, locale, maxChars) {
  const formatId = report.format?.id ?? 'unknown'
  const formatValue = formatId === 'deepseek-chat-export'
    ? t(locale, 'inspect.formatValue.deepseek', { version: report.format.version ?? '3' })
    : formatId === 'deepseek-conversation'
      ? t(locale, 'inspect.formatValue.conversation')
      : formatId === 'generic'
        ? t(locale, 'inspect.formatValue.generic')
        : t(locale, 'inspect.formatValue.unknown')
  const kindValue = t(locale, `inspect.kindValue.${report.kind ?? 'unknown'}`)
  const totals = report.totals ?? {}
  const sections = [
    `# ${t(locale, 'inspect.title')} · ${report.name}`,
    lines(
      `- ${t(locale, 'inspect.file')}: ${report.path}`,
      `- ${t(locale, 'inspect.kind')}: ${kindValue} (${formatBytes(report.bytes ?? 0)})`,
      report.sha256 ? `- ${t(locale, 'inspect.hash')}: ${report.sha256}` : false,
      `- ${t(locale, 'inspect.format')}: ${formatValue}`,
      report.format?.layout?.entries !== undefined
        ? `- ${t(locale, 'inspect.layout')}: ${t(locale, 'inspect.layoutValue', {
          entries: report.format.layout.entries,
          manifest: t(locale, report.format.layout.manifest ? 'common.yes' : 'common.no'),
          index: t(locale, report.format.layout.index ? 'common.yes' : 'common.no'),
          conversations: report.format.layout.conversations?.length ?? report.format.layout.conversations ?? 0,
        })}`
        : false,
      `- ${t(locale, 'inspect.totals')}: ${t(locale, 'inspect.totalsValue', {
        sessions: formatCount(totals.sessions ?? 0),
        analyzed: formatCount(totals.analyzed ?? 0),
        messages: formatCount(totals.messages ?? 0),
        users: formatCount(totals.users ?? 0),
        assistants: formatCount(totals.assistants ?? 0),
        from: formatDate(totals.from),
        to: formatDate(totals.to),
      })}`,
    ),
  ]

  if (Array.isArray(report.fields) && report.fields.length > 0) {
    sections.push(lines(
      `## ${t(locale, 'inspect.fields')}`,
      report.fields.map(field => {
        if (field.scope === 'inferred') {
          if (field.kind === 'branch') return t(locale, 'inspect.branchFieldLine', { name: field.name })
          return t(locale, 'inspect.inferredFieldLine', {
            kind: field.kind ?? field.scope,
            name: field.name,
            count: formatCount(field.count ?? 0),
          })
        }
        return t(locale, 'inspect.fieldLine', { name: `${field.scope}.${field.name}`, meaning: t(locale, field.meaning) })
      }),
    ))
  }

  if (Array.isArray(report.fragmentTypes) && report.fragmentTypes.length > 0) {
    sections.push(lines(
      `## ${t(locale, 'inspect.fragments')}`,
      report.fragmentTypes.map(fragment => t(locale, 'inspect.fragmentLine', {
        type: fragment.type,
        count: formatCount(fragment.count),
        meaning: fragment.meaning === null ? t(locale, 'common.unknown') : t(locale, fragment.meaning),
      })),
    ))
  }

  if (Array.isArray(report.sessions) && report.sessions.length > 0) {
    const shown = report.sessions.slice(0, 20)
    sections.push(lines(
      `## ${t(locale, 'inspect.sessions')} (${formatCount(report.sessions.length)})`,
      shown.map((session, index) => {
        if (session.error !== undefined) {
          return t(locale, 'inspect.sessionError', { index: index + 1, id: session.id, error: session.error })
        }
        const values = {
          index: index + 1,
          title: session.title ?? session.id,
          messages: formatCount(session.messages ?? 0),
          from: formatDate(session.from),
          to: formatDate(session.to),
          branch: formatCount(session.branchMessages ?? 0),
          alternates: formatCount(session.alternateMessages ?? 0),
          id: String(session.id ?? '').slice(0, 48),
        }
        return session.alternateMessages > 0
          ? t(locale, 'inspect.sessionLineBranch', values)
          : t(locale, 'inspect.sessionLine', values)
      }),
      report.sessions.length > shown.length ? `… +${report.sessions.length - shown.length}` : false,
    ))
  }

  if (Array.isArray(report.sessions) && report.sessions.length > 0 && report.format?.id !== 'unknown') {
    const count = report.sessions.length
    sections.push(t(locale, count > 1 ? 'inspect.importHint' : 'inspect.singleSessionHint', { count }))
  }

  const previews = report.previews ?? { first: [], last: [] }
  const previewLines = []
  for (const [label, items] of [[t(locale, 'inspect.previewFirst'), previews.first], [t(locale, 'inspect.previewLast'), previews.last]]) {
    if (!Array.isArray(items) || items.length === 0) continue
    previewLines.push(label)
    for (const item of items) {
      previewLines.push(t(locale, 'inspect.previewLine', {
        role: item.role,
        time: formatDateTime(item.ts),
        text: item.text,
      }))
    }
  }
  if (previewLines.length > 0) sections.push(previewLines.join('\n'))

  if (Array.isArray(report.unknownFields) && report.unknownFields.length > 0) {
    sections.push(lines(
      `## ${t(locale, 'inspect.unknown')}`,
      report.unknownFields.map(field => `- ${field.scope}.${field.name}`),
    ))
  }

  if (Array.isArray(report.diagnostics) && report.diagnostics.length > 0) {
    const shown = report.diagnostics.slice(0, 12)
    sections.push(lines(
      `## ${t(locale, 'inspect.diagnostics')}`,
      shown.map(item => {
        const text = t(locale, `diag.${item.code}`, { detail: item.detail ?? '' })
        return `- [${item.level}] ${text === `diag.${item.code}` ? `${item.code}: ${item.detail ?? ''}` : text}`
      }),
      report.diagnostics.length > shown.length ? `… +${report.diagnostics.length - shown.length}` : false,
    ))
  }

  if ((totals.messages ?? 0) === 0) sections.push(t(locale, 'inspect.empty'))
  sections.push(`**${t(locale, 'common.next')}**: ${t(locale, 'inspect.nextHint')}`)
  return clamp(sections.join('\n\n'), maxChars)
}

/**
 * Render the distillation digest.
 * @param {any} digest - digest from `buildDigest`.
 * @param {'zh'|'en'} locale - output language.
 * @param {typeof import('./config.mjs').DEFAULT_CONFIG} config - resolved config.
 * @returns {string} markdown digest.
 */
export function renderDigest(digest, locale, config) {
  const stats = digest.stats ?? {}
  const assistant = stats.assistant ?? {}
  const voice = digest.voice ?? {}
  const sections = [
    `# ${t(locale, 'digest.title')} · ${digest.slug}`,
    t(locale, 'digest.scale', {
      messages: formatCount(digest.messages),
      users: formatCount(digest.counts?.user ?? 0),
      assistants: formatCount(digest.counts?.assistant ?? 0),
      from: formatDate(digest.from),
      to: formatDate(digest.to),
    }),
    lines(
      `## ${t(locale, 'digest.voice')}`,
      t(locale, 'digest.lengthLine', {
        median: assistant.median ?? 0,
        p90: assistant.p90 ?? 0,
        short: Math.round((assistant.shortRatio ?? 0) * 100),
        questions: Math.round((assistant.questionRatio ?? 0) * 100),
        advice: Math.round((assistant.adviceRatio ?? 0) * 100),
      }),
      t(locale, 'digest.particleDensity', { count: voice.particlesPer100 ?? 0 }),
      voice.endings?.length > 0 ? `${t(locale, 'digest.endings')}: ${voice.endings.map(item => `${item.value} ${item.count}`).join(' · ')}` : false,
      voice.punctuation?.length > 0 ? `${t(locale, 'digest.punctuation')}: ${voice.punctuation.map(item => `${item.value} ${item.count}`).join(' · ')}` : false,
      voice.openings?.length > 0 ? `${t(locale, 'digest.openings')}: ${voice.openings.map(item => `${item.value} ${item.count}`).join(' · ')}` : false,
      voice.addressTerms?.length > 0
        ? `${t(locale, 'digest.addresses')}: ${voice.addressTerms.map(item => `${item.term} ${item.count}${item.first && item.last && item.first !== item.last ? `（${formatDate(item.first)} → ${formatDate(item.last)}）` : ''}`).join(' · ')}`
        : false,
    ),
  ]

  if (digest.fewShots?.length > 0) {
    sections.push(lines(
      `## ${t(locale, 'digest.fewShots')}`,
      digest.fewShots.map((item, index) => t(locale, 'digest.fewShotLine', {
        index: index + 1,
        time: formatDate(item.ts),
        text: item.text,
      })),
    ))
  }

  if (digest.memory?.disclosures?.length > 0) {
    sections.push(lines(
      `## ${t(locale, 'digest.disclosures')}`,
      digest.memory.disclosures.slice(0, 25).map(item => t(locale, 'digest.disclosureLine', {
        time: formatDate(item.ts),
        kind: item.kind,
        text: item.text,
      })),
    ))
  }

  if (digest.memory?.sharedPhrases?.length > 0) {
    sections.push(lines(
      `## ${t(locale, 'digest.phrases')}`,
      digest.memory.sharedPhrases.slice(0, 15).map(item => t(locale, 'digest.phraseLine', {
        phrase: item.phrase,
        count: item.count,
        messages: item.messages,
      })),
    ))
  }

  const timeline = digest.memory?.timeline
  if (timeline !== undefined) {
    sections.push(lines(
      `## ${t(locale, 'digest.timeline')}`,
      timeline.months?.length > 0 ? timeline.months.map(month => `${month.month}: ${month.count}`).join(' · ') : false,
      timeline.gaps?.length > 0 ? `${t(locale, 'digest.gaps')}:\n${timeline.gaps.map(gap => t(locale, 'digest.gapLine', gap)).join('\n')}` : false,
    ))
  }

  if (digest.lowConfidence?.length > 0) {
    sections.push(lines(
      `## ${t(locale, 'digest.lowConfidence')}`,
      digest.lowConfidence.map(item => t(locale, 'digest.lowConfidenceLine', { value: item.value })),
    ))
  }

  const truncated = digest.truncated ?? {}
  if ((truncated.disclosures ?? 0) > 0 || (truncated.sharedPhrases ?? 0) > 0) {
    sections.push(t(locale, 'digest.truncated', { detail: `${truncated.disclosures ?? 0}/${truncated.sharedPhrases ?? 0}` }))
  }
  if ((digest.messages ?? 0) === 0) sections.push(t(locale, 'digest.empty'))
  sections.push(`**${t(locale, 'common.next')}**: ${t(locale, 'digest.nextHint', { limit: config.maxMemoryChars })}`)
  return sections.join('\n\n')
}

/**
 * Build SOUL.md: the model's voice rules plus the declared verbatim anchors.
 * @param {{ displayName: string, soul: string, fewShots: string[], locale: 'zh'|'en' }} content - draft content.
 * @returns {string} complete SOUL.md text.
 */
export function buildSoul(content) {
  const anchorTitle = content.locale === 'zh' ? '原句锚点（逐字来自存档）' : 'Voice anchors (verbatim from the archive)'
  return [
    `# ${content.displayName} · SOUL`,
    '',
    content.soul.trim(),
    '',
    `## ${anchorTitle}`,
    '',
    content.fewShots.map(quote => `> ${quote}`).join('\n'),
    '',
  ].join('\n')
}

/**
 * Build MEMORY.md: the model's memory text plus explicitly marked
 * low-confidence items, so an unverified inference can never pass as fact.
 * @param {{ memory: string, uncertain: string[], locale: 'zh'|'en' }} content - draft content.
 * @returns {string} complete MEMORY.md text.
 */
export function buildMemory(content) {
  const title = content.locale === 'zh' ? '待确认（置信度低）' : 'Unconfirmed (low confidence)'
  if (content.uncertain.length === 0) {
    return `${content.memory.trim()}\n`
  }
  return [
    content.memory.trim(),
    '',
    `## ${title}`,
    '',
    content.uncertain.map(item => `- ${item}`).join('\n'),
    '',
  ].join('\n')
}

/**
 * First meaningful lines of one document, without headings and bullets.
 * @param {string} text - markdown text.
 * @param {number} limit - maximum lines.
 * @returns {string[]} extracted lines.
 */
export function firstMeaningfulLines(text, limit) {
  return text
    .split(/\r?\n/u)
    .map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/u, '').trim())
    .filter(line => line.length > 0 && !line.startsWith('#') && !line.startsWith('>') && !line.startsWith('|'))
    .slice(0, limit)
}

/**
 * First bullet lines of one document.
 * @param {string} text - markdown text.
 * @param {number} limit - maximum lines.
 * @returns {string[]} bullet contents.
 */
export function firstBullets(text, limit) {
  return text
    .split(/\r?\n/u)
    .map(line => /^\s*[-*]\s+(.+)$/u.exec(line)?.[1]?.trim())
    .filter(item => typeof item === 'string' && item.length > 0 && !item.startsWith('#'))
    .slice(0, limit)
}

/**
 * Render the compose preview.
 * @param {any} preview - preview payload.
 * @param {'zh'|'en'} locale - output language.
 * @returns {string} markdown preview.
 */
export function renderPreview(preview, locale) {
  const { draft, validation, draftId, ttlMinutes } = preview
  const traits = firstMeaningfulLines(draft.soul, 5)
  const memoryItems = firstBullets(draft.memory, 3)
  const sections = [
    `# ${t(locale, 'compose.title')} · ${draft.displayName} (${preview.slug})`,
    `- ${t(locale, 'compose.budget')}: ${t(locale, 'compose.budgetLine', {
      memory: formatCount(validation.stats.memoryChars),
      limit: formatCount(validation.stats.memoryLimit),
      cjk: formatCount(validation.stats.memoryCjk),
      soul: formatCount(validation.stats.soulChars),
      anchors: validation.stats.fewShots,
      samples: validation.stats.samples,
    })}`,
    lines(`## ${t(locale, 'compose.voiceTraits')}`, traits.map((trait, index) => `${index + 1}. ${trait}`)),
    lines(`## ${t(locale, 'compose.memoryItems')}`, memoryItems.map((item, index) => `${index + 1}. ${item}`)),
    lines(`## ${t(locale, 'compose.samples')}`, draft.samples.map((sample, index) => t(locale, 'compose.sampleLine', { index: index + 1, text: sample }))),
  ]
  if (validation.errors.length === 0) {
    sections.push(`## ${t(locale, 'compose.validation')}: ${t(locale, 'compose.ok')}\n${t(locale, 'compose.checksPass')}`)
  } else {
    sections.push(lines(
      `## ${t(locale, 'compose.validation')}`,
      t(locale, 'compose.failed', { errors: validation.errors.length, warnings: validation.warnings.length }),
      `### ${t(locale, 'compose.errors')}`,
      renderValidationItems(validation.errors, locale),
      validation.warnings.length > 0 ? `### ${t(locale, 'compose.warnings')}` : false,
      renderValidationItems(validation.warnings, locale),
    ))
  }
  if (validation.warnings.length > 0 && validation.errors.length === 0) {
    sections.push([`### ${t(locale, 'compose.warnings')}`, ...renderValidationItems(validation.warnings, locale)].join('\n'))
  }
  if (validation.errors.length === 0 && draftId) {
    sections.push(`## ${t(locale, 'compose.draft')}: ${t(locale, 'compose.draftLine', { draftId, minutes: ttlMinutes })}`)
  }
  sections.push(`**${t(locale, 'common.next')}**: ${t(locale, 'compose.confirmHint')}`)
  return sections.join('\n\n')
}

/**
 * Render an import result.
 * @param {any} result - import outcome.
 * @param {'zh'|'en'} locale - output language.
 * @returns {string} markdown result.
 */
export function renderImport(result, locale) {
  if (result.unchanged === true) {
    return [`# ${t(locale, 'import.title')} · ${result.slug}`, t(locale, 'import.unchanged')].join('\n\n')
  }
  const summary = [
    `# ${t(locale, 'import.title')} · ${result.displayName} (${result.slug})`,
    lines(
      `- ${t(locale, 'import.sessions')}: ${formatCount(result.sessions)}`,
      `- ${t(locale, 'import.read')}: ${formatCount(result.read)} · ${t(locale, 'import.added')}: ${formatCount(result.added)} · ${t(locale, 'import.duplicates')}: ${formatCount(result.duplicates)} · ${t(locale, 'import.skipped')}: ${formatCount(result.skipped)}`,
      `- ${t(locale, 'import.timeRange')}: ${formatDate(result.from)} → ${formatDate(result.to)}`,
      result.existed ? `- ${t(locale, 'import.alreadyExists')}` : false,
    ),
  ]
  if (result.files?.length > 0) {
    summary.push(lines(`## ${t(locale, 'import.files')}`, result.files.map(file => t(locale, 'import.fileLine', {
      path: file.path,
      size: formatBytes(file.bytes),
    }))))
  }
  if (result.mergeWarning === true) {
    summary.push(t(locale, 'import.mergeWarn', { count: result.sessions }))
  }
  if (result.sources?.length > 0) {
    summary.push(lines(`## ${t(locale, 'import.sources')}`, result.sources.map(source => t(locale, 'import.sourcesLine', {
      path: source.path,
      hash: source.sha256,
    }))))
  }
  summary.push(t(locale, 'common.original'))
  summary.push(`**${t(locale, 'common.next')}**: ${t(locale, 'import.nextHint')}`)
  return summary.join('\n\n')
}

/**
 * Render a separate-mode import summary (one persona per conversation).
 * @param {any} result - separate import outcome.
 * @param {'zh'|'en'} locale - output language.
 * @returns {string} markdown result.
 */
export function renderImportSeparate(result, locale) {
  const created = result.personas.filter(item => item.unchanged !== true).length
  const existing = result.personas.length - created
  const shown = result.personas.slice(0, 30)
  return [
    `# ${t(locale, 'import.separateTitle')} (${result.personas.length})`,
    t(locale, 'import.separateSummary', { sessions: result.sessions, created, existing }),
    lines(
      `## ${t(locale, 'import.personas')}`,
      shown.map(item => t(locale, 'import.separateLine', {
        slug: item.slug,
        name: item.displayName,
        messages: formatCount(item.messages ?? 0),
        mark: item.unchanged === true ? t(locale, 'import.separateMark') : '',
      })),
      result.personas.length > shown.length ? `… +${result.personas.length - shown.length}` : false,
    ),
    result.skipped > 0 ? `- ${t(locale, 'import.skipped')}: ${formatCount(result.skipped)}` : false,
    t(locale, 'common.original'),
    `**${t(locale, 'common.next')}**: ${t(locale, 'import.nextHintSeparate')}`,
  ].filter(part => typeof part === 'string' && part.length > 0).join('\n\n')
}

/**
 * Render a commit result.
 * @param {any} result - commit outcome.
 * @param {'zh'|'en'} locale - output language.
 * @returns {string} markdown result.
 */
export function renderCommit(result, locale) {
  return [
    `# ${t(locale, 'commit.title')} · ${result.displayName} (${result.slug})`,
    t(locale, 'commit.written', { dir: result.dir }),
    lines(
      `## ${t(locale, 'import.files')}`,
      result.files.map(file => t(locale, 'commit.fileLine', { name: file.name, size: formatBytes(file.bytes) })),
    ),
    t(locale, 'common.original'),
    `**${t(locale, 'common.next')}**: ${t(locale, 'commit.nextHint')}`,
  ].join('\n\n')
}

/**
 * Render a load result.
 * @param {any} result - load outcome.
 * @param {'zh'|'en'} locale - output language.
 * @returns {string} markdown result.
 */
export function renderLoad(result, locale) {
  const sections = [
    `# ${t(locale, 'load.title')} · ${result.displayName} (${result.slug})`,
    lines(
      `- ${t(locale, 'load.metaLine', {
        displayName: result.displayName,
        userNickname: result.userNickname,
        messages: formatCount(result.messages),
      })}`,
      result.sessionId ? `- ${t(locale, 'load.session')}: ${t(locale, 'load.sessionLine', { id: result.sessionId })}` : false,
      result.skillPath ? `- ${t(locale, 'load.skill')}: ${t(locale, 'load.skillLine', { path: result.skillPath, name: result.skillName ?? result.slug })}` : false,
      result.opening ? `- ${t(locale, 'load.opening', { text: result.opening })}` : false,
    ),
  ]
  if (result.switchedFrom) sections.push(t(locale, 'load.switched', { previous: result.switchedFrom, slug: result.slug }))
  if (result.mode === 'both') sections.push(t(locale, 'load.both'))
  if (result.sessionId) sections.push(t(locale, 'load.scopeNote'))
  if (result.skillPath) sections.push(t(locale, 'load.skillNote'))
  sections.push(`**${t(locale, 'common.next')}**: ${t(locale, 'load.nextHint')}`)
  return sections.join('\n\n')
}

/**
 * Render an unload result.
 * @param {any} result - unload outcome.
 * @param {'zh'|'en'} locale - output language.
 * @returns {string} markdown result.
 */
export function renderUnload(result, locale) {
  if (result.nothing === true) {
    return [`# ${t(locale, 'unload.title')}`, t(locale, 'unload.nothing')].join('\n\n')
  }
  if (result.notLoaded === true) {
    return [
      `# ${t(locale, 'unload.title')}`,
      t(locale, 'unload.notLoaded', { slug: result.reasonSlug ?? '', loaded: result.loaded ?? t(locale, 'unload.noneLoaded') }),
    ].join('\n\n')
  }
  return [
    `# ${t(locale, 'unload.title')} · ${result.displayName ?? result.slug}`,
    t(locale, 'unload.done', { displayName: result.displayName ?? result.slug, slug: result.slug }),
    t(locale, 'unload.kept'),
    `**${t(locale, 'common.next')}**: ${t(locale, 'unload.nextHint')}`,
  ].join('\n\n')
}

/**
 * Render the persona list.
 * @param {{ slug: string, meta: any, complete: boolean, dir: string }[]} items - listed personas.
 * @param {'zh'|'en'} locale - output language.
 * @returns {string} markdown list.
 */
export function renderList(items, locale) {
  if (items.length === 0) return [`# ${t(locale, 'list.title')}`, t(locale, 'list.empty')].join('\n\n')
  return lines(
    `# ${t(locale, 'list.title')} (${t(locale, 'list.total', { count: items.length })})`,
    '',
    items.map(item => {
      if (!item.complete && item.meta === null) return t(locale, 'list.broken', { slug: item.slug })
      const meta = item.meta ?? {}
      return t(locale, 'list.line', {
        slug: item.slug,
        displayName: meta.displayName ?? item.slug,
        userNickname: meta.userNickname || '—',
        messages: formatCount(meta.messages ?? 0),
        from: formatDate(meta.timeRange?.from),
        to: formatDate(meta.timeRange?.to),
        dir: item.dir,
      })
    }),
  )
}

/**
 * Render a delete result.
 * @param {any} result - delete outcome.
 * @param {'zh'|'en'} locale - output language.
 * @returns {string} markdown result.
 */
export function renderDelete(result, locale) {
  return [
    `# ${t(locale, 'delete.title')} · ${result.slug}`,
    lines(
      `- ${t(locale, 'delete.filesLine', {
        dir: result.dir,
        files: result.files,
        bytes: formatBytes(result.bytes),
      })}`,
      result.skillPath ? t(locale, 'delete.skillRemoved', { path: result.skillPath }) : t(locale, 'delete.skillMissing'),
      result.unloaded ? t(locale, 'delete.unloaded') : false,
    ),
    t(locale, 'common.original'),
    `**${t(locale, 'common.next')}**: ${t(locale, 'delete.nextHint')}`,
  ].join('\n\n')
}
