/**
 * Agent Executor
 *
 * For API providers: uses Vercel AI SDK streamText with tool-use loop.
 * For CLI providers: falls back to existing agenticStream (one-shot + git diff).
 */

const AIService = require('../ai')
const { getPersona } = require('./registry')
const { ensureProjectContext } = require('./context-guard')
const { getModelForRole, supportsVercelLoop } = require('../ai/model-factory')
const { buildTools } = require('./agent-tools')
const fs   = require('fs-extra')
const path = require('path')
const { execSync } = require('child_process')

const AGENT_ROLES = {
  orchestrator:  'orchestrator',
  mallory:       'planner',
  quartermaster: 'architect',
  'james-bond':  'implementer',
  moneypenny:    'qa',
  tanner:        'qa',
  felix:         'fast',
}

// ── Change detection ──────────────────────────────────────────────────────────

function snapshotWorkingTree(projectDir) {
  try {
    const out = execSync('git status --porcelain', { cwd: projectDir, encoding: 'utf8', timeout: 5000 }).trim()
    return { type: 'git', snapshot: out }
  } catch {
    return { type: 'mtime', snapshot: mtimeSnapshot(projectDir) }
  }
}

function detectChanges(before, projectDir) {
  const now = new Date().toISOString()
  if (before.type === 'git') {
    try {
      const out = execSync('git status --porcelain', { cwd: projectDir, encoding: 'utf8', timeout: 5000 }).trim()
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
  const afterSnapshot = mtimeSnapshot(projectDir)
  return diffMtimes(before.snapshot, afterSnapshot, projectDir, now)
}

const IGNORE_DIRS = new Set(['node_modules','.git','dist','build','.next','coverage','.project-q','vendor','__pycache__'])

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
    if (!before[file])               changes.push({ path: rel, action: 'write', appliedAt: now })
    else if (before[file] !== mtime) changes.push({ path: rel, action: 'write', appliedAt: now })
  }
  for (const file of Object.keys(before)) {
    if (!after[file]) changes.push({ path: path.relative(projectDir, file), action: 'delete', appliedAt: now })
  }
  return changes
}

// ── Deliverable paths ─────────────────────────────────────────────────────────

function getDeliverableDir(pqDir, missionId) {
  return path.join(pqDir, 'missions', missionId)
}

function getDeliverablePath(pqDir, missionId, agentId) {
  const map = {
    'mallory':       'scope.md',
    'quartermaster': 'design.md',
    'james-bond':    'implementation-summary.md',
    'moneypenny':    'test-plan.md',
    'tanner':        'test-plan.md',
  }
  const filename = map[agentId]
  if (!filename) return null
  return path.join(getDeliverableDir(pqDir, missionId), filename)
}

// ── Per-role exploration instructions ─────────────────────────────────────────

function getExplorationInstructions(agentId) {
  switch (agentId) {
    case 'mallory':
      return `## Your Exploration Checklist

Do these steps in order before writing your scope document:

1. **Map the structure**: run list_files('.') then list_files for each top-level src dir
2. **Find relevant files**: use search_code to find files related to the task — search for feature names, relevant class/function names, route names
3. **Read key files**: read the actual source files, not just their names — understand current implementation
4. **Find tests**: search for existing tests related to the feature area
5. **Check imports**: understand how modules connect — who imports what
6. **Look for TODOs/FIXMEs**: search_code for TODO or FIXME near relevant code

Only after completing all steps: write your scope.md deliverable and call task_complete.`

    case 'quartermaster':
      return `## Your Design Checklist

Do these steps in order before writing your design document:

1. **Read Mallory's scope** (already injected above if available) — understand what was found
2. **Read every "Key Files Found"** from scope.md — use read_file on each one, do not skip
3. **Understand patterns**: read 1-2 similar existing implementations to understand the code style
4. **Check interfaces**: read any TypeScript interfaces/types related to your design area
5. **Identify integration points**: use search_code to find where the feature will connect
6. **Check existing tests**: understand what test coverage exists and what your design must maintain

Only after completing all steps: write your design.md deliverable and call task_complete.`

    case 'james-bond':
      return `## Your Implementation Checklist

Do these steps in order — skipping any step risks breaking things:

1. **Read Q's design.md completely** (already injected above) — understand every file in the "Files to Change" table
2. **Read EACH file you will modify** — use read_file on every file before touching it
3. **Check for existing similar implementations**: search_code for patterns you'll replicate
4. **Understand the test setup**: find and read one existing test file so you match the pattern
5. **Implement**: write complete, production-quality code — no partial implementations
6. **Check your work**: re-read each file you modified to catch obvious errors
7. **Run verification**: use run_command to run lint/typecheck if available — fix any errors before completing

Only after implementation: write your implementation-summary.md and call task_complete.`

    case 'moneypenny':
    case 'tanner':
      return `## Your QA Checklist

Do these steps in order:

1. **Read Q's design.md** (injected above) — understand what was intended
2. **Read J's implementation-summary.md** (injected above) — understand what was built and any deviations
3. **Find existing test files**: use list_files and search_code to locate test files for this feature area
4. **Read one existing test file**: understand the test framework, import style, assertion patterns
5. **Read the actual implementation**: use read_file to read each file J changed — test what's really there
6. **Write or extend tests**: use write_file to create/update test files matching existing patterns
7. **Run tests**: use run_command to run the test suite — capture the output
8. **Write test plan**: document what you tested, what passed, what failed

Only after writing tests and running them: write your test-plan.md and call task_complete.`

    case 'felix':
      return `## Instructions

1. Read the relevant file(s) before changing anything
2. Make the minimal change needed — no scope creep
3. Verify with run_command if a lint/test command is available
4. call task_complete with a brief summary`

    default:
      return `## Instructions

1. Explore the codebase first — use read_file, list_files, search_code
2. Implement your changes using write_file
3. Verify with run_command (lint, typecheck, tests) if available
4. When fully done, call task_complete with a summary`
  }
}

