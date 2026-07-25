/**
 * seed-extract.js
 *
 * Step 1 of hybrid retrieval.
 *
 * Turns an upstream deliverable (scope.md, design.md, implementation-summary.md)
 * into a structured *retrieval seed* — the concrete list of files the NEXT agent
 * should retrieve, plus the intended action and any note.
 *
 * This is deliberately pure: string in, structured data out. No filesystem, no AI.
 * Nothing here is wired into the executor yet — it exists to be eyeballed and tested.
 *
 * The formats parsed here mirror exactly what the personas in registry.js emit:
 *
 *   scope.md               → "## Key Files Found"  (bulleted list)
 *   design.md              → "## Files to Change"  (markdown table)
 *   implementation-summary → "## What Was Done"    (loose prose; path scan fallback)
 */

// ── Path heuristics ─────────────────────────────────────────────────────────

// Extensions we treat as "this is a source file worth retrieving".
const CODE_EXT = new RegExp(
  '\\.(' +
  'js|jsx|ts|tsx|mjs|cjs|' +           // JS/TS
  'py|rb|go|rs|java|kt|scala|' +       // other backends
  'c|h|cc|cpp|hpp|cs|swift|' +         // systems
  'php|ex|exs|clj|' +                  // misc
  'json|ya?ml|toml|' +                 // config
  'md|css|scss|less|html|vue|svelte' + // docs / styles / templates
  ')$',
  'i'
)

// Strip markdown/quoting cruft around a path token.
function normalizePath(raw) {
  if (!raw) return ''
  return String(raw)
    .trim()
    .replace(/^[`'"*_]+/, '')        // leading backtick/quote/emphasis
    .replace(/[`'"*_]+$/, '')        // trailing backtick/quote/emphasis
    .replace(/^\.\//, '')            // leading ./
    .replace(/[.,;:)]+$/, '')        // trailing punctuation
    .trim()
}

// Does this token look like a file path (not prose)?
function looksLikePath(token) {
  const t = normalizePath(token)
  if (!t || /\s/.test(t)) return false          // paths don't contain spaces
  if (t.length > 200) return false
  const hasSlash = t.includes('/')
  const hasExt = CODE_EXT.test(t)
  return hasSlash || hasExt                      // a/b, or foo.ts, or a/b/foo.ts
}

// Pull the first path-like token out of an arbitrary string.
function firstPathIn(text) {
  if (!text) return null
  for (const tok of String(text).split(/[\s|]+/)) {
    if (looksLikePath(tok)) return normalizePath(tok)
  }
  return null
}

// ── Section slicing ─────────────────────────────────────────────────────────

/**
 * Extract the body of a markdown section by heading text (case-insensitive,
 * substring match). Returns the lines between that heading and the next heading
 * of the same-or-higher level. Returns '' if the heading is absent.
 */
function sectionBody(md, headingSubstr) {
  const lines = String(md || '').split('\n')
  const want = headingSubstr.toLowerCase()
  let start = -1
  let startLevel = 0

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/)
    if (m && m[2].toLowerCase().includes(want)) {
      start = i + 1
      startLevel = m[1].length
      break
    }
  }
  if (start === -1) return ''

  const out = []
  for (let i = start; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/)
    if (m && m[1].length <= startLevel) break   // next section of same/higher level
    out.push(lines[i])
  }
  return out.join('\n').trim()
}

// ── Action normalisation ──────────────────────────────────────────────────

const ACTION_WORDS = {
  create: 'create', add: 'create', new: 'create',
  modify: 'modify', change: 'modify', update: 'modify', edit: 'modify',
  delete: 'delete', remove: 'delete',
}

function normalizeAction(cell) {
  const t = (cell || '').toLowerCase()
  for (const [word, action] of Object.entries(ACTION_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(t)) return action  // word boundary, not substring
  }
  return null
}

/**
 * Given the non-path cells of a table row, pick the one that best represents the
 * *action*. When several cells contain an action word, prefer the shortest — a
 * bare "Add" beats a descriptive "wire new provider", leaving the latter as the note.
 */
function pickActionCell(cells) {
  const candidates = cells
    .filter(c => normalizeAction(c))
    .sort((a, b) => a.split(/\s+/).length - b.split(/\s+/).length)
  return candidates[0] || null
}

// ── design.md → "Files to Change" table ─────────────────────────────────────

