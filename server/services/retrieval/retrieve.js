/**
 * retrieve.js
 *
 * Steps 2–3 of hybrid retrieval.
 *
 * Given an upstream deliverable (Q's design.md, Mallory's scope.md) or an explicit
 * file list (Moneypenny's git diff), load the relevant files' contents — and
 * optionally their 1-hop dependency neighbours — so the next agent starts with
 * them in hand instead of re-discovering them with blind tool rounds.
 *
 * Purely additive and fail-safe: on any error the caller falls back to the
 * existing tool-driven exploration.
 */

const fs   = require('fs-extra')
const path = require('path')
const { extractSeed }     = require('./seed-extract')
const { expandNeighbors } = require('./graph')

// Char budgets keep the injected block from blowing up the prompt.
// ~4 chars/token → 12k chars ≈ 3k tokens per file, 48k ≈ 12k tokens total.
const PER_FILE_CHAR_BUDGET = 12000
const TOTAL_CHAR_BUDGET    = 48000

// Neighbours are secondary context — deliberately smaller budgets.
const NEIGHBOR_PER_FILE_BUDGET = 5000
const NEIGHBOR_TOTAL_BUDGET    = 20000

// ── Core loader ─────────────────────────────────────────────────────────────

/**
 * Load a list of entries ({path, action?, note?, relation?, via?}) from disk under
 * a char budget. Returns loaded files, skipped entries (with reason), and chars used.
 */
async function loadEntries(entries, { projectDir, perFileBudget, totalBudget }) {
  const root = path.resolve(projectDir)
  const files = []
  const skipped = []
  let usedChars = 0

  for (const entry of entries) {
    const abs = path.resolve(root, entry.path)

    if (!abs.startsWith(root)) { skipped.push({ ...entry, reason: 'outside project' }); continue }

    let stat
    try {
      stat = await fs.stat(abs)
    } catch {
      skipped.push({ ...entry, reason: entry.action === 'create' ? 'to be created' : 'not found' })
      continue
    }
    if (!stat.isFile()) { skipped.push({ ...entry, reason: 'not a file' }); continue }
    if (usedChars >= totalBudget) { skipped.push({ ...entry, reason: 'budget exhausted' }); continue }

    let content
    try { content = await fs.readFile(abs, 'utf8') }
    catch (e) { skipped.push({ ...entry, reason: `read error: ${e.message}` }); continue }

    const origChars = content.length
    const cap = Math.min(perFileBudget, totalBudget - usedChars)
    const truncated = origChars > cap
    if (truncated) content = content.slice(0, cap)
    usedChars += content.length

    files.push({ ...entry, content, truncated, origChars })
  }

  return { files, skipped, usedChars }
}

// ── Deliverable-seeded retrieval (steps 2 + 3a) ──────────────────────────────

/**
 * Extract seed files from a deliverable, load them, and optionally expand +
 * load their 1-hop dependency neighbours.
 *
 * @param {string} deliverableMd
 * @param {object} opts
 * @param {string}  opts.projectDir
 * @param {'design'|'scope'|'implementation'|'auto'} [opts.source='auto']
 * @param {number}  [opts.perFileBudget] / [opts.totalBudget]
 * @param {boolean} [opts.neighbors=false]   – expand 1-hop dependency neighbours
 * @param {number}  [opts.maxNeighbors=8]
 * @returns {Promise<{source, files, neighbors, skipped, usedChars}>}
 */
async function retrieveSeedFiles(deliverableMd, {
  projectDir,
  source = 'auto',
  perFileBudget = PER_FILE_CHAR_BUDGET,
  totalBudget   = TOTAL_CHAR_BUDGET,
  neighbors     = false,
  maxNeighbors  = 8,
} = {}) {
  const seed = extractSeed(deliverableMd, { source })
  const primary = await loadEntries(seed.files, { projectDir, perFileBudget, totalBudget })

  let neighborFiles = []
  if (neighbors && primary.files.length) {
    try {
      const seedAbs = primary.files.map(f => path.resolve(projectDir, f.path))
      const neighborEntries = expandNeighbors(seedAbs, { projectDir, maxNeighbors })
      const loaded = await loadEntries(neighborEntries, {
        projectDir,
        perFileBudget: NEIGHBOR_PER_FILE_BUDGET,
        totalBudget: NEIGHBOR_TOTAL_BUDGET,
      })
      neighborFiles = loaded.files
    } catch { /* best-effort; no neighbours on failure */ }
  }

  return {
    source: seed.source,
    files: primary.files,
    neighbors: neighborFiles,
    skipped: primary.skipped,
    usedChars: primary.usedChars,
  }
}

