/**
 * Claude Code CLI provider
 *
 * Two modes:
 *
 *   chatStream / chat / complete
 *     Non-agentic — passes a prompt to --print and collects the output.
 *     Suitable for conversational steps (planning, requirements, spec generation)
 *     where Claude should reason but NOT touch the filesystem.
 *     Timeout: 3 min
 *
 *   agenticStream
 *     Agentic — runs Claude with --output-format stream-json in the target
 *     project directory. Claude gets full tool access (Read, Write, Edit, Bash,
 *     Glob, Grep) and makes file changes natively. Output is streamed token by
 *     token as Claude works. Tool invocations emit brief status lines.
 *     Timeout: 10 min
 */

const { spawn } = require('child_process')
const os = require('os')

const BINARY      = 'claude'
const DEFAULT_MODEL = 'sonnet'
const CHAT_TIMEOUT_MS    = 10 * 60 * 1000   // 10 min — planning/conversational steps
const AGENTIC_TIMEOUT_MS = 30 * 60 * 1000   // 30 min — agentic implementation (real coding work takes time)

// ── Build message text from conversation history ──────────────────────────────

function buildMessage(messages) {
  if (!messages || messages.length === 0) return ''

  const last  = messages[messages.length - 1]
  const prior = messages.slice(0, -1)

  if (prior.length === 0) return last.content || ''

  const transcript = prior
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  return `[Conversation so far]\n${transcript}\n\n[New message]\n${last.content}`
}

// ── Non-agentic spawn (single response, no tools) ─────────────────────────────

function spawnNonAgentic(systemPrompt, message, options = {}) {
  const model = options.model || DEFAULT_MODEL

  const args = [
    '--print',
    '--model', model,
    '--no-session-persistence',
    '--dangerously-skip-permissions',
  ]

  if (systemPrompt) args.push('--append-system-prompt', systemPrompt)
  args.push(message || '(no message)')

  // When no projectDir is specified, run from a neutral temp directory so
  // Claude CLI does NOT pick up any CLAUDE.md from the server's working
  // directory tree (which could inject wrong project context).
  const cwd = options.projectDir || os.tmpdir()

  const spawnOpts = {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd,
  }

  console.log(`[claude-cli:chat] ${args.slice(0, 4).join(' ')} ... cwd=${options.projectDir || '(tmp — no project context)'}`)
  return spawn(BINARY, args, spawnOpts)
}

// ── Public API: non-agentic ───────────────────────────────────────────────────

async function complete(prompt, options = {}) {
  return chat('', [{ role: 'user', content: prompt }], options)
}

async function chat(systemPrompt, messages, options = {}) {
  const message = buildMessage(messages)
  const proc = spawnNonAgentic(systemPrompt, message, options)

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })

    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error('Claude CLI timed out (10 min). Is claude authenticated? Run: claude /login'))
    }, CHAT_TIMEOUT_MS)

    proc.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) {
        const msg = stderr.trim() || stdout.trim() || 'unknown error'
        console.error(`[claude-cli] exited ${code}: ${msg.slice(0, 200)}`)
        return reject(new Error(`claude CLI exited ${code}: ${msg}`))
      }
      console.log(`[claude-cli] ok — ${stdout.trim().length} chars`)
      resolve(stdout.trim())
    })

    proc.on('error', err => {
      clearTimeout(timer)
      reject(new Error(`Failed to spawn claude: ${err.message}`))
    })
  })
}

// chatStream for non-agentic: Claude CLI returns full response at once;
// we call onChunk once when done (consistent with API provider behaviour).
async function chatStream(systemPrompt, messages, onChunk, options = {}) {
  const text = await chat(systemPrompt, messages, options)
  onChunk(text)
  return text
}

// ── Public API: agentic ───────────────────────────────────────────────────────