// ── Prompt ────────────────────────────────────────────────────────────────────

async function buildAgenticPrompt(step, mission, pqDir) {
  await fs.ensureDir(getDeliverableDir(pqDir, mission.id))

  const answeredQ = (mission.pendingQuestions || [])
    .filter(q => q.answer)
    .map(q => `Q: ${q.question}\nA: ${q.answer}`)
    .join('\n\n')

  // ── Load upstream deliverables ────────────────────────────────────────────

  let upstreamContext = ''

  if (step.agentId === 'quartermaster') {
    const scopePath = getDeliverablePath(pqDir, mission.id, 'mallory')
    if (scopePath && fs.existsSync(scopePath)) {
      const scopeDoc = await fs.readFile(scopePath, 'utf8')
      upstreamContext = `\n\n## Scope Document from Mallory\n\n${scopeDoc}\n\n> Use this scope to guide your technical design. Mallory has already identified the relevant files and patterns.`
    }
  } else if (step.agentId === 'james-bond') {
    const designPath = getDeliverablePath(pqDir, mission.id, 'quartermaster')
    if (designPath && fs.existsSync(designPath)) {
      const designDoc = await fs.readFile(designPath, 'utf8')
      upstreamContext = `\n\n## Design Specification from Quartermaster\n\n${designDoc}\n\n> Follow this spec. Document any deviations in your implementation summary.`
    }
  } else if (step.agentId === 'moneypenny' || step.agentId === 'tanner') {
    const designPath = getDeliverablePath(pqDir, mission.id, 'quartermaster')
    const implPath = getDeliverablePath(pqDir, mission.id, 'james-bond')
    if (designPath && fs.existsSync(designPath)) {
      const designDoc = await fs.readFile(designPath, 'utf8')
      upstreamContext += `\n\n## Design Specification from Quartermaster\n\n${designDoc}`
    }
    if (implPath && fs.existsSync(implPath)) {
      const implDoc = await fs.readFile(implPath, 'utf8')
      upstreamContext += `\n\n## Implementation Summary from James Bond\n\n${implDoc}`
    }
  }

  // ── Mandatory deliverable instruction ────────────────────────────────────

  const deliverablePath = getDeliverablePath(pqDir, mission.id, step.agentId)
  let deliverableInstruction = ''
  if (deliverablePath) {
    const descriptions = {
      'mallory':       `You MUST write your scope document to:\n\`${deliverablePath}\`\n\nQuartermaster will read this before designing the solution. Be exhaustive about what you find.`,
      'quartermaster': `You MUST write your design document to:\n\`${deliverablePath}\`\n\nThis file will be read by James Bond before he writes any code. Make it precise and complete.`,
      'james-bond':    `You MUST write your implementation summary to:\n\`${deliverablePath}\`\n\nMoneypenny will read this to understand what was built.`,
      'moneypenny':    `You MUST write your test plan to:\n\`${deliverablePath}\`\n\nAlso write/extend actual test files in the project (do NOT write them to the deliverable dir).`,
      'tanner':        `You MUST write your test plan to:\n\`${deliverablePath}\`\n\nAlso write/extend actual test files in the project.`,
    }
    deliverableInstruction = `\n\n## Mandatory Deliverable\n\n${descriptions[step.agentId] || ''}`
  }

  return `## Mission

**Task:** ${mission.taskTitle}
${mission.taskDescription ? `**Description:** ${mission.taskDescription}` : ''}

**Your sub-task:** ${step.subTask}
**Why you are involved:** ${step.rationale}
**Codebase evidence:** ${step.evidence}

${answeredQ ? `## Clarifications from user\n\n${answeredQ}\n` : ''}${step.assumptions?.length ? `## Assumed (flag if wrong)\n${step.assumptions.map(a => `- ${a}`).join('\n')}\n` : ''}${upstreamContext}${deliverableInstruction}
---

${getExplorationInstructions(step.agentId)}

If you cannot proceed without user input, include:
<needs_info><question>...</question><context>...</context></needs_info>
in your response before calling task_complete.`
}

// ── Vercel AI SDK loop ────────────────────────────────────────────────────────

async function runVercelLoop(step, mission, pqDir, projectDir, aiConfig, onChunk, onToolCall) {
  const { streamText } = require('ai')

  const role = AGENT_ROLES[step.agentId] || 'implementer'
  const { model, modelName } = getModelForRole(role, aiConfig)

  const prompt = await buildAgenticPrompt(step, mission, pqDir)
  const systemPrompt = getPersona(step.agentId)

  const liveChanges = []

  const tools = buildTools(projectDir, (toolEvent) => {
    onToolCall?.(toolEvent)
    if (toolEvent.name === 'write_file') {
      liveChanges.push({ path: toolEvent.input.path, action: 'write', appliedAt: new Date().toISOString() })
    }
  })

  let fullText = ''

  const result = streamText({
    model,
    system: systemPrompt,
    prompt,
    tools,
    maxSteps: 30,
    onChunk: ({ chunk }) => {
      if (chunk.type === 'text-delta') {
        fullText += chunk.textDelta
        onChunk?.(chunk.textDelta)
      }
    },
  })

  await result.text

  return { fullText, modelName, liveChanges }
}

// ── CLI role → model mapping ──────────────────────────────────────────────────
// Maps each agent role to the appropriate Claude CLI model shorthand.
const CLI_ROLE_MODELS = {
  orchestrator: 'opus',
  planner:      'opus',
  architect:    'opus',
  implementer:  'sonnet',
  qa:           'sonnet',
  reviewer:     'sonnet',
  fast:         'haiku',
}

// ── CLI fallback ──────────────────────────────────────────────────────────────

async function runCLIFallback(step, mission, pqDir, projectDir, aiConfig, onChunk) {
  const prompt = await buildAgenticPrompt(step, mission, pqDir)

  // Select model based on agent role — don't use the same model for every step
  const role = AGENT_ROLES[step.agentId] || 'implementer'
  const cliModel = CLI_ROLE_MODELS[role] || 'sonnet'
  console.log(`[executor] ${step.agentId} → role:${role} → model:${cliModel}`)

  // Pass the agent's persona as system prompt so CLI has the same character/rules as Vercel path
  const systemPrompt = getPersona(step.agentId)

  const ai = new AIService({ ...(aiConfig || {}), projectDir, model: cliModel })

  const beforeSnapshot = snapshotWorkingTree(projectDir)
  let fullResponse = ''

  await ai.agenticStream(prompt, (chunk) => {
    fullResponse += chunk
    onChunk?.(chunk)
  }, { systemPrompt })

  return { fullText: fullResponse, modelName: cliModel, liveChanges: detectChanges(beforeSnapshot, projectDir) }
}

// ── Parse ─────────────────────────────────────────────────────────────────────

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

// ── Post-implementation verification ─────────────────────────────────────────
// Attempt to run available lint/typecheck/test scripts after James Bond completes.
// Returns an array of { script, command, passed, output } results.

async function runVerification(projectDir, packageJsonPath) {
  const results = []
  if (!fs.existsSync(packageJsonPath)) return results

  let pkg
  try { pkg = await fs.readJson(packageJsonPath) } catch { return results }

  const scripts = pkg.scripts || {}

  // Priority order: lint first, then typecheck, then tests (limited run)
  const candidates = [
    { script: 'lint',       command: 'npm run lint --if-present',         timeout: 60000 },
    { script: 'typecheck',  command: 'npm run typecheck --if-present',    timeout: 60000 },
    { script: 'type-check', command: 'npm run type-check --if-present',   timeout: 60000 },
    { script: 'tsc',        command: 'npx tsc --noEmit',                  timeout: 60000 },
    { script: 'test',       command: 'npm test -- --passWithNoTests --watchAll=false', timeout: 120000 },
  ]

  // Only run scripts that exist in package.json
  const toRun = candidates.filter(c => {
    if (c.script === 'tsc') return !scripts.typecheck && !scripts['type-check'] && fs.existsSync(path.join(projectDir, 'tsconfig.json'))
    if (c.script === 'test') return !!scripts.test
    return !!scripts[c.script]
  })

  for (const { script, command, timeout } of toRun) {
    try {
      const output = execSync(command, {
        cwd: projectDir,
        encoding: 'utf8',
        timeout,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      results.push({ script, command, passed: true, output: output.trim().slice(0, 500) })
      console.log(`[executor] verification ${script}: PASSED`)
    } catch (err) {
      const output = ((err.stdout || '') + (err.stderr || '')).trim().slice(0, 1000)
      results.push({ script, command, passed: false, output })
      console.warn(`[executor] verification ${script}: FAILED\n${output.slice(0, 200)}`)
    }
  }

  return results
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function executeStep(step, mission, pqDir, projectDir, aiConfig, onChunk, onToolCall) {
  await ensureProjectContext(pqDir, projectDir, aiConfig, (msg) => {
    onChunk?.(`\n${msg}\n`)
  })

  const beforeSnapshot = snapshotWorkingTree(projectDir)

  let fullText, modelName, liveChanges

  if (supportsVercelLoop(aiConfig?.provider)) {
    try {
      ;({ fullText, modelName, liveChanges } = await runVercelLoop(step, mission, pqDir, projectDir, aiConfig, onChunk, onToolCall))
    } catch (e) {
      console.warn('[executor] Vercel loop failed, falling back to CLI:', e.message)
      ;({ fullText, modelName, liveChanges } = await runCLIFallback(step, mission, pqDir, projectDir, aiConfig, onChunk))
    }
  } else {
    ;({ fullText, modelName, liveChanges } = await runCLIFallback(step, mission, pqDir, projectDir, aiConfig, onChunk))
  }

  const needsInfo = parseNeedsInfo(fullText)
  if (needsInfo.length > 0) {
    return { status: 'needs_info', needsInfo, fileChanges: [], appliedChanges: [], commandResults: [], warnings: [], summary: '', rawResponse: fullText, modelName, deliverable: null }
  }

  // Check if agent produced their mandatory deliverable
  const deliverablePath = getDeliverablePath(pqDir, mission.id, step.agentId)
  let deliverable = null
  if (deliverablePath && fs.existsSync(deliverablePath)) {
    deliverable = {
      name: path.basename(deliverablePath),
      absolutePath: deliverablePath,
    }
    console.log(`[executor] step ${step.id} produced deliverable: ${deliverable.name}`)
  } else if (deliverablePath) {
    console.warn(`[executor] step ${step.id} (${step.agentId}) did NOT produce expected deliverable: ${deliverablePath}`)
  }

  const appliedChanges = liveChanges.length > 0 ? liveChanges : detectChanges(beforeSnapshot, projectDir)
  const summary = parseSummary(fullText) || `${step.subTask} — complete`

  // ── Post-implementation verification (James Bond only) ────────────────────
  let verificationResults = []
  if (step.agentId === 'james-bond') {
    const pkgPath = path.join(projectDir, 'package.json')
    verificationResults = await runVerification(projectDir, pkgPath)
    const failed = verificationResults.filter(r => !r.passed)
    if (failed.length > 0) {
      console.warn(`[executor] ${failed.length} verification check(s) failed after implementation`)
    }
  }

  console.log(`[executor] step ${step.id} complete — ${appliedChanges.length} file(s) changed via ${modelName}`)

  return {
    status: 'complete',
    fileChanges: appliedChanges, appliedChanges,
    commandResults: [], warnings: [],
    summary, rawResponse: fullText, modelName, deliverable,
    verificationResults,
  }
}

module.exports = { executeStep }
