import React, { useState, useEffect } from 'react'
import { CheckCircle, AlertCircle, RefreshCw, Terminal, Zap, Key, ExternalLink, FolderOpen, AlertTriangle } from 'lucide-react'
import { useStore } from '../store'
import { useProject } from '../hooks/useProject'

export default function SettingsPage() {
  const { config, currentAI, setCurrentAI, addNotification } = useStore()
  const { saveAIConfig, testAI } = useProject()

  const [providers, setProviders]     = useState([])
  const [best, setBest]               = useState(null)
  const [selected, setSelected]       = useState(null)   // { provider, model }
  const [scanning, setScanning]       = useState(false)
  const [testing, setTesting]         = useState(false)
  const [testResult, setTestResult]   = useState(null)
  const [saving, setSaving]           = useState(false)
  const [showApiFallback, setShowApiFallback] = useState(false)
  const [apiKey, setApiKey]           = useState('')

  useEffect(() => { scan() }, [])

  async function scan() {
    setScanning(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/ai/detect')
      const data = await res.json()
      setProviders(data.providers || [])
      setBest(data.best)

      // Pre-select: saved config > best detected
      const saved = config?.ai
      const initial = saved || data.best
      if (initial) setSelected({ provider: initial.provider, model: initial.model })
    } catch (err) {
      addNotification({ type: 'error', message: `Scan failed: ${err.message}` })
    } finally {
      setScanning(false)
    }
  }

  async function handleTest() {
    if (!selected) return
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/ai/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: selected.provider, model: selected.model, apiKey: apiKey || undefined }),
      })
      const data = await res.json()
      setTestResult(data)
    } catch (err) {
      setTestResult({ success: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    if (!selected) return
    setSaving(true)
    try {
      await saveAIConfig({ provider: selected.provider, model: selected.model }, apiKey || undefined)
      setCurrentAI({ provider: selected.provider, model: selected.model })
      addNotification({ type: 'success', message: 'AI configuration saved!' })
    } catch (err) {
      addNotification({ type: 'error', message: err.message })
    } finally {
      setSaving(false)
    }
  }

  const selectedProviderDef = providers.find(p => p.id === selected?.provider)
  const availableProviders = providers.filter(p => p.available)
  const unavailableProviders = providers.filter(p => !p.available)

  return (
    <div style={{ padding: '24px', maxWidth: '700px', height: '100%', overflow: 'auto' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>Settings</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px' }}>
        project-q auto-detects AI tools installed on your system — no API keys needed.
      </p>

      {/* Target project */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <FolderOpen size={15} color="var(--accent-hover)" />
          <span style={{ fontWeight: 600, fontSize: '13px' }}>Target Project</span>
        </div>
        {config?.projectDir ? (
          <div>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: '12px',
              background: 'var(--bg-base)', padding: '8px 10px',
              borderRadius: 'var(--radius)', color: 'var(--text-primary)',
              border: '1px solid var(--border)', wordBreak: 'break-all'
            }}>
              {config.projectDir}
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '6px', marginBottom: 0 }}>
              All workflows and agents read and write files in this directory. Change by restarting project-q with a different <code style={{ fontFamily: 'var(--font-mono)' }}>PROJECT_DIR</code> environment variable.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <AlertTriangle size={14} color="var(--orange)" style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: '12px', color: 'var(--orange)', margin: 0 }}>
              <strong>PROJECT_DIR not set.</strong> project-q is targeting its own directory. Start the server with <code style={{ fontFamily: 'var(--font-mono)' }}>PROJECT_DIR=/path/to/your/project node server</code> to target your codebase.
            </p>
          </div>
        )}
      </div>

      {/* Auto-detection panel */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Detected AI Providers
            </div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
              Scanned from your system PATH
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={scan} disabled={scanning}>
            <RefreshCw size={13} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning...' : 'Re-scan'}
          </button>
        </div>

        {/* Available CLIs */}
        {availableProviders.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
            {availableProviders.map(p => (
              <ProviderRow
                key={p.id}
                provider={p}
                selected={selected?.provider === p.id}
                selectedModel={selected?.provider === p.id ? selected.model : null}
                onSelect={(model) => setSelected({ provider: p.id, model: model || p.defaultModel })}
                onModelChange={(model) => setSelected({ provider: p.id, model })}
              />
            ))}
          </div>
        ) : !scanning ? (
          <div style={{
            padding: '20px', textAlign: 'center', color: 'var(--text-muted)',
            background: 'var(--bg-elevated)', borderRadius: 'var(--radius)',
            fontSize: '13px', marginBottom: '16px'
          }}>
            <AlertCircle size={20} style={{ marginBottom: '8px', opacity: 0.4 }} />
            <div>No AI CLIs detected on your system.</div>
            <div style={{ fontSize: '11px', marginTop: '4px' }}>
              Install Claude Code, Ollama, or set an API key below.
            </div>
          </div>
        ) : (
          <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
            <RefreshCw size={16} className="animate-spin" style={{ marginBottom: '6px' }} />
            <div>Scanning for AI tools...</div>
          </div>
        )}

        {/* Unavailable CLIs — installed but not authed, or not installed */}
        {unavailableProviders.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', fontWeight: 600 }}>
              Unavailable
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {unavailableProviders.map(p => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: '10px',
                  padding: '8px 12px', borderRadius: 'var(--radius)',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  opacity: 0.65
                }}>
                  <span style={{ fontSize: '16px' }}>{p.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{p.name}</div>
                    {/* Installed but not authenticated */}
                    {p.installed && !p.authenticated ? (
                      <div style={{ fontSize: '11px', color: 'var(--yellow)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertCircle size={10} />
                        Not logged in — run <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-base)', padding: '0 4px', borderRadius: '3px' }}>
                          {p.id === 'claude-cli' ? 'claude /login' : `${p.binary} login`}
                        </code>
                      </div>
                    ) : (
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{p.description}</div>
                    )}
                  </div>
                  {!p.installed && <InstallHint providerId={p.id} />}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Test result */}
      {testResult && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '10px',
          padding: '12px 14px', borderRadius: 'var(--radius)', marginBottom: '12px',
          background: testResult.success ? 'var(--green-dim)' : 'var(--red-dim)',
          border: `1px solid ${testResult.success ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
          fontSize: '13px'
        }}>
          {testResult.success
            ? <CheckCircle size={15} color="var(--green)" style={{ flexShrink: 0, marginTop: '1px' }} />
            : <AlertCircle size={15} color="var(--red)"   style={{ flexShrink: 0, marginTop: '1px' }} />
          }
          <div>
            {testResult.success ? (
              <span style={{ color: 'var(--green)' }}>
                ✓ Connected — {testResult.provider} / {testResult.model}
                {testResult.reply && ` — replied: "${testResult.reply}"`}
              </span>
            ) : (
              <span style={{ color: 'var(--red)' }}>{testResult.error}</span>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || !selected}
          style={{ flex: 1, justifyContent: 'center' }}
        >
          <Zap size={14} /> {saving ? 'Saving...' : 'Use Selected Provider'}
        </button>
        <button className="btn btn-ghost" onClick={handleTest} disabled={testing || !selected}>
          {testing ? 'Testing...' : 'Test'}
        </button>
      </div>

      {/* API key fallback — collapsed by default */}
      <div className="card">
        <button
          onClick={() => setShowApiFallback(v => !v)}
          style={{
            width: '100%', background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '8px', padding: 0,
            color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.06em'
          }}
        >
          <Key size={13} />
          Use API Key Instead
          <span style={{ marginLeft: 'auto', fontSize: '16px' }}>{showApiFallback ? '−' : '+'}</span>
        </button>

        {showApiFallback && (
          <div style={{ marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
              If you prefer to use an API key directly (without the CLI), enter it below.
              It will be saved to your project's <code style={{ fontFamily: 'var(--font-mono)', fontSize: '11px' }}>.env</code> file.
            </p>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', fontWeight: 600 }}>
                API Key
              </label>
              <input
                className="input-base"
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="sk-ant-... / sk-... / AIza..."
                style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
              />
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {[
                { id: 'claude',  label: 'Anthropic', url: 'https://console.anthropic.com/settings/keys' },
                { id: 'openai',  label: 'OpenAI',    url: 'https://platform.openai.com/api-keys' },
                { id: 'gemini',  label: 'Google',    url: 'https://aistudio.google.com/apikey' },
              ].map(p => (
                <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer"
                  style={{
                    fontSize: '11px', color: 'var(--accent-hover)',
                    display: 'flex', alignItems: 'center', gap: '3px'
                  }}>
                  {p.label} <ExternalLink size={10} />
                </a>
              ))}
            </div>
            <button className="btn btn-ghost btn-sm" onClick={handleSave} disabled={saving || !apiKey}>
              Save API Key
            </button>
          </div>
        )}
      </div>

      {/* Active config */}
      {config?.ai && (
        <div className="card" style={{ marginTop: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
            Active Configuration
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
            <InfoRow label="Provider" value={config.ai.provider} />
            <InfoRow label="Model"    value={config.ai.model} mono />
            <InfoRow label="Project"  value={config.projectDir?.split('/').pop()} mono />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ProviderRow({ provider: p, selected, selectedModel, onSelect, onModelChange }) {
  return (
    <div
      onClick={() => !selected && onSelect(p.defaultModel)}
      style={{
        padding: '12px 14px', borderRadius: 'var(--radius)', cursor: 'pointer',
        background: selected ? 'var(--accent-dim)' : 'var(--bg-elevated)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-bright)'}`,
        transition: 'all 0.12s'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* Icon + check */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <span style={{ fontSize: '20px' }}>{p.icon}</span>
          <div style={{
            position: 'absolute', bottom: '-2px', right: '-4px',
            width: '10px', height: '10px', borderRadius: '50%',
            background: 'var(--green)', border: '2px solid var(--bg-elevated)'
          }} />
        </div>

        {/* Name + description */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{p.name}</span>
            <span style={{
              fontSize: '10px', color: 'var(--green)',
              background: 'var(--green-dim)', padding: '1px 6px', borderRadius: '100px'
            }}>
              <Terminal size={8} style={{ verticalAlign: 'middle', marginRight: '2px' }} />
              CLI
            </span>
            {p.version && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {p.version.replace(/^claude /i, '').slice(0, 20)}
              </span>
            )}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '1px' }}>
            {p.description}
          </div>
        </div>

        {/* Selected radio */}
        <div style={{
          width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0,
          border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-bright)'}`,
          background: selected ? 'var(--accent)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          {selected && <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff' }} />}
        </div>
      </div>

      {/* Model selector — only show for selected provider */}
      {selected && (
        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border)' }}
          onClick={e => e.stopPropagation()}>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px', fontWeight: 600 }}>
            Model
          </label>
          <select
            className="input-base"
            value={selectedModel || p.defaultModel}
            onChange={e => onModelChange(e.target.value)}
            style={{ fontSize: '12px', fontFamily: 'var(--font-mono)' }}
          >
            {p.models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

function InstallHint({ providerId }) {
  const hints = {
    'ollama':     { label: 'Install Ollama', url: 'https://ollama.ai', cmd: 'brew install ollama' },
    'gemini-cli': { label: 'Install Gemini CLI', url: 'https://github.com/google-gemini/gemini-cli', cmd: 'npm i -g @google/gemini-cli' },
    'openai-cli': { label: 'Install OpenAI CLI', url: 'https://github.com/openai/openai-node', cmd: 'npm install openai' },
  }
  const hint = hints[providerId]
  if (!hint) return null

  return (
    <a href={hint.url} target="_blank" rel="noopener noreferrer"
      style={{ fontSize: '11px', color: 'var(--accent-hover)', display: 'flex', alignItems: 'center', gap: '3px', flexShrink: 0 }}>
      Install <ExternalLink size={10} />
    </a>
  )
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{
        color: 'var(--text-secondary)',
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        fontSize: mono ? '11px' : '12px'
      }}>{value}</span>
    </div>
  )
}
