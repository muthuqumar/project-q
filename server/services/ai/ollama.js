/**
 * Ollama (local models) provider
 */

const DEFAULT_MODEL = 'llama3'
const DEFAULT_BASE_URL = 'http://localhost:11434'

function getBaseUrl(options) {
  return options.baseUrl || process.env.OLLAMA_BASE_URL || DEFAULT_BASE_URL
}

async function complete(prompt, options = {}) {
  const baseUrl = getBaseUrl(options)
  const model = options.model || DEFAULT_MODEL

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false })
  })

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.response || ''
}

async function chat(systemPrompt, messages, options = {}) {
  const baseUrl = getBaseUrl(options)
  const model = options.model || DEFAULT_MODEL

  const ollamaMessages = []
  if (systemPrompt) {
    ollamaMessages.push({ role: 'system', content: systemPrompt })
  }
  ollamaMessages.push(...messages.map(m => ({ role: m.role, content: m.content })))

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: ollamaMessages, stream: false })
  })

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()
  return data.message?.content || ''
}

async function chatStream(systemPrompt, messages, onChunk, options = {}) {
  const baseUrl = getBaseUrl(options)
  const model = options.model || DEFAULT_MODEL

  const ollamaMessages = []
  if (systemPrompt) {
    ollamaMessages.push({ role: 'system', content: systemPrompt })
  }
  ollamaMessages.push(...messages.map(m => ({ role: m.role, content: m.content })))

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: ollamaMessages, stream: true })
  })

  if (!response.ok) throw new Error(`Ollama error: ${response.status}`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    try {
      const json = JSON.parse(chunk)
      const text = json.message?.content || ''
      if (text) {
        fullText += text
        onChunk(text)
      }
    } catch (e) { /* ignore parse errors on partial chunks */ }
  }

  return fullText
}

module.exports = { complete, chat, chatStream }
