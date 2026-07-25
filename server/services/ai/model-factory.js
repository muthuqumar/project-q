/**
 * Model Factory — Vercel AI SDK provider + role-to-model mapping.
 */

const PROVIDER_DEFAULTS = {
  anthropic: {
    orchestrator: 'claude-opus-4-8',
    planner:      'claude-opus-4-8',       // Mallory — scoping requires strong reasoning
    're-planner': 'claude-sonnet-4-6',     // Cheaper re-plans after answered questions
    architect:    'claude-opus-4-8',       // Quartermaster — design requires strong reasoning
    implementer:  'claude-sonnet-4-6',
    qa:           'claude-haiku-4-5-20251001',  // Moneypenny — Haiku is cost-effective for test writing
    reviewer:     'claude-sonnet-4-6',
    fast:         'claude-haiku-4-5-20251001',
  },
  openai: {
    orchestrator: 'o1',
    planner:      'o1',
    're-planner': 'gpt-4o',
    architect:    'o1',
    implementer:  'gpt-4o',
    qa:           'gpt-4o-mini',
    reviewer:     'gpt-4o',
    fast:         'gpt-4o-mini',
  },
  google: {
    orchestrator: 'gemini-1.5-pro',
    planner:      'gemini-1.5-pro',
    're-planner': 'gemini-1.5-flash',
    architect:    'gemini-1.5-pro',
    implementer:  'gemini-1.5-pro',
    qa:           'gemini-1.5-flash',
    reviewer:     'gemini-1.5-flash',
    fast:         'gemini-1.5-flash',
  },
}

const CLI_PROVIDERS = new Set(['claude-cli', 'ollama', 'gemini-cli', 'openai-cli'])

// The rest of the app names the Anthropic/Google API providers 'claude'/'gemini'
// (see services/ai/index.js), but the Vercel AI SDK path here keys on
// 'anthropic'/'google'. Normalize so the cost-computing loop actually runs for
// the default 'claude' provider instead of throwing and falling back to CLI.
const PROVIDER_ALIASES = { claude: 'anthropic', gemini: 'google' }
function normalizeProvider(provider) {
  return PROVIDER_ALIASES[provider] || provider
}

function createModel(provider, modelName) {
  provider = normalizeProvider(provider)
  if (provider === 'anthropic') {
    const { anthropic } = require('@ai-sdk/anthropic')
    return anthropic(modelName)
  }
  if (provider === 'openai') {
    const { openai } = require('@ai-sdk/openai')
    return openai(modelName)
  }
  if (provider === 'google') {
    const { google } = require('@ai-sdk/google')
    return google(modelName)
  }
  throw new Error(`Vercel AI SDK does not support provider: ${provider}`)
}

function getModelForRole(role, aiConfig) {
  const provider = normalizeProvider(aiConfig.provider)
  const modelName =
    aiConfig.models?.[role] ??
    PROVIDER_DEFAULTS[provider]?.[role] ??
    PROVIDER_DEFAULTS[provider]?.implementer
  if (!modelName) throw new Error(`No model for role '${role}' with provider '${provider}'`)
  return { model: createModel(provider, modelName), modelName, provider }
}

function supportsVercelLoop(provider) {
  return !CLI_PROVIDERS.has(normalizeProvider(provider))
}

module.exports = { createModel, getModelForRole, supportsVercelLoop, normalizeProvider, PROVIDER_DEFAULTS }
