/**
 * Agent Executor — runs a single mission step in full agentic mode.
 *
 * Agentic mode means Claude runs in the target project directory with full
 * tool access (Read, Write, Edit, Bash, Glob, Grep). It reads the files it
 * needs, makes changes directly, and optionally runs linters/tests.
 *
 * This replaces the old single-shot prompt + XML-parsing approach with a
 * real tool-use loop — matching the quality of Claude Code in the terminal.
 *
 * Each step:
 * 1. Ensures project context exists (auto-generates if missing)
 * 2. Builds a concise task prompt (CLAUDE.md provides all project context)
 * 3. Runs Claude in agentic mode — it reads/writes files natively
 * 4. Detects file changes via git status (no XML parsing required)
 * 5. Returns structured result with applied changes and summary
 */

const AIService = require('../ai')
const { getPersona } = require('./registry')
const { ensureProjectContext } = require('./context-guard')
const fs   = require('fs-extra')
const path = require('path')
const { execSync } = require('child_process')

// ── Change detection (git-based) ─────────────────────────────────────────────

/**
 * Snapshot the current working-tree state so we can diff it after Claude runs.
 * Tries git status first; falls back to file mtime map for projects without git.
 */
function snapshotWorkingTree(projectDir) {
  try {
    const out = execSync('git status --porcelain', {
      cwd: projectDir, encoding: 'utf8', timeout: 5000,
    }).trim()
    return { type: 'git', snapshot: out }
  } catch {
    return { type: 'mtime', snapshot: mtimeSnapshot(projectDir) }
  }
}

function detectChanges(before, projectDir) {
  const now = new Date().toISOString()

  if (before.type === 'git') {
    try {
      const out = execSync('git status --porcelain', {
        cwd: projectDir, encoding: 'utf8', timeout: 5000,
      }).trim()

      // Lines that weren't dirty before but are now
      const beforeLines = new Set(before.snapshot.split('\n').filter(Boolean))
      const afterLines  = out.split('\n').filter(Boolean)
      const newLines    = afterLines.filter(l => !beforeLines.has(l))

      return newLines.map(line => {
        const statusCode = line.slice(0, 2).trim()
        const filePath   = line.slice(3).trim().replace(/^"/, '').replace(/"$/, '')
        return { path: filePath, action: statusCode === 'D' ? 'delete' : 'write', appliedAt: now }
      })
    } catch { return [] }
  }

  // mtime fallback
  const afterSnapshot = mtimeSnapshot(projectDir)
  return diffMtimes(before.snapshot, afterSnapshot, projectDir, now)
}

// ── mtime fallback (projects without git) ────────────────────────────────────

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
  '.project-q', 'vendor', '__pycache__',
])

function mtimeSnapshot(projectDir) {
  const snapshot = {}
  const walk = (dir) => {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else snapshot[full] = fs.statSync(full).mtimeMs
      }
    } catch {}
  }
  walk(projectDir)
  return snapshot
}

function diffMtimes(before, after, projectDir, now) {
  const changes = []
  for (const [file, mtime] of Object.entries(after)) {
    const rel = path.relative(projectDir, file)
    if (!before[file])              changes.push({ path: rel, action: 'write',  appliedAt: now })
    else if (before[file] !== mtime) changes.push({ path: rel, action: 'write',  appliedAt: now })
  }
  for (const file of Object.keys(before)) {
    if (!after[file]) changes.push({ path: path.relative(projectDir, file), action: 'delete', appliedAt: now })
  }
  return changes
}

// ── Parse lightweight structured output from Claude's response ────────────────

function parseSummary(text) {
  const m = text.match(/<summary>([\s\S]*?)<\/summary>/)
  return m ? m[1].trim() : ''
}

function parseNeedsInfo(text) {
  const questions = []
  const regex = /<needs_info>([\s\S]*?)<\/needs_info>/g
  let match
  while ((match = regex.exec(text)) !== null) {
    const block    = match[1]
    const question = (block.match(/<question>([\s\S]*?)<\/question>/) || [])[1]?.trim()
    const context  = (block.match(/<context>([\s\S]*?)<\/context>/)   || [])[1]?.trim() || ''
    if (question) questions.push({ question, context })
  }
  return questions
}

