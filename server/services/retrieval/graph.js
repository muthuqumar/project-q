/**
 * graph.js
 *
 * Step 3a of hybrid retrieval: 1-hop dependency neighbours.
 *
 * Given a seed file, find:
 *   - imports    — files the seed depends on   (resolve its import/require specifiers)
 *   - importers  — files that depend on the seed (its blast radius)
 *
 * JS/TS only for v1 (ES import, CommonJS require, dynamic import). Bare/node_modules
 * specifiers are ignored — only intra-project relative edges are useful as context.
 * Everything here is best-effort and synchronous; callers treat failures as "no edge".
 */

const fs   = require('fs-extra')
const path = require('path')
const { execSync } = require('child_process')

const RESOLVE_EXTS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json']

// ── Specifier parsing ───────────────────────────────────────────────────────

function parseSpecifiers(src) {
  const specs = new Set()
  const patterns = [
    /import\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g, // import x from 'y' / import 'y'
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,               // require('y')
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,                // dynamic import('y')
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(src)) !== null) specs.add(m[1])
  }
  return [...specs]
}

// Resolve a relative specifier from `fromFile` to an existing file inside the project.
function resolveRelative(fromFile, spec, root) {
  if (!spec.startsWith('.')) return null            // bare specifier → node_modules, skip
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = []
  if (path.extname(base)) candidates.push(base)
  for (const ext of RESOLVE_EXTS) candidates.push(base + ext)
  for (const ext of RESOLVE_EXTS) candidates.push(path.join(base, 'index' + ext))
  for (const c of candidates) {
    if (!c.startsWith(root)) continue
    try { if (fs.statSync(c).isFile()) return c } catch {}
  }
  return null
}

// ── Edges ─────────────────────────────────────────────────────────────────

// Files the seed imports.
function importsOf(absFile, root) {
  let src
  try { src = fs.readFileSync(absFile, 'utf8') } catch { return [] }
  const out = new Set()
  for (const spec of parseSpecifiers(src)) {
    const resolved = resolveRelative(absFile, spec, root)
    if (resolved && resolved !== absFile) out.add(resolved)
  }
  return [...out]
}

// Files that import the seed. Fast candidate scan via grep on the basename, then
// precise verify by resolving each candidate's specifiers back to the seed.
function importersOf(absFile, root, cap = 25) {
  const baseNoExt = path.basename(absFile).replace(path.extname(absFile), '')
  if (!baseNoExt) return []

  let candidates = []
  try {
    const includes = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'].map(e => `--include=*.${e}`).join(' ')
    // Exclude vendored/built/generated dirs, else head-N fills with node_modules noise.
    const excludes = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.project-q', 'vendor', 'public', '__pycache__']
      .map(d => `--exclude-dir=${d}`).join(' ')
    const cmd = `grep -rIl ${includes} ${excludes} -e "${baseNoExt.replace(/"/g, '\\"')}" . 2>/dev/null | head -${cap}`
    candidates = execSync(cmd, { cwd: root, encoding: 'utf8', timeout: 8000 })
      .trim().split('\n').filter(Boolean)
  } catch { return [] }

  const out = []
  for (const rel of candidates) {
    const cand = path.resolve(root, rel)
    if (cand === absFile) continue
    if (importsOf(cand, root).includes(absFile)) out.push(cand)
  }
  return out
}

// ── Public: expand a set of seed files into 1-hop neighbours ─────────────────

/**
 * @param {string[]} seedAbsFiles  – absolute paths of seed files that exist
 * @param {object} opts
 * @param {string}  opts.projectDir
 * @param {number}  [opts.maxNeighbors=8]
 * @param {boolean} [opts.includeImporters=true]
 * @param {number}  [opts.maxSeedsForImporterScan=6]  – cap the expensive grep scans
 * @returns {Array<{path, relation:'imports'|'imported-by', via}>}  (paths relative to projectDir)
 */
function expandNeighbors(seedAbsFiles, {
  projectDir,
  maxNeighbors = 8,
  includeImporters = true,
  maxSeedsForImporterScan = 6,
} = {}) {
  const root = path.resolve(projectDir)
  const seedSet = new Set(seedAbsFiles.map(f => path.resolve(f)))
  const found = new Map() // abs → { relation, via }

  const add = (abs, relation, viaAbs) => {
    if (seedSet.has(abs) || found.has(abs)) return
    found.set(abs, { relation, via: path.relative(root, viaAbs) })
  }

  for (const seed of seedSet) {
    for (const dep of importsOf(seed, root)) add(dep, 'imports', seed)
  }
  if (includeImporters) {
    for (const seed of [...seedSet].slice(0, maxSeedsForImporterScan)) {
      for (const imp of importersOf(seed, root)) add(imp, 'imported-by', seed)
    }
  }

  return [...found.entries()]
    .slice(0, maxNeighbors)
    .map(([abs, meta]) => ({ path: path.relative(root, abs), ...meta }))
}

module.exports = { expandNeighbors, importsOf, importersOf, parseSpecifiers }
