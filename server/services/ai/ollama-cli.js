/**
 * Ollama CLI provider
 * Uses `ollama run <model>` — fully local, no keys needed.
 */

const { spawn } = require('child_process')

const BINARY = 'ollama'
const DEFAULT_MODEL = 'llama3'

async function complete(prompt, options = {}) {
  return chat('', [{ role: 'user', content: prompt }], options)
}

async function chat(systemPrompt, messages, options = {}) {
  const model = options.model || DEFAULT_MODEL
  const lastMsg = messages[messages.length - 1]?.content || ''

  // Build full prompt with system + history
  let fullPrompt = ''
  if (systemPrompt) fullPrompt += `System: ${systemPrompt}\n\n`
  const prior = messages.slice(0, -1)
  if (prior.length > 0) {
    fullPrompt += prior.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n') + '\n\n'
  }
  fullPrompt += lastMsg

  return new Promise((resolve, reject) => {
    const proc = spawn(BINARY, ['run', model], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''

    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stdin.write(fullPrompt)
    proc.stdin.end()

    proc.on('close', code => {
      if (code !== 0 && !stdout.trim()) return reject(new Error(`ollama exited ${code}`))
      resolve(stdout.trim())
    })
    proc.on('error', err => reject(new Error(`Failed to spawn ollama: ${err.message}`)))
  })
}

async function chatStream(systemPrompt, messages, onChunk, options = {}) {
  const model = options.model || DEFAULT_MODEL
  const lastMsg = messages[messages.length - 1]?.content || ''

  let fullPrompt = ''
  if (systemPrompt) fullPrompt += `System: ${systemPrompt}\n\n`
  fullPrompt += lastMsg

  return new Promise((resolve, reject) => {
    const proc = spawn(BINARY, ['run', model], { stdio: ['pipe', 'pipe', 'pipe'] })
    let fullText = ''

    proc.stdout.on('data', d => {
      const chunk = d.toString()
      fullText += chunk
      onChunk(chunk)
    })

    proc.stdin.write(fullPrompt)
    proc.stdin.end()

    proc.on('close', () => resolve(fullText))
    proc.on('error', err => reject(new Error(`Failed to spawn ollama: ${err.message}`)))
  })
}

module.exports = { complete, chat, chatStream }
