/**
 * pricing.js
 *
 * USD cost per model from a usage record. Prices are per 1M tokens.
 *
 * Fields per model:
 *   input       — fresh (uncached) input tokens
 *   output      — output tokens
 *   cacheRead   — reads from prompt cache (~0.1× input on Anthropic)
 *   cacheWrite  — writes to prompt cache (~1.25× input, 5-minute TTL on Anthropic)
 *
 * Model IDs drift every release (opus-4-6 → 4-7 → 4-8, dated snapshots, the
 * `[1m]` suffix, Bedrock's `anthropic.` prefix). Rather than require an exact
 * table hit, resolvePrice() falls back to family matching so a new point
 * release is priced correctly instead of silently showing $0.00.
 *
 * Anthropic pricing verified against the claude-api reference (2026-07):
 *   Opus 4.6/4.7/4.8 $5/$25 · Sonnet 4.6 $3/$15 · Haiku 4.5 $1/$5 · Fable 5 $10/$50.
 */

const PRICES = {
  // ── Anthropic ──────────────────────────────────────────────────────────
  'claude-opus-4-8':   { input: 5,  output: 25, cacheRead: 0.5,   cacheWrite: 6.25 },
  'claude-opus-4-7':   { input: 5,  output: 25, cacheRead: 0.5,   cacheWrite: 6.25 },
  'claude-opus-4-6':   { input: 5,  output: 25, cacheRead: 0.5,   cacheWrite: 6.25 },
  'claude-sonnet-4-6': { input: 3,  output: 15, cacheRead: 0.3,   cacheWrite: 3.75 },
  'claude-haiku-4-5':  { input: 1,  output: 5,  cacheRead: 0.1,   cacheWrite: 1.25 },
  'claude-fable-5':    { input: 10, output: 50, cacheRead: 1.0,   cacheWrite: 12.5 },

  // ── OpenAI ─────────────────────────────────────────────────────────────
  'gpt-4o':            { input: 2.5,  output: 10,  cacheRead: 1.25,  cacheWrite: 0 },
  'gpt-4o-mini':       { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 },
  'o1':                { input: 15,   output: 60,  cacheRead: 7.5,   cacheWrite: 0 },

  // ── Google ─────────────────────────────────────────────────────────────
  'gemini-1.5-pro':    { input: 1.25,  output: 5,   cacheRead: 0.3125, cacheWrite: 0 },
  'gemini-1.5-flash':  { input: 0.075, output: 0.3, cacheRead: 0.019,  cacheWrite: 0 },
}

/**
 * Resolve a price row for a model id, tolerant of version/prefix/suffix drift.
 * Order: exact match → normalized id → family match.
 */
function resolvePrice(modelName) {
  if (!modelName) return null
  if (PRICES[modelName]) return PRICES[modelName]

  const id = String(modelName)
    .toLowerCase()
    .replace(/^anthropic\./, '')       // Bedrock prefix
    .replace(/\[[^\]]*\]/g, '')        // e.g. [1m]
    .replace(/[@-]\d{8}$/, '')         // dated snapshot: -20251001 / @20251001
    .trim()

  if (PRICES[id]) return PRICES[id]

  // Family fallback — a new point release still gets priced.
  if (id.includes('opus'))                        return PRICES['claude-opus-4-8']
  if (id.includes('sonnet'))                      return PRICES['claude-sonnet-4-6']
  if (id.includes('haiku'))                       return PRICES['claude-haiku-4-5']
  if (id.includes('fable') || id.includes('mythos')) return PRICES['claude-fable-5']
  if (id.includes('gpt-4o-mini'))                 return PRICES['gpt-4o-mini']
  if (id.includes('gpt-4o'))                      return PRICES['gpt-4o']
  if (/(^|[^a-z])o1([^a-z]|$)/.test(id))          return PRICES['o1']
  if (id.includes('flash'))                       return PRICES['gemini-1.5-flash']
  if (id.includes('gemini'))                      return PRICES['gemini-1.5-pro']
  return null
}

/**
 * Compute cost in USD from a usage record.
 *
 * @param {string} modelName
 * @param {object} usage - canonical shape produced by executor.extractUsage:
 *   { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
 *   where inputTokens is the FRESH (uncached) input count — cache reads/writes
 *   are billed separately, so there is no subtraction here.
 * @returns {{ costUSD: number, priced: boolean }}
 */
function computeCost(modelName, usage = {}) {
  const price = resolvePrice(modelName)
  if (!price) return { costUSD: 0, priced: false }

  const input      = Number(usage.inputTokens      || 0)   // already uncached
  const output     = Number(usage.outputTokens     || 0)
  const cacheRead  = Number(usage.cacheReadTokens  || 0)
  const cacheWrite = Number(usage.cacheWriteTokens || 0)

  const costUSD =
    (input      * price.input      / 1_000_000) +
    (output     * price.output     / 1_000_000) +
    (cacheRead  * price.cacheRead  / 1_000_000) +
    (cacheWrite * price.cacheWrite / 1_000_000)

  return { costUSD, priced: true }
}

/**
 * Format a USD amount for display.
 */
function formatUSD(amount) {
  if (!amount)         return '$0.00'
  if (amount < 0.01)   return `$${amount.toFixed(4)}`
  if (amount < 1)      return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}

module.exports = { computeCost, formatUSD, resolvePrice, PRICES }
