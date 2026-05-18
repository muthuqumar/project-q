/**
 * AI Service — unified interface
 *
 * Provider resolution order:
 *  1. CLI providers detected on the system (claude-cli, ollama, gemini-cli, openai-cli)
 *  2. API providers (claude, openai, gemini) if an API key is present in env
 *
 * The `provider` field in config can be:
 *   'auto'        — pick best available (default)
 *   'claude-cli'  — force Claude Code CLI
 *   'ollama'      — force Ollama CLI
 *   'gemini-cli'  — force Gemini CLI
 *   'claude'      — force Anthropic API (needs ANTHROPIC_API_KEY)
 *   'openai'      — force OpenAI API (needs OPENAI_API_KEY)
 *   'gemini'      — force Gemini API (needs GEMINI_API_KEY)
 */

const { detectCLIs, getBestProvider } = require('./cli-detector')

// ── Provider map ───────────────────────────────────────────────────────────────

const PROVIDERS = {
  // CLI providers
  'claude-cli':  () => require('./claude-cli'),
  'ollama':      () => require('./ollama-cli'),
  'gemini-cli':  () => require('./gemini-cli'),
  // API providers (fallback if keys exist)
  'claude':      () => require('./claude'),
  'openai':      () => require('./openai'),
  'gemini':      () => require('./gemini'),
}

// ── Auto-detect best provider (cached after first call) ───────────────────────

let _bestProviderCache = null

function resolveBestProvider() {
  if (_bestProviderCache) return _bestProviderCache

  // 1. Check CLIs
  const clis = detectCLIs()
  const availableCLI = clis.find(c => c.available)
  if (availableCLI) {
    _bestProviderCache = { provider: availableCLI.id, model: availableCLI.defaultModel }
    return _bestProviderCache
  }

  // 2. Fall back to API keys
  if (process.env.ANTHROPIC_API_KEY) {
    _bestProviderCache = { provider: 'claude', model: 'claude-sonnet-4-6' }
    return _bestProviderCache
  }
  if (process.env.OPENAI_API_KEY) {
    _bestProviderCache = { provider: 'openai', model: 'gpt-4o' }
    return _bestProviderCache
  }
  if (process.env.GEMINI_API_KEY) {
    _bestProviderCache = { provider: 'gemini', model: 'gemini-1.5-pro' }
    return _bestProviderCache
  }

  return null
}

// ── AIService class ────────────────────────────────────────────────────────────

class AIService {
  constructor(config = {}) {
    let provider = config.provider || 'auto'
    let model    = config.model

    if (provider === 'auto' || !provider) {
      const best = resolveBestProvider()
      if (!best) throw new Error(
        'No AI provider available. Install Claude CLI, Ollama, or set an API key.'
      )
      provider = best.provider
      model    = model || best.model
    }

    this.provider    = provider
    this.model       = model
    this.apiKey      = config.apiKey
    this.baseUrl     = config.baseUrl
    this.projectDir  = config.projectDir || null
  }

  _getProvider() {
    const factory = PROVIDERS[this.provider]
    if (!factory) throw new Error(`Unknown AI provider: ${this.provider}`)
    return factory()
  }

  /** Single completion (no history) */
  async complete(prompt, options = {}) {
    return this._getProvider().complete(prompt, this._opts(options))
  }

  /** Chat with message history */
  async chat(systemPrompt, messages, options = {}) {
    return this._getProvider().chat(systemPrompt, messages, this._opts(options))
  }

  /** Streaming chat — calls onChunk(text) for each chunk */
  async chatStream(systemPrompt, messages, onChunk, options = {}) {
    const p = this._getProvider()
    if (p.chatStream) {
      return p.chatStream(systemPrompt, messages, onChunk, this._opts(options))
    }
    // Non-streaming fallback
    const result = await p.chat(systemPrompt, messages, this._opts(options))
    onChunk(result)
    return result
  }

  /**
   * Agentic stream — runs Claude CLI with full tool access in the project dir.
   * Claude reads and writes files directly; tool invocations are streamed as notices.
   * Only claude-cli supports this. Other providers fall back to chatStream.
   */
  async agenticStream(taskPrompt, onChunk, options = {}) {
    const p = this._getProvider()
    const opts = this._opts(options)

    if (p.agenticStream) {
      return p.agenticStream(taskPrompt, opts, onChunk)
    }

    // Fallback for non-CLI providers: treat as single completion (no tool use)
    console.warn('[ai] agenticStream not supported by provider — falling back to chatStream')
    return this.chatStream('', [{ role: 'user', content: taskPrompt }], onChunk, options)
  }

  _opts(extra = {}) {
    return {
      model:      this.model,
      apiKey:     this.apiKey,
      baseUrl:    this.baseUrl,
      projectDir: this.projectDir,
      ...extra,
    }
  }

  /** Static helpers */
  static detect()      { return detectCLIs() }
  static bestProvider(){ return resolveBestProvider() }
  static clearCache()  { _bestProviderCache = null }
}

module.exports = AIService
