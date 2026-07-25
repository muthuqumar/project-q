/**
 * lexical.js
 *
 * Step 4 (lexical half) — ranked keyword search via ripgrep, with a grep
 * fallback. Shared by the `search_code` agent tool and the hybrid semantic
 * search (as the lexical component of RRF fusion).
 */

const { execSync } = require('child_process')

const IGNORE = ['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.project-q', 'vendor', 'public', '__pycache__']

let _rg
function ripgrepAvailable() {
  if (_rg !== undefined) return _rg
  try { execSync('rg --version', { stdio: 'ignore', timeout: 3000 }); _rg = true } catch { _rg = false }
  return _rg
}

// Shell single-quote escape — safe against injection from tool inputs.
function shq(s) { return `'${String(s).replace(/'/g, `'\\''`)}'` }

/**
 * Raw line hits for a regex pattern. Returns [{ file, line, text }].
 */
function ripgrepSearch(pattern, projectDir, { glob, maxLines = 80, ignoreCase = true } = {}) {
  const results = []
  const ic = ignoreCase ? '-i' : ''
  let cmd
  if (ripgrepAvailable()) {
    const ex = IGNORE.map(d => `-g '!${d}/**'`).join(' ')
    const g = glob ? `-g ${shq(glob)}` : ''
    cmd = `rg -n --no-heading ${ic} ${ex} ${g} -e ${shq(pattern)} . 2>/dev/null | head -${maxLines}`
  } else {
    const ex = IGNORE.map(d => `--exclude-dir=${d}`).join(' ')
    const inc = glob ? `--include=${shq(glob)}` : ''
    cmd = `grep -rn ${ic} ${ex} ${inc} -e ${shq(pattern)} . 2>/dev/null | head -${maxLines}`
  }
  try {
    const out = execSync(cmd, { cwd: projectDir, encoding: 'utf8', timeout: 12000 })
    for (const line of out.split('\n')) {
      const m = line.match(/^(.*?):(\d+):(.*)$/)
      if (m) results.push({ file: m[1].replace(/^\.\//, ''), line: Number(m[2]), text: m[3].trim().slice(0, 200) })
    }
  } catch { /* no matches / tool error → empty */ }
  return results
}

/**
 * Ranked by number of matches per file (most relevant file first).
 * Returns [{ file, count, hits: [{line, text}] }].
 */
function rankedSearch(pattern, projectDir, opts = {}) {
  const hits = ripgrepSearch(pattern, projectDir, opts)
  const byFile = new Map()
  for (const h of hits) {
    if (!byFile.has(h.file)) byFile.set(h.file, [])
    byFile.get(h.file).push({ line: h.line, text: h.text })
  }
  return [...byFile.entries()]
    .map(([file, hs]) => ({ file, count: hs.length, hits: hs.slice(0, 5) }))
    .sort((a, b) => b.count - a.count)
}

// Salient identifier-ish terms from a natural-language query.
function termsFromQuery(query) {
  return [...new Set((String(query).match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) || []).map(s => s.toLowerCase()))].slice(0, 6)
}

/**
 * Lexical hits for a natural-language query — the keyword component of hybrid
 * search. Returns [{ file, startLine, endLine, text }].
 */
function lexicalHits(query, projectDir, { k = 12 } = {}) {
  const terms = termsFromQuery(query)
  if (!terms.length) return []
  const hits = ripgrepSearch(terms.join('|'), projectDir, { maxLines: 80 })
  return hits.slice(0, k).map(h => ({ file: h.file, startLine: h.line, endLine: h.line, text: h.text }))
}

module.exports = { ripgrepSearch, rankedSearch, lexicalHits, ripgrepAvailable, termsFromQuery }