/**
 * Parse the markdown table under "## Files to Change".
 * Expected header: | File | Action | What Changes |
 * Defensive about column order: the path cell is found via looksLikePath and the
 * action cell via keyword, so a reordered or extra-column table still parses.
 */
function parseFilesToChangeTable(md) {
  const body = sectionBody(md, 'files to change')
  if (!body) return []

  const rows = []
  for (const line of body.split('\n')) {
    if (!line.trim().startsWith('|')) continue           // table rows only
    const cells = line.split('|').map(c => c.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
    if (cells.length === 0) continue
    if (cells.every(c => /^:?-{2,}:?$/.test(c) || c === '')) continue  // separator row

    // Skip header row (contains the word "File" but no actual path).
    const pathCell = cells.find(looksLikePath)
    if (!pathCell) continue

    const file = normalizePath(pathCell)
    const actionCell = pickActionCell(cells.filter(c => c !== pathCell))
    const action = normalizeAction(actionCell || '') || null
    const note = cells.filter(c => c !== pathCell && c !== actionCell).join(' — ').trim()

    rows.push({ path: file, action, note: note || null })
  }
  return rows
}

// ── scope.md → "Key Files Found" list ────────────────────────────────────────

/**
 * Parse the bulleted list under "## Key Files Found".
 * Each line is expected to start with a path, e.g.
 *   - `server/foo.js` — does X
 *   * server/bar.js: does Y
 */
function parseKeyFilesFound(md) {
  const body = sectionBody(md, 'key files found')
  if (!body) return []

  const rows = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Accept bullets (-, *, +), numbered (1.), or bare lines, and table rows.
    const content = trimmed.replace(/^([-*+]|\d+\.)\s+/, '').replace(/^\|/, '').trim()
    const file = firstPathIn(content)
    if (!file) continue
    // Note = whatever follows the first em-dash / hyphen / colon after the path.
    const after = content.slice(content.indexOf(file) + file.length)
    const note = after.replace(/^[\s`'"|—:-]+/, '').replace(/[|`]/g, '').trim()
    rows.push({ path: file, action: null, note: note || null })
  }
  return rows
}

// ── Fallback: scan any prose for path-like tokens ────────────────────────────

/**
 * Last-resort extractor for unstructured docs (implementation-summary.md).
 * Scans the whole document for path-like tokens and dedupes.
 */
function scanForPaths(md) {
  const seen = new Set()
  const rows = []
  for (const tok of String(md || '').split(/[\s|]+/)) {
    if (!looksLikePath(tok)) continue
    const file = normalizePath(tok)
    if (file.endsWith('.md')) continue          // skip references to deliverables themselves
    if (seen.has(file)) continue
    seen.add(file)
    rows.push({ path: file, action: null, note: null })
  }
  return rows
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Extract a retrieval seed from a deliverable's markdown.
 *
 * @param {string} md      – the deliverable contents
 * @param {object} [opts]
 * @param {'design'|'scope'|'implementation'|'auto'} [opts.source='auto']
 * @returns {{ source: string, files: Array<{path,action,note}>, count: number }}
 */
function extractSeed(md, { source = 'auto' } = {}) {
  let files = []
  let resolved = source

  const tryDesign = () => parseFilesToChangeTable(md)
  const tryScope = () => parseKeyFilesFound(md)
  const tryScan = () => scanForPaths(md)

  if (source === 'design') files = tryDesign()
  else if (source === 'scope') files = tryScope()
  else if (source === 'implementation') files = tryScan()
  else {
    // auto: try structured parsers in order of precision, then fall back.
    files = tryDesign()
    if (files.length) resolved = 'design'
    else if ((files = tryScope()).length) resolved = 'scope'
    else { files = tryScan(); resolved = 'scan' }
  }

  // Dedupe by path, preferring rows that carry an action/note.
  const byPath = new Map()
  for (const row of files) {
    const existing = byPath.get(row.path)
    if (!existing) byPath.set(row.path, row)
    else {
      byPath.set(row.path, {
        path: row.path,
        action: existing.action || row.action,
        note: existing.note || row.note,
      })
    }
  }

  const deduped = [...byPath.values()]
  return { source: resolved, files: deduped, count: deduped.length }
}

module.exports = {
  extractSeed,
  parseFilesToChangeTable,
  parseKeyFilesFound,
  scanForPaths,
  // exported for testing / reuse by later retrieval steps
  looksLikePath,
  normalizePath,
  sectionBody,
}