/**
 * Run Claude in full agentic mode with streaming JSON output.
 *
 * Claude reads and writes project files directly using its tools.
 * onChunk is called with human-readable text as Claude works —
 * assistant prose, plus brief notices for tool invocations.
 *
 * @param {string}   taskPrompt  – task description (CLAUDE.md provides project context)
 * @param {object}   options     – { projectDir, model, systemPrompt }
 * @param {function} onChunk     – called with each streamed text fragment
 * @returns {Promise<string>}    – the full accumulated text response
 */
async function agenticStream(taskPrompt, options = {}, onChunk) {
  const model = options.model || DEFAULT_MODEL

  const args = [
    '--print',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--no-session-persistence',
    '--dangerously-skip-permissions',
  ]

  if (options.systemPrompt) {
    args.push('--append-system-prompt', options.systemPrompt)
  }

  args.push(taskPrompt)

  const spawnOpts = {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(options.projectDir ? { cwd: options.projectDir } : {}),
  }

  console.log(`[claude-cli:agentic] streaming in cwd=${options.projectDir || '(server dir)'}`)

  const proc = spawn(BINARY, args, spawnOpts)

  return new Promise((resolve, reject) => {
    let lineBuffer = ''
    let fullText   = ''
    let stderr     = ''

    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error('Claude CLI timed out (10 min) during agentic execution'))
    }, AGENTIC_TIMEOUT_MS)

    proc.stdout.on('data', (data) => {
      lineBuffer += data.toString()
      const lines = lineBuffer.split('\n')
      lineBuffer = lines.pop() // Keep incomplete last line

      for (const line of lines) {
        if (!line.trim()) continue
        const chunk = parseStreamEvent(line)
        if (chunk) {
          fullText += chunk
          onChunk?.(chunk)
        }
      }
    })

    proc.stderr.on('data', d => { stderr += d.toString() })

    proc.on('close', (code) => {
      clearTimeout(timer)

      // Flush any remaining buffered line
      if (lineBuffer.trim()) {
        const chunk = parseStreamEvent(lineBuffer)
        if (chunk) { fullText += chunk; onChunk?.(chunk) }
      }

      if (code !== 0 && code !== null) {
        const msg = stderr.trim() || 'unknown error'
        console.error(`[claude-cli:agentic] exited ${code}: ${msg.slice(0, 200)}`)
        return reject(new Error(`claude CLI exited ${code}: ${msg}`))
      }

      console.log(`[claude-cli:agentic] complete — ${fullText.length} chars`)
      resolve(fullText)
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(new Error(`Failed to spawn claude: ${err.message}`))
    })
  })
}

// ── Parse a single stream-json event line ─────────────────────────────────────

function parseStreamEvent(line) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    // Not JSON — treat as raw text if non-empty
    return line.trim() ? line : ''
  }

  if (!event || !event.type) return ''

  switch (event.type) {

    case 'assistant': {
      // Assistant text chunks
      const content = event.message?.content
      if (!content) return ''
      return content
        .filter(c => c.type === 'text')
        .map(c => c.text || '')
        .join('')
    }

    case 'tool_use': {
      // Emit a brief one-line notice so the UI shows Claude working
      const name = event.name || ''
      const inp  = event.input || {}
      switch (name) {
        case 'Read':  return `\n> Reading \`${inp.file_path || inp.path || '?'}\`\n`
        case 'Write': return `\n> Writing \`${inp.file_path || inp.path || '?'}\`\n`
        case 'Edit':  return `\n> Editing \`${inp.file_path || inp.path || '?'}\`\n`
        case 'Glob':  return `\n> Searching \`${inp.pattern || '?'}\`\n`
        case 'Grep':  return `\n> Grepping for \`${inp.pattern || '?'}\`\n`
        case 'Bash':  return `\n> \`${(inp.command || '').slice(0, 80)}\`\n`
        default:      return `\n> ${name}...\n`
      }
    }

    case 'result': {
      // Final result block — only use if it adds content we haven't seen
      const r = event.result
      if (r && typeof r === 'string' && r.trim()) return `\n${r.trim()}\n`
      return ''
    }

    // system init, tool_result, error, etc. — skip
    default:
      return ''
  }
}

module.exports = { complete, chat, chatStream, agenticStream }