// ── Explicit-list retrieval (step 3b: Moneypenny's changed files) ────────────

/**
 * Load an explicit list of files (e.g. the git diff of what James Bond changed).
 * @param {Array<{path, action?, note?}>} entries
 */
async function retrieveFileList(entries, {
  projectDir,
  perFileBudget = PER_FILE_CHAR_BUDGET,
  totalBudget   = TOTAL_CHAR_BUDGET,
} = {}) {
  const loaded = await loadEntries(entries, { projectDir, perFileBudget, totalBudget })
  return { source: 'explicit', files: loaded.files, neighbors: [], skipped: loaded.skipped, usedChars: loaded.usedChars }
}

// ── Formatting ───────────────────────────────────────────────────────────────

function renderFile(f) {
  const lang = path.extname(f.path).slice(1) || ''
  const rel = f.relation ? ` — _${f.relation}${f.via ? ` ${f.via}` : ''}_` : (f.action ? ` — _${f.action}_` : '')
  const out = [`### \`${f.path}\`${rel}`]
  if (f.note) out.push(`> ${f.note}`)
  out.push('```' + lang, f.content, '```')
  if (f.truncated) out.push(`_(truncated: showing first ${f.content.length} of ${f.origChars} chars — use read_file for the rest)_`)
  out.push('')
  return out
}

/**
 * Render a retrieval result as a markdown block for prompt injection.
 * framing: 'authoritative' (these are the files; don't re-read) | 'starting-points'
 * (a head start, keep exploring) | 'changed' (these changed; test them).
 */
function formatRetrievedBlock(result, { deliverableLabel = 'the design', framing = 'authoritative' } = {}) {
  if (!result) return ''
  const hasContent = result.files.length || (result.neighbors && result.neighbors.length) || result.skipped.length
  if (!hasContent) return ''

  const introByFraming = {
    authoritative: [
      `The current contents of the files this task targets are below. They were resolved`,
      `directly from ${deliverableLabel} — you do NOT need to search for or re-read these`,
      `unless a file is marked truncated and you need a section that was cut.`,
    ],
    'starting-points': [
      `The files below were flagged as relevant by ${deliverableLabel}, pre-loaded as a`,
      `head start. They are **starting points, not the full picture** — explore beyond them`,
      `if the design needs it. Files marked truncated show only their opening; use read_file`,
      `for the rest.`,
    ],
    changed: [
      `These are the files James Bond **actually changed** in this mission (from the working`,
      `tree), pre-loaded below. Test what is really here — it may differ from what the design`,
      `planned. Files marked truncated show only their opening; use read_file for the rest.`,
    ],
  }

  const parts = [
    `## Retrieved Files (pre-loaded from ${deliverableLabel})`,
    '',
    ...(introByFraming[framing] || introByFraming.authoritative),
    '',
  ]

  for (const f of result.files) parts.push(...renderFile(f))

  if (result.neighbors && result.neighbors.length) {
    parts.push(
      `### Related files (1-hop dependencies)`,
      `Files that import — or are imported by — the targets above. Useful for blast radius`,
      `and integration points; read only what's relevant.`,
      '',
    )
    for (const f of result.neighbors) parts.push(...renderFile(f))
  }

  const toCreate = result.skipped.filter(s => s.reason === 'to be created')
  const notFound = result.skipped.filter(s => s.reason === 'not found')
  if (toCreate.length) parts.push(`**To be created (do not exist yet):** ${toCreate.map(s => `\`${s.path}\``).join(', ')}`)
  if (notFound.length) parts.push(`**Referenced but not found (locate with search_code):** ${notFound.map(s => `\`${s.path}\``).join(', ')}`)

  return parts.join('\n').trim()
}

module.exports = {
  retrieveSeedFiles,
  retrieveFileList,
  formatRetrievedBlock,
  loadEntries,
  PER_FILE_CHAR_BUDGET,
  TOTAL_CHAR_BUDGET,
}
