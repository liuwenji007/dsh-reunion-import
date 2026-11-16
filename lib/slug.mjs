/**
 * Persona slugs and the workspace paths derived from them.
 *
 * A slug is the only user-supplied value that becomes a directory name, so it
 * is validated here before any path is built.
 *
 * @module dsh-reunion-import/slug
 */

import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'

/** Characters a slug may contain after its first character. */
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,47}$/u
/** Device names Windows reserves regardless of extension. */
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu

/**
 * Whether a string is an acceptable persona slug.
 * @param {unknown} value - candidate slug.
 * @returns {value is string} true for a safe directory-name slug.
 */
export function isSlug(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 48
    && value === value.toLowerCase()
    && SLUG.test(value)
    && !value.includes('..')
    && !value.startsWith('.')
    && !RESERVED.test(value)
}

/**
 * Create a slug from a human display name, keeping only ASCII letters, digits,
 * and dashes. Names written entirely in non-Latin script fall back to a short
 * content hash so two personas never collide.
 * @param {string} name - display name from the user or the export title.
 * @returns {string} a valid slug.
 */
export function slugify(name) {
  const slug = String(name ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^[-.]+|[-.]+$/gu, '')
    .slice(0, 48)
  if (slug.length > 0) return slug
  return `companion-${createHash('sha256').update(String(name ?? '')).digest('hex').slice(0, 8)}`
}

/**
 * Resolve a possibly relative path against the workspace root.
 * @param {string} root - workspace directory.
 * @param {string} value - absolute or relative path.
 * @returns {string} absolute path.
 */
export function resolveInside(root, value) {
  return isAbsolute(value) ? resolve(value) : resolve(root, value)
}

/**
 * Build the directory of one persona and refuse anything that escapes the
 * companions root.
 * @param {string} root - resolved companions root.
 * @param {string} slug - validated slug.
 * @returns {string} absolute persona directory.
 * @throws {Error} when the slug is invalid or the join escapes the root.
 */
export function companionPath(root, slug) {
  if (!isSlug(slug)) throw new Error(`invalid persona slug: ${String(slug)}`)
  const target = resolve(root, slug)
  const prefix = root.endsWith(sep) ? root : root + sep
  if (!target.startsWith(prefix)) throw new Error(`persona path escapes the companions directory: ${slug}`)
  return target
}

/**
 * Human-readable label of a directory, used in reports.
 * @param {string} path - any path.
 * @returns {string} the last path segment.
 */
export function labelOf(path) {
  return basename(path)
}
