/**
 * Claude (Anthropic) provider
 */

const DEFAULT_MODEL = 'claude-opus-4-6'
const MAX_TOKENS = 8192

async function getClient(apiKey) {
  const Anthropic = require('@anthropic-ai/sdk')
  return new Anthropic({ apiKey: apiKey || process.env.ANTHROPIC_API_KEY })
}

async function complete(prompt, options = {}) {
  const client = await getClient(options.apiKey)
  const model = options.model || DEFAULT_MODEL

  const response = await client.messages.create({
    model,
    max_tokens: options.maxTokens || MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }]
  })

  return response.content[0]?.text || ''
}

async function chat(systemPrompt, messages, options = {}) {
  const client = await getClient(options.apiKey)
  const model = options.model || DEFAULT_MODEL

  const response = await client.messages.create({
    model,
    max_tokens: options.maxTokens || MAX_TOKENS,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content }))
  })

  return response.content[0]?.text || ''
}

async function chatStream(systemPrompt, messages, onChunk, options = {}) {
  const client = await getClient(options.apiKey)
  const model = options.model || DEFAULT_MODEL

  const stream = await client.messages.stream({
    model,
    max_tokens: options.maxTokens || MAX_TOKENS,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content }))
  })

  let fullText = ''
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
      fullText += chunk.delta.text
      onChunk(chunk.delta.text)
    }
  }
  return fullText
}

module.exports = { complete, chat, chatStream }
