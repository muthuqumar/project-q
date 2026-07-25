/**
 * estimator.js
 *
 * Projected cost of a mission — computed from the PLAN (and refined as
 * deliverables land), not from actual token usage. This is the primary cost
 * signal because the CLI path never reports real token counts.
 *
 * Progressive: the estimate is coarse at plan-approval and tightens after
 * scope.md (real file set) and design.md ("Files to Change"). Priced at
 * published list rates via pricing.js — provider-agnostic $, since we know each
 * role's model tier even on CLI.
 *
 * All token numbers are heuristics with named, tunable constants. The result
 * carries a confidence band that narrows as the basis improves.
 */

const fs   = require('fs-extra')
const path = require('path')
const { resolvePrice, formatUSD } = require('../ai/pricing')
const { extractSeed } = require('../retrieval/seed-extract')

// ── Tunable model ─────────────────────────────────────────────────────────

const ROLE_BY_AGENT = {
  orchestrator: 'orchestrator', mallory: 'planner', quartermaster: 'architect',
  'james-bond': 'implementer', moneypenny: 'qa', tanner: 'qa', felix: 'fast',
}

// The model each role runs on (list-price tiers). resolvePrice family-matches,
// so this prices correctly for API and CLI alike.
const MODEL_BY_ROLE = {
  orchestrator: 'claude-opus-4-8', planner: 'claude-opus-4-8', architect: 'claude-opus-4-8',
  implementer: 'claude-sonnet-4-6', reviewer: 'claude-sonnet-4-6',
  qa: 'claude-haiku-4-5', fast: 'claude-haiku-4-5',
}

const TURNS          = { orchestrator: 1, planner: 8, architect: 6, implementer: 8, qa: 6, fast: 3 }
const OUTPUT_BASE    = { orchestrator: 800, planner: 1500, architect: 2500, implementer: 1500, qa: 2000, fast: 600 }
const OUTPUT_PER_FILE= { architect: 150, implementer: 900, qa: 400, planner: 60, fast: 200 }

const PERSONA_TOKENS      = 800
const TOOL_TAIL_PER_TURN  = 700     // avg tool-result tokens added per loop turn
const CACHE_REUSE         = 0.2     // fraction of the base prompt paid on re-sent turns (prompt caching)
const CONTEXT_CAP         = 40000   // per-step injected-context ceiling (mirrors retrieval budgets)
const DEFAULT_FILES       = 6       // assumed files touched when scope is unknown

// Confidence band (± fraction) by how much we know.
const BAND = { plan: 0.6, scope: 0.35, design: 0.25 }

const toTokens = (s) => Math.ceil((s || '').length / 4)

// ── Gather what's known so far from deliverables ────────────────────────────

async function gatherContext(pqDir, missionId, projectDir) {
  const dir = path.join(pqDir, 'missions', missionId)
  const read = async (f) => { try { return await fs.readFile(path.join(dir, f), 'utf8') } catch { return '' } }

  const scopeMd  = await read('scope.md')
  const designMd = await read('design.md')
  const implMd   = await read('implementation-summary.md')

  const keyFiles    = scopeMd  ? extractSeed(scopeMd,  { source: 'scope'  }).files : []
  const changeFiles = designMd ? extractSeed(designMd, { source: 'design' }).files : []

  const sumFileTokens = async (entries) => {
    let t = 0
    for (const e of entries) {
      try { t += Math.ceil((await fs.stat(path.join(projectDir, e.path))).size / 4) } catch {}
    }
    return t
  }

  return {
    basis: designMd ? 'design' : scopeMd ? 'scope' : 'plan',
    scopeTokens:  toTokens(scopeMd),
    designTokens: toTokens(designMd),
    implTokens:   toTokens(implMd),
    keyFileCount:    keyFiles.length,
    keyFileTokens:   await sumFileTokens(keyFiles),
    changeFileCount: changeFiles.length,
    changeFileTokens: await sumFileTokens(changeFiles),
  }
}

// Injected-context tokens the agent's prompt will carry, by role.
function contextTokensFor(role, ctx) {
  let t = 2000 // baseline project context (task, personas, CLAUDE.md-ish)
  if (role === 'architect')   t += ctx.scopeTokens + ctx.keyFileTokens
  if (role === 'implementer') t += ctx.designTokens + ctx.changeFileTokens
  if (role === 'qa')          t += ctx.designTokens + ctx.implTokens + ctx.changeFileTokens
  return Math.min(t, CONTEXT_CAP)
}

function filesInvolvedFor(role, ctx) {
  if (role === 'implementer' || role === 'qa') return ctx.changeFileCount || ctx.keyFileCount || DEFAULT_FILES
  if (role === 'architect' || role === 'planner') return ctx.keyFileCount || DEFAULT_FILES
  return DEFAULT_FILES
}

// ── Per-step estimate ───────────────────────────────────────────────────────

function estimateStep(step, ctx) {
  const role  = ROLE_BY_AGENT[step.agentId] || 'implementer'
  const model = MODEL_BY_ROLE[role] || 'claude-sonnet-4-6'
  const price = resolvePrice(model) || { input: 3, output: 15 }
  const turns = TURNS[role] || 6

  const base = PERSONA_TOKENS
    + toTokens(`${step.subTask || ''} ${step.rationale || ''} ${step.evidence || ''}`)
    + contextTokensFor(role, ctx)

  // Prompt caching makes re-sent turns cheap; tool results accrue each turn.
  const inputTokens  = Math.round(base * (1 + CACHE_REUSE * (turns - 1)) + TOOL_TAIL_PER_TURN * turns)
  const files        = filesInvolvedFor(role, ctx)
  const outputTokens = Math.round((OUTPUT_BASE[role] || 1500) + (OUTPUT_PER_FILE[role] || 0) * files)

  const costUSD = (inputTokens * price.input + outputTokens * price.output) / 1_000_000

  return { stepId: step.id, agentId: step.agentId, agentName: step.agentName, role, model, inputTokens, outputTokens, costUSD }
}

// ── Public: estimate a whole mission ────────────────────────────────────────

/**
 * @returns {{
 *   basis, band, confidence,
 *   total: { mid, low, high },
 *   byStep: Array,
 *   generatedAt: null   // stamped by caller (Date.now unavailable here)
 * }}
 */
async function estimateMission(pqDir, missionId, projectDir, steps) {
  const active = (steps || []).filter(s => s.status !== 'skipped')
  const ctx = await gatherContext(pqDir, missionId, projectDir)

  const byStep = active.map(s => estimateStep(s, ctx))
  const mid = byStep.reduce((sum, s) => sum + s.costUSD, 0)
  const band = BAND[ctx.basis] ?? 0.5

  return {
    basis: ctx.basis,
    band,
    confidence: ctx.basis === 'design' ? 'high' : ctx.basis === 'scope' ? 'medium' : 'coarse',
    total: { mid, low: mid * (1 - band), high: mid * (1 + band) },
    byStep,
  }
}

module.exports = { estimateMission, formatUSD }