// ── Build the task prompt ─────────────────────────────────────────────────────
//
// Intentionally lean. CLAUDE.md in the project directory (auto-synced by
// context-sync.js) already carries all architecture / tech-stack / convention
// context. We only inject the mission-specific delta here.

async function buildAgenticPrompt(step, mission, pqDir) {
  const persona = getPersona(step.agentId)

  const answeredQ = (mission.pendingQuestions || [])
    .filter(q => q.answer)
    .map(q => `Q: ${q.question}\nA: ${q.answer}`)
    .join('\n\n')

  return `${persona}

---

## Mission

**Task:** ${mission.taskTitle}
${mission.taskDescription ? `**Description:** ${mission.taskDescription}` : ''}

**Your sub-task:** ${step.subTask}

**Why you are involved:** ${step.rationale}

**Codebase evidence:** ${step.evidence}

${answeredQ ? `## Clarifications from user\n\n${answeredQ}\n` : ''}${step.assumptions?.length ? `## Assumed (flag if wrong)\n${step.assumptions.map(a => `- ${a}`).join('\n')}\n` : ''}
---

## How to proceed

You are running directly in the target project directory with full tool access.
CLAUDE.md (already loaded) contains the full project architecture, tech stack, and conventions.

1. **Explore first** — use Glob, Grep, Read to understand what already exists before writing a single line
2. **Implement** — use Edit and Write to make your changes; run Bash for lint/typecheck/tests if available
3. **Summarise** — wrap a brief summary of what you changed and why in \`<summary>...</summary>\`

If you genuinely cannot proceed without user input, output:
<needs_info>
  <question>your specific question</question>
  <context>why you need this</context>
</needs_info>

Do not proceed with implementation if you have an unresolvable blocker.`
}

// ── Main execute function ─────────────────────────────────────────────────────

async function executeStep(step, mission, pqDir, projectDir, aiConfig, onChunk) {
  // ── 1. Ensure project context (auto-generate if missing) ────────────────────
  await ensureProjectContext(pqDir, projectDir, aiConfig, (msg) => {
    onChunk?.(`\n${msg}\n`)
  })

  // ── 2. Build task prompt ────────────────────────────────────────────────────
  const prompt = await buildAgenticPrompt(step, mission, pqDir)

  // ── 3. Snapshot working tree BEFORE Claude runs ─────────────────────────────
  const beforeSnapshot = snapshotWorkingTree(projectDir)

  // ── 4. Run Claude in agentic mode ──────────────────────────────────────────
  //
  // Claude runs with cwd = projectDir and full tool access. It reads whatever
  // files it needs, makes changes directly with its Edit/Write tools, and
  // optionally runs tests via Bash. All of this is streamed back in real time.
  //
  const ai = new AIService({ ...(aiConfig || {}), projectDir })

  let fullResponse = ''

  await ai.agenticStream(
    prompt,
    (chunk) => {
      fullResponse += chunk
      if (onChunk) onChunk(chunk)
    },
  )

  // ── 5. Check if Claude needs more information ───────────────────────────────
  const needsInfo = parseNeedsInfo(fullResponse)
  if (needsInfo.length > 0) {
    return {
      status:         'needs_info',
      needsInfo,
      fileChanges:    [],
      appliedChanges: [],
      commandResults: [],
      warnings:       [],
      summary:        '',
      rawResponse:    fullResponse,
    }
  }

  // ── 6. Detect what Claude changed ──────────────────────────────────────────
  const appliedChanges = detectChanges(beforeSnapshot, projectDir)

  // ── 7. Parse summary ────────────────────────────────────────────────────────
  const summary = parseSummary(fullResponse) || `${step.subTask} — complete`

  console.log(`[executor] step ${step.id} complete — ${appliedChanges.length} file(s) changed`)

  return {
    status:         'complete',
    fileChanges:    appliedChanges,
    appliedChanges,
    commandResults: [],
    warnings:       [],
    summary,
    rawResponse:    fullResponse,
  }
}

module.exports = { executeStep }
