/**
 * Orchestrator — plans missions, assigns agents, validates completeness.
 *
 * Given a task + codebase context, the orchestrator:
 * 1. Identifies which agents are needed and why
 * 2. Surfaces any missing information before planning
 * 3. Produces a structured MissionPlan with per-step rationale
 * 4. Flags low-confidence actions for mandatory individual review
 */

const AIService = require('../ai')
const { getPersona } = require('./registry')
const fs = require('fs-extra')
const path = require('path')

// ── Codebase context builder ──────────────────────────────────────────────────

async function buildContext(pqDir, projectDir) {
  const ctx = {}

  // ── Generated context files (increased limit) ─────────────────────────────
  const contextDir = path.join(pqDir, 'context')
  for (const name of ['PRD.md', 'ARCHITECTURE.md', 'TECH_STACK.md']) {
    const p = path.join(contextDir, name)
    if (fs.existsSync(p)) {
      ctx[name] = (await fs.readFile(p, 'utf8')).slice(0, 6000)
    }
  }

  try {
    const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.project-q', 'vendor', '__pycache__', '.turbo', 'out'])

    // ── Multi-level directory tree ────────────────────────────────────────────
    // Walk up to 3 levels deep for a real picture of the codebase structure
    const buildTree = async (dir, depth, prefix = '') => {
      if (depth === 0) return ''
      let lines = ''
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        const filtered = entries
          .filter(e => !IGNORE.has(e.name) && !e.name.startsWith('.'))
          .slice(0, 40)
        for (const entry of filtered) {
          const isDir = entry.isDirectory()
          lines += `${prefix}${isDir ? '📁' : '📄'} ${entry.name}\n`
          if (isDir && depth > 1) {
            lines += await buildTree(path.join(dir, entry.name), depth - 1, prefix + '  ')
          }
        }
      } catch {}
      return lines
    }

    ctx.projectStructure = await buildTree(projectDir, 3)

    // ── package.json — scripts + deps ────────────────────────────────────────
    const pkgPath = path.join(projectDir, 'package.json')
    if (fs.existsSync(pkgPath)) {
      const pkg = await fs.readJson(pkgPath)
      ctx.packageJson = JSON.stringify({
        name: pkg.name,
        scripts: pkg.scripts,
        dependencies: pkg.dependencies,
        devDependencies: pkg.devDependencies,
      }, null, 2).slice(0, 3000)
    }

    // ── Key config files ──────────────────────────────────────────────────────
    const configCandidates = ['tsconfig.json', 'tsconfig.base.json', 'vite.config.ts', 'next.config.js', 'next.config.ts', 'webpack.config.js', '.eslintrc.js', '.eslintrc.json', 'jest.config.js', 'jest.config.ts']
    const foundConfigs = []
    for (const name of configCandidates) {
      const p = path.join(projectDir, name)
      if (fs.existsSync(p)) {
        const content = (await fs.readFile(p, 'utf8')).slice(0, 1500)
        foundConfigs.push(`### ${name}\n${content}`)
      }
    }
    if (foundConfigs.length > 0) {
      ctx.configFiles = foundConfigs.join('\n\n')
    }

    // ── Entry point file ──────────────────────────────────────────────────────
    // Include the project's main entry to show real code style/patterns
    const entryCandidates = [
      'src/main.ts', 'src/main.tsx', 'src/index.ts', 'src/index.tsx',
      'src/app.ts', 'src/app.tsx', 'src/App.tsx', 'src/App.ts',
      'app/layout.tsx', 'app/page.tsx', 'pages/index.tsx', 'pages/_app.tsx',
      'src/server.ts', 'server.ts', 'index.ts', 'index.js',
    ]
    for (const candidate of entryCandidates) {
      const p = path.join(projectDir, candidate)
      if (fs.existsSync(p)) {
        const content = (await fs.readFile(p, 'utf8')).slice(0, 2000)
        ctx.entryPoint = `### ${candidate}\n${content}`
        break
      }
    }

  } catch (err) {
    console.error('[orchestrator] buildContext error:', err.message)
  }

  return ctx
}

// ── Orchestrator planning prompt ──────────────────────────────────────────────

