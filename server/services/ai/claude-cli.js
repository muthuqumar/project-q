/**
 * Claude Code CLI provider
 *
 * Uses `claude -p` (print/non-interactive mode) — already authenticated,
 * no ANTHROPIC_API_KEY required.
 *
 * Key flags used:
 *   -p / --print              Non-interactive, print to stdout and exit
 *   --model <alias|full>      e.g. "sonnet", "opus", "claude-sonnet-4-6"
 *   --append-system-prompt    Inject a system prompt without overriding the default
 *   --no-session-persistence  Don't write session files for these calls
 *   --output-format text      Plain text output (default)
 *   --output-format stream-json  Newline-delimited JSON events for streaming
 */

const { spawn } = require('child_process')

const BINARY = 'claude'
const DEFAULT_MODEL = 'sonnet'

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildArgs(model, systemPrompt, opts = {}) {
  const args = [
    '--print',
    '--model', model || DEFAULT_MODEL,
    '--no-session-persistence',
  ]

  if (systemPrompt) {
    // --append-system-prompt keeps Claude Code's own context + adds ours
    args.push('--append-system-prompt', systemPrompt)
  }

  if (opts.stream) {
    args.push('--output-format', 'stream-json')
  }

  return args
}

/**
 * Build the user message text from a message history.
 * Claude CLI receives the last user message via stdin; prior turns are
 * embedded in the system prompt as a conversation transcript.
 */
function buildInput(messages) {
  if (!messages || messages.length === 0) return ''

  // Separate the last user message from the transcript
  const last = messages[messages.length - 1]
  const prior = messages.slice(0, -1)

  if (prior.length === 0) return last.content

  const transcript = prior
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  return `[Conversation so far]\n${transcript}\n\n[New message]\n${last.content}`
}

// ── Public API ─────────────────────────────────────────────────────────────────

async function complete(prompt, options = {}) {
  return chat('', [{ role: 'user', content: prompt }], options)
}

async function chat(systemPrompt, messages, options = {}) {
  const model = options.model || DEFAULT_MODEL
  const input = buildInput(messages)
  const args  = buildArgs(model, systemPrompt, { stream: false })

  return new Promise((resolve, reject) => {
    const proc = spawn(BINARY, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })

    proc.stdin.write(input)
    proc.stdin.end()

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`claude CLI exited ${code}: ${stderr.trim() || stdout.trim()}`))
      }
      resolve(stdout.trim())
    })

    proc.on('error', err => reject(new Error(`Failed to spawn claude: ${err.message}`)))
  })
}

async function chatStream(systemPrompt, messages, onChunk, options = {}) {
  const model = options.model || DEFAULT_MODEL
  const input = buildInput(messages)
  const args  = buildArgs(model, systemPrompt, { stream: true })

  return new Promise((resolve, reject) => {
    const proc = spawn(BINARY, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let fullText = ''
    let buffer = ''
    let stderr = ''

    proc.stdout.on('data', raw => {
      buffer += raw.toString()
      // stream-json emits one JSON object per line
      const lines = buffer.split('\n')
      buffer = lines.pop() // keep incomplete last line

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          // assistant text delta
          const text = event?.message?.content?.[0]?.text
                    ?? event?.delta?.text
                    ?? event?.result   // final result field in some versions
                    ?? null
          if (text) {
            fullText += text
            onChunk(text)
          }
        } catch {
          // Some lines may be plain text in older CLI versions
          if (line.trim()) {
            fullText += line + '\n'
            onChunk(line + '\n')
          }
        }
      }
    })

    proc.stderr.on('data', d => { stderr += d.toString() })

    proc.stdin.write(input)
    proc.stdin.end()

    proc.on('close', code => {
      // Flush any remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer)
          const text = event?.result ?? event?.message?.content?.[0]?.text ?? ''
          if (text) { fullText += text; onChunk(text) }
        } catch {
          if (buffer.trim()) { fullText += buffer; onChunk(buffer) }
        }
      }

      if (code !== 0 && !fullText) {
        return reject(new Error(`claude CLI exited ${code}: ${stderr.trim()}`))
      }
      resolve(fullText)
    })

    proc.on('error', err => reject(new Error(`Failed to spawn claude: ${err.message}`)))
  })
}

module.exports = { complete, chat, chatStream }
