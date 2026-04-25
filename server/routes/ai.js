const express = require('express')
const router = express.Router()
const fs = require('fs-extra')
const path = require('path')
const AIService = require('../services/ai')
const { detectCLIs } = require('../services/ai/cli-detector')

// GET /api/ai/detect — scan system for available AI CLIs
router.get('/detect', (req, res) => {
  try {
    const clis = detectCLIs()
    const best = AIService.bestProvider()
    res.json({ providers: clis, best })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/ai/providers — list providers (CLIs + API fallbacks)
router.get('/providers', (req, res) => {
  try {
    const clis = detectCLIs()
    const best = AIService.bestProvider()

    // Merge CLI-detected providers with API fallbacks
    const providers = [
      ...clis.map(c => ({
        id:          c.id,
        name:        c.name,
        icon:        c.icon,
        models:      c.models,
        defaultModel: c.defaultModel,
        description: c.description,
        version:     c.version,
        configured:  c.available,
        available:   c.available,
        type:        'cli',
        envKey:      null,
      })),
      // API fallbacks — only show if key is present
      ...(process.env.ANTHROPIC_API_KEY ? [{
        id: 'claude', name: 'Claude (API key)', icon: '🔑', type: 'api',
        models: ['claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
        defaultModel: 'claude-sonnet-4-6',
        description: 'Anthropic API — via ANTHROPIC_API_KEY',
        configured: true, available: true, envKey: 'ANTHROPIC_API_KEY',
      }] : []),
      ...(process.env.OPENAI_API_KEY ? [{
        id: 'openai', name: 'OpenAI (API key)', icon: '🔑', type: 'api',
        models: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
        defaultModel: 'gpt-4o',
        description: 'OpenAI API — via OPENAI_API_KEY',
        configured: true, available: true, envKey: 'OPENAI_API_KEY',
      }] : []),
      ...(process.env.GEMINI_API_KEY ? [{
        id: 'gemini', name: 'Gemini (API key)', icon: '🔑', type: 'api',
        models: ['gemini-1.5-pro', 'gemini-1.5-flash'],
        defaultModel: 'gemini-1.5-pro',
        description: 'Google Gemini API — via GEMINI_API_KEY',
        configured: true, available: true, envKey: 'GEMINI_API_KEY',
      }] : []),
    ]

    res.json({ providers, best })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/ai/test — test a provider (no key needed for CLI providers)
router.post('/test', async (req, res) => {
  const { provider, model, apiKey } = req.body
  try {
    AIService.clearCache()                      // re-detect in case env changed
    const ai = new AIService({ provider: provider || 'auto', model, apiKey })
    const reply = await ai.complete('Reply with exactly: ok')
    res.json({ success: true, reply: reply.trim(), provider: ai.provider, model: ai.model })
  } catch (err) {
    res.status(400).json({ success: false, error: err.message })
  }
})

// POST /api/ai/chat — general chat endpoint
router.post('/chat', async (req, res) => {
  const { message, history, systemPrompt, aiConfig } = req.body
  const pqDir = req.app.get('pqDir')

  try {
    const config = await loadConfig(pqDir)
    const aiConf = aiConfig || config?.ai || { provider: 'auto' }

    const ai = new AIService(aiConf)
    const reply = await ai.chat(systemPrompt || 'You are a helpful AI assistant.', [
      ...(history || []),
      { role: 'user', content: message },
    ])
    res.json({ reply, provider: ai.provider, model: ai.model })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /api/ai/config — save AI config (provider + model, no key required for CLIs)
router.put('/config', async (req, res) => {
  const pqDir = req.app.get('pqDir')
  const { provider, model, apiKey } = req.body

  try {
    const configPath = path.join(pqDir, 'config.json')
    const config = (await fs.pathExists(configPath)) ? await fs.readJson(configPath) : {}

    config.ai = { provider: provider || 'auto', model }
    await fs.writeJson(configPath, config, { spaces: 2 })

    // Persist API key to .env only if provided (CLI users never need this)
    if (apiKey) {
      const envPath = path.join(path.dirname(pqDir), '.env')
      const keyMap = { claude: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' }
      const envKey = keyMap[provider]
      if (envKey) {
        let envContent = (await fs.pathExists(envPath)) ? await fs.readFile(envPath, 'utf8') : ''
        const regex = new RegExp(`^${envKey}=.*$`, 'm')
        envContent = regex.test(envContent)
          ? envContent.replace(regex, `${envKey}=${apiKey}`)
          : (envContent.trim() + `\n${envKey}=${apiKey}`)
        await fs.writeFile(envPath, envContent.trim())
        process.env[envKey] = apiKey
      }
    }

    AIService.clearCache()
    res.json({ success: true, config: config.ai })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

async function loadConfig(pqDir) {
  const p = path.join(pqDir, 'config.json')
  return (await fs.pathExists(p)) ? fs.readJson(p) : {}
}

module.exports = router
