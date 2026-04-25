/**
 * OpenAI / Codex provider
 */

const DEFAULT_MODEL = 'gpt-4o'

async function getClient(apiKey) {
  const OpenAI = require('openai')
  return new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY })
}

async function complete(prompt, options = {}) {
  const client = await getClient(options.apiKey)
  const model = options.model || DEFAULT_MODEL

  const response = await client.chat.completions.create({
    model,
    max_tokens: options.maxTokens || 4096,
    messages: [{ role: 'user', content: prompt }]
  })

  return response.choices[0]?.message?.content || ''
}

async function chat(systemPrompt, messages, options = {}) {
  const client = await getClient(options.apiKey)
  const model = options.model || DEFAULT_MODEL

  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ]

  const response = await client.chat.completions.create({
    model,
    max_tokens: options.maxTokens || 4096,
    messages: openaiMessages
  })

  return response.choices[0]?.message?.content || ''
}

async function chatStream(systemPrompt, messages, onChunk, options = {}) {
  const client = await getClient(options.apiKey)
  const model = options.model || DEFAULT_MODEL

  const openaiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ]

  const stream = await client.chat.completions.create({
    model,
    max_tokens: options.maxTokens || 4096,
    messages: openaiMessages,
    stream: true
  })

  let fullText = ''
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || ''
    if (text) {
      fullText += text
      onChunk(text)
    }
  }
  return fullText
}

module.exports = { complete, chat, chatStream }
