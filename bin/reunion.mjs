#!/usr/bin/env node
/**
 * Standalone CLI for Reunion.
 *
 * `inspect` needs no model and writes nothing, so a user can look at a fresh
 * export before opening DSH. `import`, `list`, and `delete` share the exact
 * library code the Host tools use.
 *
 * @module dsh-reunion-import/cli
 */

import { relative } from 'node:path'
import { resolveConfig } from '../lib/config.mjs'
import { resolveLocale, t } from '../lib/i18n.mjs'
import { importIntoCompanion, importSeparate } from '../lib/import.mjs'
import { inspectSource } from '../lib/probe.mjs'
import { renderDelete, renderImport, renderImportSeparate, renderInspect, renderList } from '../lib/render.mjs'
import { resolveInside } from '../lib/slug.mjs'
import { deleteCompanion, deleteSkill, listCompanions, readCompanion } from '../lib/store.mjs'

/**
 * Parse `--flag value` and `--flag=value` options plus positional arguments.
 * @param {string[]} argv - arguments after the command.
 * @returns {{ positionals: string[], options: Record<string, string | boolean> }} parsed arguments.
 */
export function parseArgs(argv) {
  const positionals = []
  const options = {}
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (!argument.startsWith('--')) {
      positionals.push(argument)
      continue
    }
    const body = argument.slice(2)
    const equals = body.indexOf('=')
    if (equals !== -1) {
      options[body.slice(0, equals)] = body.slice(equals + 1)
      continue
    }
    const next = argv[index + 1]
    if (next !== undefined && !next.startsWith('--')) {
      options[body] = next
      index++
    } else {
      options[body] = true
    }
  }
  return { positionals, options }
}

/**
 * Run one CLI command.
 * @param {string[]} argv - process arguments after the executable.
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>} command result.
 */
export async function run(argv) {
  const [command, ...rest] = argv
  const { positionals, options } = parseArgs(rest)
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return { code: command === undefined ? 1 : 0, stdout: t('zh', 'cli.usage'), stderr: '' }
  }
  const config = resolveConfig({
    companionsDir: typeof options.companions === 'string' ? options.companions : 'companions',
  }).config
  const workspace = process.cwd()
  const companionsRoot = resolveInside(workspace, config.companionsDir)
  const skillsRoot = resolveInside(workspace, config.skillsDir)
  const display = absolute => {
    const path = relative(workspace, absolute)
    return path === '' || path.startsWith('..') ? absolute : path
  }

  if (command === 'inspect') {
    const target = positionals[0]
    if (target === undefined) return { code: 1, stdout: '', stderr: 'inspect needs a file or directory' }
    const report = await inspectSource({ path: resolveInside(workspace, target), config })
    const locale = resolveLocale({
      configured: 'auto',
      text: `${report.name}${report.previews?.first?.map(item => item.text).join('') ?? ''}`,
    })
    return {
      code: 0,
      stdout: options.json === true ? `${JSON.stringify(report, null, 2)}\n` : `${renderInspect(report, locale, config.reportMaxChars)}\n`,
      stderr: '',
    }
  }

  if (command === 'import') {
    const target = positionals[0]
    const name = typeof options.name === 'string' ? options.name : undefined
    if (target === undefined) return { code: 1, stdout: '', stderr: 'import needs a file or directory' }
    const sessions = typeof options.sessions === 'string'
      ? options.sessions.split(',').map(value => value.trim()).filter(value => value.length > 0)
      : undefined
    const locale = resolveLocale({ configured: 'auto', text: name ?? target })
    const mode = options.mode === 'separate' ? 'separate' : 'merge'
    if (mode === 'separate') {
      const result = await importSeparate({
        path: resolveInside(workspace, target),
        sessions,
        name,
        slug: typeof options.slug === 'string' ? options.slug : undefined,
        companionsRoot,
        config,
        locale,
      })
      return {
        code: 0,
        stdout: options.json === true ? `${JSON.stringify(result, null, 2)}\n` : `${renderImportSeparate({
          ...result,
          personas: result.personas.map(item => (item.dir === undefined ? item : { ...item, dir: display(item.dir) })),
        }, locale)}\n`,
        stderr: '',
      }
    }
    if (name === undefined) return { code: 1, stdout: '', stderr: 'import needs --name' }
    const result = await importIntoCompanion({
      path: resolveInside(workspace, target),
      displayName: name,
      slug: typeof options.slug === 'string' ? options.slug : undefined,
      sessions,
      all: options.all === true,
      companionsRoot,
      config,
      locale,
    })
    if (!result.unchanged) {
      result.files = result.files.map(file => ({ ...file, path: display(`${result.dir}/${file.path}`) }))
    }
    return {
      code: 0,
      stdout: options.json === true ? `${JSON.stringify(result, null, 2)}\n` : `${renderImport(result, locale)}\n`,
      stderr: '',
    }
  }

  if (command === 'list') {
    const items = await listCompanions(companionsRoot)
    const locale = resolveLocale({ configured: 'auto', text: items.map(item => item.meta?.displayName ?? '').join('') })
    return {
      code: 0,
      stdout: options.json === true
        ? `${JSON.stringify(items.map(item => ({ slug: item.slug, meta: item.meta, complete: item.complete })), null, 2)}\n`
        : `${renderList(items.map(item => ({ ...item, dir: display(item.dir) })), locale)}\n`,
      stderr: '',
    }
  }

  if (command === 'delete') {
    const slug = positionals[0]
    if (slug === undefined) return { code: 1, stdout: '', stderr: 'delete needs a slug' }
    const locale = resolveLocale({ configured: 'auto', text: slug })
    if (options.yes !== true) {
      return { code: 1, stdout: '', stderr: t(locale, 'delete.confirm') }
    }
    const companion = await readCompanion(companionsRoot, slug)
    if (companion === null) return { code: 1, stdout: '', stderr: t(locale, 'delete.notFound', { slug }) }
    const removed = await deleteCompanion(companionsRoot, slug)
    const skillRemoved = await deleteSkill(skillsRoot, slug)
    return {
      code: 0,
      stdout: `${renderDelete({
        slug,
        dir: display(removed.dir),
        files: removed.files,
        bytes: removed.bytes,
        skillPath: skillRemoved === null ? undefined : display(skillRemoved),
        unloaded: false,
      }, locale)}\n`,
      stderr: '',
    }
  }

  return { code: 1, stdout: '', stderr: t('zh', 'cli.unknownCommand', { command }) }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href
if (invokedDirectly) {
  try {
    const result = await run(process.argv.slice(2))
    if (result.stdout !== '') process.stdout.write(result.stdout)
    if (result.stderr !== '') process.stderr.write(`${result.stderr}\n`)
    process.exitCode = result.code
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
