/**
 * Model Factory — Vercel AI SDK provider + role-to-model mapping.
 */

const PROVIDER_DEFAULTS = {
  anthropic: {
    orchestrator: 'claude-opus-4-6',
    planner:      'claude-opus-4-6',       // Mallory — scoping requires strong reasoning
    architect:    'claude-opus-4-6',       // Quartermaster — design requires strong reasoning
    implementer:  'claude-sonnet-4-6',
    qa:           'claude-sonnet-4-6',     // Moneypenny — testing
    reviewer:     'claude-sonnet-4-6',
    fast:         'claude-haiku-4-5-20251001',
  },
  openai: {
    orchestrator: 'o1',
    planner:      'o1',
    architect:    'o1',
    implementer:  'gpt-4o',
    qa:           'gpt-4o',
    reviewer:     'gpt-4o',
    fast:         'gpt-4o-mini',
  },
  google: {
    orchestrator: 'gemini-1.5-pro',
    planner:      'gemini-1.5-pro',
    architect:    'gemini-1.5-pro',
    implementer:  'gemini-1.5-pro',
    qa:           'gemini-1.5-flash',
    reviewer:     'gemini-1.5-flash',
    fast:         'gemini-1.5-flash',
  },
}

const CLI_PROVIDERS = new Set(['claude-cli', 'ollama', 'gemini-cli', 'openai-cli'])

function createModel(provider, modelName) {
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
  const provider = aiConfig.provider
  const modelName =
    aiConfig.models?.[role] ??
    PROVIDER_DEFAULTS[provider]?.[role] ??
    PROVIDER_DEFAULTS[provider]?.implementer
  if (!modelName) throw new Error(`No model for role '${role}' with provider '${provider}'`)
  return { model: createModel(provider, modelName), modelName, provider }
}

function supportsVercelLoop(provider) {
  return !CLI_PROVIDERS.has(provider)
}

module.exports = { createModel, getModelForRole, supportsVercelLoop, PROVIDER_DEFAULTS }
