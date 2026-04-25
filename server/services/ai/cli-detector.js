/**
 * CLI Auto-Detector
 * Scans the system for available AI CLI tools and returns their status.
 * No API keys required — uses whatever is already installed and authenticated.
 */

const { execSync, spawnSync } = require('child_process')
const path = require('path')

// ── CLI definitions ────────────────────────────────────────────────────────────

const CLI_DEFS = [
  {
    id: 'claude-cli',
    name: 'Claude (CLI)',
    icon: '🟠',
    binary: 'claude',
    versionCmd: ['--version'],
    models: ['opus', 'sonnet', 'haiku',
             'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    defaultModel: 'sonnet',
    description: 'Claude Code CLI — already authenticated, no key needed',
    testPrompt: 'Reply with exactly: ok',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    icon: '🦙',
    binary: 'ollama',
    versionCmd: ['--version'],
    models: ['llama3', 'codellama', 'mistral', 'deepseek-coder', 'phi3', 'gemma3'],
    defaultModel: 'llama3',
    description: 'Local models via Ollama — private, offline',
    testPrompt: 'Reply with exactly: ok',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini (CLI)',
    icon: '🔵',
    binary: 'gemini',
    versionCmd: ['--version'],
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    defaultModel: 'gemini-2.0-flash',
    description: 'Google Gemini CLI — uses your gcloud auth',
    testPrompt: 'Reply with exactly: ok',
  },
  {
    id: 'openai-cli',
    name: 'OpenAI (CLI)',
    icon: '🟢',
    binary: 'openai',
    versionCmd: ['--version'],
    models: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
    defaultModel: 'gpt-4o',
    description: 'OpenAI CLI — uses OPENAI_API_KEY env var',
    testPrompt: 'Reply with exactly: ok',
  },
]

// ── Detection logic ────────────────────────────────────────────────────────────

function which(binary) {
  try {
    const result = execSync(`which ${binary} 2>/dev/null`, { encoding: 'utf8', timeout: 3000 })
    return result.trim() || null
  } catch {
    return null
  }
}

function getVersion(binary, versionCmd) {
  try {
    const result = spawnSync(binary, versionCmd, { encoding: 'utf8', timeout: 5000 })
    if (result.status === 0) {
      return (result.stdout || result.stderr || '').trim().split('\n')[0]
    }
  } catch {}
  return null
}

/**
 * Check if a CLI is not just installed but also authenticated / ready.
 * Returns { installed, authenticated, version, error }
 */
function checkCLIAuth(def) {
  const binPath = which(def.binary)
  if (!binPath) return { installed: false, authenticated: false, version: null, binPath: null }

  const version = getVersion(def.binary, def.versionCmd)

  // Probe with a trivial prompt to confirm auth works
  try {
    let probeArgs = []

    if (def.id === 'claude-cli') {
      probeArgs = ['--print', '--model', 'haiku', '--no-session-persistence', def.testPrompt]
    } else if (def.id === 'ollama') {
      // Just check `ollama list` — doesn't need a full inference
      const r = spawnSync('ollama', ['list'], { encoding: 'utf8', timeout: 5000 })
      return { installed: true, authenticated: r.status === 0, version, binPath, error: null }
    } else {
      // For other CLIs, just mark as installed (full auth probe is slow)
      return { installed: true, authenticated: true, version, binPath, error: null }
    }

    const result = spawnSync(def.binary, probeArgs, { encoding: 'utf8', timeout: 15000 })
    const stderr = (result.stderr || '').toLowerCase()
    const notLoggedIn = stderr.includes('not logged in') || stderr.includes('login') || result.status !== 0

    return {
      installed: true,
      authenticated: !notLoggedIn,
      version,
      binPath,
      error: notLoggedIn ? (result.stderr || '').trim().split('\n')[0] : null,
    }
  } catch (e) {
    return { installed: true, authenticated: false, version, binPath, error: e.message }
  }
}

/**
 * Detect all available AI CLIs.
 * Returns an array of provider objects with `available`, `installed`,
 * `authenticated` and `version` set.
 */
function detectCLIs() {
  return CLI_DEFS.map(def => {
    const auth = checkCLIAuth(def)
    // `available` = installed AND authenticated (ready to use)
    const available = auth.installed && auth.authenticated

    return {
      ...def,
      installed:      auth.installed,
      authenticated:  auth.authenticated,
      available,
      binPath:        auth.binPath,
      version:        auth.version,
      authError:      auth.error,
      configured:     available,
      envKey:         null,
    }
  })
}

/**
 * Get the best available provider (first detected CLI, in priority order).
 */
function getBestProvider() {
  const detected = detectCLIs()
  const available = detected.filter(p => p.available)
  if (available.length === 0) return null
  return { provider: available[0].id, model: available[0].defaultModel }
}

module.exports = { detectCLIs, getBestProvider, CLI_DEFS }
