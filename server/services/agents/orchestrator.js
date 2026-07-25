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

  // ── Generated context docs — the primary source of project understanding ──
  const contextDir = path.join(pqDir, 'context')
  for (const name of ['PRD.md', 'ARCHITECTURE.md', 'TECH_STACK.md']) {
    const p = path.join(contextDir, name)
    if (fs.existsSync(p)) {
      ctx[name] = (await fs.readFile(p, 'utf8')).slice(0, 4000)
    }
  }

  // ── Directory tree (dirs only, language-agnostic) ─────────────────────────
  // Agents pull specific files with read_file during execution — no need to
  // eager-load configs or entry points here.
  try {
    const IGNORE = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.project-q', 'vendor', '__pycache__', '.turbo', 'out', 'target', '.venv', 'venv', '__pypackages__'])
    const buildDirTree = async (dir, depth, prefix = '') => {
      if (depth === 0) return ''
      let lines = ''
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        const dirs = entries
          .filter(e => e.isDirectory() && !IGNORE.has(e.name) && !e.name.startsWith('.'))
          .slice(0, 25)
        for (const entry of dirs) {
          lines += `${prefix}${entry.name}/\n`
          if (depth > 1) {
            lines += await buildDirTree(path.join(dir, entry.name), depth - 1, prefix + '  ')
          }
        }
      } catch {}
      return lines
    }
    ctx.projectStructure = await buildDirTree(projectDir, 3)
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

/**
 * Normalize a Vercel AI SDK v7 result's usage + Anthropic providerMetadata
 * into the shape our pricing module expects. Handles both sync (generateText)
 * and async (streamText) shapes defensively.
 */
async function extractUsage(result) {
  try {
    const usage = await Promise.resolve(result?.usage || {})
    const providerMeta = await Promise.resolve(result?.providerMetadata || {})
    const meta = providerMeta?.anthropic || {}
    return {
      inputTokens:      Number(usage.inputTokens      ?? usage.promptTokens     ?? 0),
      outputTokens:     Number(usage.outputTokens     ?? usage.completionTokens ?? 0),
      cacheReadTokens:  Number(meta.cacheReadInputTokens     ?? usage.cachedInputTokens ?? 0),
      cacheWriteTokens: Number(meta.cacheCreationInputTokens ?? 0),
    }
  } catch {
    return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  }
}

async function planMission(task, pqDir, projectDir, aiConfig, answeredQuestions = []) {
  const context = await buildContext(pqDir, projectDir)
  const prompt = buildPlanningPrompt(task, context, answeredQuestions)

  let raw
  let usage = null
  let modelName = null
  const { supportsVercelLoop, getModelForRole } = require('../ai/model-factory')
  const { computeCost } = require('../ai/pricing')

  // Re-plans (with answered questions) use a cheaper model — the reasoning
  // burden is much smaller when the initial plan already exists.
  const role = answeredQuestions.length > 0 ? 're-planner' : 'orchestrator'

  if (supportsVercelLoop(aiConfig?.provider)) {
    try {
      const { generateText } = require('ai')
      const picked = getModelForRole(role, aiConfig)
      modelName = picked.modelName
      console.log(`[orchestrator] planning with ${modelName} (role: ${role})`)

      // ── Prompt caching: mark the persona as cacheable so repeated planning
      // calls (re-plans, retries) hit the cache at ~10% of input cost.
      const result = await generateText({
        model: picked.model,
        messages: [
          {
            role: 'system',
            content: getPersona('orchestrator'),
            providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
          },
          { role: 'user', content: prompt },
        ],
        maxOutputTokens: 4096,
      })
      raw = result.text
      usage = await extractUsage(result)
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

  const plan = parsePlan(raw)
  const costInfo = usage && modelName ? computeCost(modelName, usage) : { costUSD: 0, priced: false }

  return {
    plan,
    usage: usage ? { ...usage, modelName, costUSD: costInfo.costUSD, priced: costInfo.priced, phase: role } : null,
  }
}

module.exports = { planMission, buildContext }