function buildPlanningPrompt(task, context, answeredQuestions = []) {
  const ctxStr = Object.entries(context)
    .map(([k, v]) => `### ${k}\n${v}`)
    .join('\n\n')

  const answeredStr = answeredQuestions.length > 0
    ? `\n\n## Clarifications already provided by the user\n\n` +
      answeredQuestions.map(q => `**Q:** ${q.question}\n**A:** ${q.answer}`).join('\n\n')
    : ''

  return `${getPersona('orchestrator')}

---

## Task to plan

**Title:** ${task.title}
**Description:** ${task.description || '(no description provided)'}
**Priority:** ${task.priority || 'medium'}${answeredStr}

---

## Codebase Context

${ctxStr || '(no context available — project may not be initialized)'}

---

## Your job

Analyse this task and produce a complete MissionPlan in the following JSON format:

{
  "summary": "one-sentence description of what this mission will accomplish",
  "missingInfo": [
    {
      "id": "q1",
      "question": "specific question that must be answered before work can begin",
      "context": "why this information is needed / what is ambiguous"
    }
  ],
  "steps": [
    {
      "id": "step-1",
      "agentId": "james-bond",
      "agentName": "James Bond",
      "subTask": "specific, actionable description of what this agent will do",
      "rationale": "why this agent is needed for this step — ground it in the task description or codebase context",
      "evidence": "specific reference to a file, line, component, or context document that supports this step",
      "filesLikelyAffected": ["path/to/file.js", "path/to/other.ts"],
      "confidence": "high|medium|low",
      "assumptions": ["any assumption being made that the user has not confirmed"],
      "dependsOn": ["step-id-if-any"],
      "canParallel": false,
      "expectedDeliverable": "design.md|implementation-summary.md|test-plan.md|null"
    }
  ],
  "executionOrder": "sequential|parallel|mixed",
  "riskLevel": "low|medium|high",
  "riskNotes": "any risks or concerns about this plan"
}

CRITICAL RULES:
- If missingInfo is non-empty, the mission will be paused to ask the user those questions before proceeding
- Every step MUST have a non-empty rationale and evidence field
- If you are not sure what files are affected, set confidence to "low" and add an assumption
- Do not invent file paths that don't exist — only reference paths visible in the project structure
- If the task is unclear or too broad to plan safely, add a missingInfo entry asking for clarification
- Respond with ONLY the JSON object — no prose before or after`
}

// ── Parse + validate the orchestrator's plan ─────────────────────────────────

function parsePlan(raw) {
  // Strip markdown code fences
  let clean = raw.replace(/```(?:json)?\n?/g, '').replace(/\n?```/g, '').trim()

  // The model sometimes prefixes with prose ("Now I have...", "Here's the plan:").
  // Extract the outermost JSON object regardless of what surrounds it.
  const jsonStart = clean.indexOf('{')
  const jsonEnd   = clean.lastIndexOf('}')
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    console.error('[orchestrator] parsePlan: no JSON object found in response')
    console.error('[orchestrator] raw response preview:', raw.slice(0, 400))
    throw new Error('Orchestrator response contained no JSON object')
  }
  clean = clean.slice(jsonStart, jsonEnd + 1)

  let plan
  try {
    plan = JSON.parse(clean)
  } catch (e) {
    console.error('[orchestrator] parsePlan: JSON.parse failed:', e.message)
    console.error('[orchestrator] extracted JSON preview:', clean.slice(0, 400))
    throw new Error(`Plan JSON invalid: ${e.message}`)
  }

  // Validate required fields
  if (!plan.steps || !Array.isArray(plan.steps)) throw new Error('Plan missing steps array')
  if (!plan.summary) throw new Error('Plan missing summary')

  // Ensure every step has required fields
  plan.steps = plan.steps.map((step, i) => ({
    id: step.id || `step-${i + 1}`,
    agentId: step.agentId || 'james-bond',
    agentName: step.agentName || 'James Bond',
    subTask: step.subTask || '',
    rationale: step.rationale || '',
    evidence: step.evidence || '',
    filesLikelyAffected: step.filesLikelyAffected || [],
    confidence: step.confidence || 'medium',
    assumptions: step.assumptions || [],
    dependsOn: step.dependsOn || [],
    canParallel: step.canParallel || false,
    status: 'pending',
    result: null,
    fileChanges: [],
  }))

  plan.missingInfo = (plan.missingInfo || []).map(q => ({
    ...q,
    answer: null,
    answeredAt: null,
  }))

  return plan
}

// ── Main plan function ────────────────────────────────────────────────────────

async function planMission(task, pqDir, projectDir, aiConfig, answeredQuestions = []) {
  const context = await buildContext(pqDir, projectDir)
  const prompt = buildPlanningPrompt(task, context, answeredQuestions)

  let raw
  const { supportsVercelLoop, getModelForRole } = require('../ai/model-factory')

  if (supportsVercelLoop(aiConfig?.provider)) {
    try {
      const { generateText } = require('ai')
      const { model, modelName } = getModelForRole('orchestrator', aiConfig)
      console.log(`[orchestrator] planning with ${modelName}`)
      const result = await generateText({
        model,
        system: getPersona('orchestrator'),
        prompt,
        maxTokens: 8192,
      })
      raw = result.text
    } catch (e) {
      console.warn('[orchestrator] Vercel generateText failed, falling back:', e.message)
      const ai = new AIService({ ...(aiConfig || {}), projectDir: null })
      raw = await ai.complete(prompt)
    }
  } else {
    // CLI provider — use opus for planning (best reasoning for architecture decisions)
    console.log(`[orchestrator] planning with opus (cli)`)
    const ai = new AIService({ ...(aiConfig || {}), projectDir: null, model: 'opus' })
    raw = await ai.complete(prompt)
  }

  return parsePlan(raw)
}

module.exports = { planMission, buildContext }
