/**
 * Plugin configuration: defaults, coercion, and range checks.
 *
 * The bundle declares no Config schema, so this module is the single owner of
 * every tunable. Values come from the patch row's `config`; unknown keys are
 * reported as warnings instead of being ignored silently.
 *
 * @module dsh-reunion-import/config
 */

/** Every tunable with its documented default. */
export const DEFAULT_CONFIG = Object.freeze({
  /** Directory holding one subdirectory per persona, relative to the workspace (or absolute). */
  companionsDir: 'companions',
  /** Directory, relative to the workspace, that receives generated persona skills. */
  skillsDir: '.dsh/skills',
  /** Output language: `auto`, `zh`, or `en`. `auto` follows the Host locale preference and environment. */
  locale: 'auto',
  /** Hard budget for MEMORY.md, counted as non-whitespace code points. */
  maxMemoryChars: 8000,
  /** Fewest verbatim voice anchors a SOUL draft may carry. */
  fewShotMin: 5,
  /** Most verbatim voice anchors a SOUL draft may carry. */
  fewShotMax: 10,
  /** Maximum characters of the distillation digest returned to the model. */
  digestMaxChars: 12000,
  /** Maximum uncompressed size of one archive entry read into memory. */
  maxEntryBytes: 64 * 1024 * 1024,
  /** Maximum size of a single JSON file walked without streaming. */
  maxJsonBytes: 128 * 1024 * 1024,
  /** Maximum accepted messages per persona transcript. */
  maxMessages: 300000,
  /** Character window used by the anti-verbatim guard. */
  verbatimWindow: 24,
  /** Maximum characters of one message preview in inspect output. */
  previewChars: 160,
  /** Maximum characters of one inspect report. */
  reportMaxChars: 12000,
  /** Lifetime of an unconfirmed distillation draft. */
  draftTtlMs: 3600000,
  /** Transcript characters indexed for the quote and anti-verbatim checks. */
  maxSearchChars: 16000000,
  /** Conversations inspect reads before reporting partial totals. */
  maxInspectSessions: 1000,
  /** Character budget of the thread brief injected by `mode: "thread"`. */
  threadBriefChars: 3500,
})

const INT_RANGES = Object.freeze({
  maxMemoryChars: [500, 40000],
  fewShotMin: [3, 10],
  fewShotMax: [3, 20],
  digestMaxChars: [2000, 60000],
  maxEntryBytes: [1024 * 1024, 1024 * 1024 * 1024],
  maxJsonBytes: [1024 * 1024, 4 * 1024 * 1024 * 1024],
  maxMessages: [100, 5000000],
  verbatimWindow: [8, 80],
  previewChars: [40, 2000],
  reportMaxChars: [2000, 60000],
  draftTtlMs: [60000, 86400000],
  maxSearchChars: [1000000, 200000000],
  maxInspectSessions: [1, 10000],
  threadBriefChars: [1500, 20000],
})

/**
 * Resolve user-supplied config against the defaults.
 * @param {unknown} raw - the patch row's `config` value.
 * @returns {{ config: typeof DEFAULT_CONFIG, warnings: string[] }} resolved values and coercion notes.
 */
export function resolveConfig(raw) {
  const warnings = []
  const config = { ...DEFAULT_CONFIG }
  if (raw === undefined || raw === null) return { config, warnings }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    warnings.push('config must be an object; using defaults')
    return { config, warnings }
  }
  const record = /** @type {Record<string, unknown>} */ (raw)
  for (const [key, value] of Object.entries(record)) {
    if (!(key in DEFAULT_CONFIG)) {
      warnings.push(`unknown config key "${key}" ignored`)
      continue
    }
    if (key in INT_RANGES) {
      const [min, max] = INT_RANGES[key]
      const number = typeof value === 'string' ? Number(value) : value
      if (typeof number !== 'number' || !Number.isFinite(number) || !Number.isInteger(number)) {
        warnings.push(`config.${key} must be an integer; using ${DEFAULT_CONFIG[key]}`)
        continue
      }
      if (number < min || number > max) {
        warnings.push(`config.${key} must be between ${min} and ${max}; using ${DEFAULT_CONFIG[key]}`)
        continue
      }
      config[key] = number
      continue
    }
    if (typeof DEFAULT_CONFIG[key] === 'string') {
      if (typeof value !== 'string') {
        warnings.push(`config.${key} must be a string; using ${DEFAULT_CONFIG[key]}`)
        continue
      }
      config[key] = value
      continue
    }
  }
  if (config.fewShotMax < config.fewShotMin) {
    warnings.push('config.fewShotMax is below config.fewShotMin; using defaults')
    config.fewShotMin = DEFAULT_CONFIG.fewShotMin
    config.fewShotMax = DEFAULT_CONFIG.fewShotMax
  }
  if (config.locale !== 'auto' && config.locale !== 'zh' && config.locale !== 'en') {
    warnings.push('config.locale must be auto, zh, or en; using auto')
    config.locale = 'auto'
  }
  return { config, warnings }
}
