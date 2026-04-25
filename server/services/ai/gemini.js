/**
 * Google Gemini provider
 */

const DEFAULT_MODEL = 'gemini-1.5-pro'

async function getClient(apiKey) {
  // Using fetch-based approach since @google/generative-ai may not be installed
  const key = apiKey || process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is required')
  return { apiKey: key }
}

async function complete(prompt, options = {}) {
  const { apiKey } = await getClient(options.apiKey)
  const model = options.model || DEFAULT_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: options.maxTokens || 4096 }
    })
  })

  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

async function chat(systemPrompt, messages, options = {}) {
  const { apiKey } = await getClient(options.apiKey)
  const model = options.model || DEFAULT_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  // Convert messages to Gemini format
  const contents = []
  if (systemPrompt) {
    contents.push({ role: 'user', parts: [{ text: `System instructions: ${systemPrompt}` }] })
    contents.push({ role: 'model', parts: [{ text: 'Understood. I will follow these instructions.' }] })
  }
  for (const msg of messages) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    })
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: { maxOutputTokens: options.maxTokens || 4096 }
    })
  })

  const data = await response.json()
  if (data.error) throw new Error(data.error.message)
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

module.exports = { complete, chat }
