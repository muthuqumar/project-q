/**
 * InitPage — first-run onboarding
 *
 * Two phases:
 *   1. AI Setup     — detect / select an AI provider
 *   2. Scanning     — auto-scan codebase + generate context files
 */

import React, { useState, useEffect } from 'react'
import { Check, ChevronRight, Loader, RefreshCw, AlertCircle, Zap, Search, FolderSearch, Brain, FileText, Users } from 'lucide-react'
import { useProject } from '../hooks/useProject'
import { useStore } from '../store'
import { useSocket } from '../hooks/useSocket'

const PHASES = ['ai', 'scanning']
const PHASE_LABELS = { ai: 'AI Setup', scanning: 'Scan Codebase' }

const SCAN_STEPS = [
  { step: 'scanning',     label: 'Reading codebase structure' },
  { step: 'analysing',    label: 'Analysing project' },
  { step: 'generating',   label: 'Generating context — takes ~30s' },
  { step: 'prd',          label: 'Saving PRD.md' },
  { step: 'architecture', label: 'Saving ARCHITECTURE.md' },
  { step: 'techstack',    label: 'Saving TECH_STACK.md' },
  { step: 'personas',     label: 'Saving PERSONAS.md' },
]

export default function InitPage({ onComplete }) {
  const [phase, setPhase]           = useState('ai')

  // AI setup
  const [providers, setProviders]   = useState([])
  const [selected, setSelected]     = useState(null)
  const [scanning, setScanning]     = useState(true)

  // Scan phase
  const [scanStarted, setScanStarted] = useState(false)
  const [stepStatus, setStepStatus]   = useState({})   // { [step]: 'pending'|'in_progress'|'done' }
  const [scanDone, setScanDone]       = useState(false)
  const [scanError, setScanError]     = useState(null)
  const [activeMsg, setActiveMsg]     = useState('')

  const { saveAIConfig, loadProject } = useProject()
  const { addNotification }           = useStore()
  const { socket }                    = useSocket()

  const phaseIdx = PHASES.indexOf(phase)

  // ── Detect AI providers on mount ────────────────────────────────────────────
  useEffect(() => { detectProviders() }, [])

  // ── Socket listeners for scan phase ─────────────────────────────────────────
  useEffect(() => {
    if (!socket || phase !== 'scanning') return

    const onProgress = ({ step, message }) => {
      setActiveMsg(message)
      setStepStatus(s => {
        // mark previous step done, current in_progress
        const next = { ...s }
        Object.keys(next).forEach(k => { if (next[k] === 'in_progress') next[k] = 'done' })
        next[step] = 'in_progress'
        return next
      })
    }

    const onComplete = () => {
      setStepStatus(s => {
        const next = { ...s }
        Object.keys(next).forEach(k => { next[k] = 'done' })
        return next
      })
      setScanDone(true)
    }

    const onError = ({ message }) => setScanError(message)

    socket.on('init:progress', onProgress)
    socket.on('init:complete', onComplete)
    socket.on('init:error',    onError)

    return () => {
      socket.off('init:progress', onProgress)
      socket.off('init:complete', onComplete)
      socket.off('init:error',    onError)
    }
  }, [socket, phase])

  // ── Auto-start scan when entering scan phase ─────────────────────────────────
  useEffect(() => {
    if (phase === 'scanning' && !scanStarted) {
      setScanStarted(true)
      runScan()
    }
  }, [phase])

  async function detectProviders() {
    setScanning(true)
    try {
      const res  = await fetch('/api/ai/detect')
      const data = await res.json()
      setProviders(data.providers || [])
      const first = (data.providers || []).find(p => p.available)
      if (first) setSelected({ provider: first.id, model: first.defaultModel })
    } catch {}
    setScanning(false)
  }

  async function handleAIContinue() {
    if (!selected) return
    try {
      // Save AI config + init project config
      await saveAIConfig({ provider: selected.provider, model: selected.model })
      setPhase('scanning')
    } catch (err) {
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function runScan() {
    setScanError(null)
    setScanDone(false)
    setStepStatus({ scanning: 'in_progress' })
    try {
      const res = await fetch('/api/init/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiConfig: { provider: selected.provider, model: selected.model } })
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Scan failed')
      // success is signalled by socket event; set done as fallback if socket missed it
      setScanDone(true)
      setStepStatus(s => {
        const next = { ...s }
        SCAN_STEPS.forEach(({ step }) => { next[step] = 'done' })
        return next
      })
    } catch (err) {
      setScanError(err.message)
    }
  }

  async function handleFinish() {
    await loadProject()
    onComplete?.()
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const availableProviders = providers.filter(p => p.available)
  const selectedDef        = providers.find(p => p.id === selected?.provider)

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* Header */}
      <div style={{
        padding: '20px 28px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <span style={{ fontSize: '24px' }}>🚀</span>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700 }}>Initialize project-q</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Set up your MI6 team — project-q reads your codebase automatically
            </p>
          </div>
        </div>

        {/* Phase stepper */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {PHASES.map((p, i) => {
            const isActive = p === phase
            const isDone   = i < phaseIdx
            return (
              <React.Fragment key={p}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '5px 12px', borderRadius: '100px', fontSize: '12px',
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'var(--accent-dim)' : isDone ? 'var(--green-dim)' : 'var(--bg-elevated)',
                  border: `1px solid ${isActive ? 'var(--accent)' : isDone ? 'var(--green)' : 'var(--border)'}`,
                  color: isActive ? 'var(--accent-hover)' : isDone ? 'var(--green)' : 'var(--text-muted)',
                  transition: 'all 0.2s'
                }}>
                  {isDone
                    ? <Check size={11} />
                    : <span style={{ width: '16px', textAlign: 'center', fontSize: '11px' }}>{i + 1}</span>
                  }
                  {PHASE_LABELS[p]}
                </div>
                {i < PHASES.length - 1 && <ChevronRight size={12} color="var(--text-muted)" />}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Phase content */}
      <div style={{ flex: 1, overflow: 'auto' }}>

        {/* ── Phase 1: AI Setup ── */}
        {phase === 'ai' && (
          <div style={{ padding: '28px', maxWidth: '600px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
              Select your AI provider
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '20px', lineHeight: 1.5 }}>
              project-q auto-detects AI tools installed on your machine. No API key needed for CLI providers.
            </p>

            {scanning ? (
              <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)', fontSize: '13px', alignItems: 'center', padding: '20px 0' }}>
                <Loader size={14} className="animate-spin" /> Scanning your system...
              </div>
            ) : availableProviders.length === 0 ? (
              <div style={{
                padding: '20px', textAlign: 'center', borderRadius: 'var(--radius-lg)',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', marginBottom: '20px'
              }}>
                <AlertCircle size={20} style={{ marginBottom: '8px', opacity: 0.4 }} />
                <div style={{ fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>No AI CLIs detected</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Install{' '}
                  <a href="https://claude.ai/download" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-hover)' }}>Claude Code</a>
                  {' '}or{' '}
                  <a href="https://ollama.ai" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-hover)' }}>Ollama</a>
                  , then re-scan.
                </div>
                <button className="btn btn-ghost btn-sm" onClick={detectProviders} style={{ marginTop: '12px' }}>
                  <RefreshCw size={12} /> Re-scan
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
                {availableProviders.map(p => (
                  <div
                    key={p.id}
                    onClick={() => setSelected({ provider: p.id, model: p.defaultModel })}
                    style={{
                      padding: '14px 16px', borderRadius: 'var(--radius-lg)', cursor: 'pointer',
                      background: selected?.provider === p.id ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                      border: `1px solid ${selected?.provider === p.id ? 'var(--accent)' : 'var(--border-bright)'}`,
                      display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.12s'
                    }}
                  >
                    <span style={{ fontSize: '22px' }}>{p.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{p.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                        {p.description}
                        {p.version && (
                          <span style={{ marginLeft: '8px', fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
                            {p.version.slice(0, 30)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div style={{
                      width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${selected?.provider === p.id ? 'var(--accent)' : 'var(--border-bright)'}`,
                      background: selected?.provider === p.id ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}>
                      {selected?.provider === p.id && (
                        <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#fff' }} />
                      )}
                    </div>
                  </div>
                ))}

                {/* Model selector */}
                {selectedDef && (
                  <div style={{ padding: '12px 16px', borderRadius: 'var(--radius)', background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                    <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: '6px' }}>
                      Model
                    </label>
                    <select
                      className="input-base"
                      value={selected?.model}
                      onChange={e => setSelected(s => ({ ...s, model: e.target.value }))}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                    >
                      {selectedDef.models.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}

            <button
              className="btn btn-primary"
              onClick={handleAIContinue}
              disabled={!selected}
              style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
            >
              <Search size={15} /> Scan codebase with {selectedDef?.name || '…'}
            </button>

            <button className="btn btn-ghost btn-sm" onClick={detectProviders} style={{ marginTop: '10px', width: '100%', justifyContent: 'center' }}>
              <RefreshCw size={12} /> Re-scan for AI tools
            </button>

            {/* What happens next */}
            <div style={{
              marginTop: '24px', padding: '16px', borderRadius: 'var(--radius)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: '12px'
            }}>
              <div style={{ fontWeight: 600, marginBottom: '10px', color: 'var(--text-secondary)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                What happens next
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {[
                  [FolderSearch, 'Reads source files, package.json, README, and git history'],
                  [Brain, 'AI analyses the codebase and generates 4 context files'],
                  [Users, 'MI6 team is briefed — Moneypenny, Mallory, Q, Bond, Tanner, Felix'],
                  [Zap, <>Workflows unlock — run <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-base)', padding: '1px 4px', borderRadius: '3px' }}>dev-now</code> or <code style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-base)', padding: '1px 4px', borderRadius: '3px' }}>feature-dev</code></>],
                ].map(([Icon, text], i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                    <Icon size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
                    <span>{text}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Phase 2: Scanning + Generation ── */}
        {phase === 'scanning' && (
          <div style={{ padding: '32px', maxWidth: '560px' }}>
            <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '6px' }}>
              {scanDone ? '✅ Codebase analysed!' : '🔍 Analysing your codebase...'}
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '24px', lineHeight: 1.5 }}>
              {scanDone
                ? 'Your MI6 team is briefed and ready to work on this project.'
                : activeMsg || 'Reading source files, package.json, README, and git history…'}
            </p>

            {/* Step progress list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '28px' }}>
              {SCAN_STEPS.map(({ step, label }) => {
                const status = stepStatus[step] || 'pending'
                return (
                  <div key={step} style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '10px 14px', borderRadius: 'var(--radius)',
                    background: status === 'done' ? 'var(--green-dim)' : status === 'in_progress' ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                    border: `1px solid ${status === 'done' ? 'rgba(34,197,94,0.2)' : status === 'in_progress' ? 'var(--accent)' : 'var(--border)'}`,
                    fontSize: '13px', transition: 'all 0.3s',
                    opacity: status === 'pending' ? 0.45 : 1
                  }}>
                    {status === 'done'
                      ? <Check size={15} color="var(--green)" />
                      : status === 'in_progress'
                      ? <Loader size={15} color="var(--accent-hover)" className="animate-spin" />
                      : <div style={{ width: '15px', height: '15px', borderRadius: '50%', border: '2px solid var(--border)', flexShrink: 0 }} />
                    }
                    <span style={{ color: status === 'done' ? 'var(--text-primary)' : status === 'in_progress' ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                      {label}
                    </span>
                  </div>
                )
              })}
            </div>

            {scanError && (
              <div style={{
                padding: '12px 16px', borderRadius: 'var(--radius)', marginBottom: '20px',
                background: 'var(--red-dim)', border: '1px solid rgba(239,68,68,0.2)',
                fontSize: '13px', color: 'var(--red)', display: 'flex', gap: '10px', alignItems: 'flex-start'
              }}>
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                <div>
                  <div style={{ fontWeight: 600, marginBottom: '4px' }}>Scan failed</div>
                  <div style={{ opacity: 0.8 }}>{scanError}</div>
                  <button className="btn btn-ghost btn-sm" onClick={runScan} style={{ marginTop: '8px' }}>
                    <RefreshCw size={12} /> Retry
                  </button>
                </div>
              </div>
            )}

            {scanDone && (
              <>
                <div style={{
                  padding: '14px 16px', borderRadius: 'var(--radius)', marginBottom: '20px',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: '12px'
                }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Files created in .project-q/context/
                  </div>
                  {['PRD.md', 'ARCHITECTURE.md', 'TECH_STACK.md', 'PERSONAS.md'].map(f => (
                    <div key={f} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0', color: 'var(--text-secondary)' }}>
                      <Check size={11} color="var(--green)" /> {f}
                    </div>
                  ))}
                </div>

                <button
                  className="btn btn-primary"
                  onClick={handleFinish}
                  style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: '14px' }}
                >
                  <Zap size={15} /> Open project-q Dashboard
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
