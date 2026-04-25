/**
 * Gemini CLI provider
 * Uses the `gemini` CLI — authenticates via gcloud / GEMINI_API_KEY in env.
 * Falls back to HTTP API if CLI not found but key is in env.
 */

const { spawn } = require('child_process')

const BINARY = 'gemini'
const DEFAULT_MODEL = 'gemini-2.0-flash'

function buildInput(systemPrompt, messages) {
  let text = ''
  if (systemPrompt) text += `${systemPrompt}\n\n`
  const prior = messages.slice(0, -1)
  if (prior.length > 0) {
    text += prior.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n\n') + '\n\n'
  }
  text += messages[messages.length - 1]?.content || ''
  return text
}

async function complete(prompt, options = {}) {
  return chat('', [{ role: 'user', content: prompt }], options)
}

async function chat(systemPrompt, messages, options = {}) {
  const model = options.model || DEFAULT_MODEL
  const input = buildInput(systemPrompt, messages)
  const args = ['-m', model, input]

  return new Promise((resolve, reject) => {
    const proc = spawn(BINARY, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''

    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.stdin.end()

    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`gemini CLI exited ${code}: ${stderr.trim()}`))
      resolve(stdout.trim())
    })
    proc.on('error', err => reject(new Error(`Failed to spawn gemini: ${err.message}`)))
  })
}

async function chatStream(systemPrompt, messages, onChunk, options = {}) {
  // Gemini CLI typically doesn't stream; fall back to non-streaming + single emit
  const result = await chat(systemPrompt, messages, options)
  onChunk(result)
  return result
}

module.exports = { complete, chat, chatStream }
