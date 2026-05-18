import React, { useState, useRef, useEffect } from 'react'
import { Send, Zap, Bug, ChevronRight, Check, Square, Loader, RotateCcw, FolderSearch } from 'lucide-react'
import ChatBubble from '../Common/ChatBubble'
import Terminal from '../Common/Terminal'
import { useProject } from '../../hooks/useProject'
import { useSocket } from '../../hooks/useSocket'
import { useStore } from '../../store'

const WORKFLOW_CONFIG = {
  'dev-now': {
    Icon: Zap,
    name: 'dev-now',
    subtitle: 'Quick implementation workflow',
    steps: ['understand', 'clarify', 'implement'],
    labels: { understand: 'Understand', clarify: 'Clarify', implement: 'Implement' },
    firstPlaceholder: 'Describe what you want to build or change...',
    successMsg: 'Implementation complete',
    agents: { understand: 'Orchestrator', clarify: 'Moneypenny', implement: 'James Bond' }
  },
  'bug-fix': {
    Icon: Bug,
    name: 'bug-fix',
    subtitle: 'Investigation-first bug resolution',
    steps: ['investigate', 'clarify', 'implement'],
    labels: { investigate: 'Investigate', clarify: 'Clarify', implement: 'Fix' },
    firstPlaceholder: 'Describe the bug — what happens vs what should happen...',
    successMsg: 'Fix applied',
    agents: { investigate: 'Tanner', clarify: 'Tanner', implement: 'James Bond' }
  },
}

const AGENT_COLORS = {
  'Orchestrator': 'var(--accent-hover)',
  'Moneypenny':   'var(--green)',
  'Tanner':       'var(--red)',
  'James Bond':   'var(--accent-hover)',
}

export default function DevNow({ workflowId: propWorkflowId }) {
  const wfConfig = WORKFLOW_CONFIG[propWorkflowId] || WORKFLOW_CONFIG['dev-now']
  const STEPS = wfConfig.steps
  const STEP_LABELS = wfConfig.labels
  const actualWorkflowId = propWorkflowId || 'dev-now'
  const firstStep = STEPS[0]

  const [step, setStep] = useState(firstStep)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMsg, setLoadingMsg] = useState('')
  const [executionId, setExecutionId] = useState(null)
  const [logs, setLogs] = useState([])
  const [streamText, setStreamText] = useState('')
  const [clarifications, setClarifications] = useState([])
  const [prompt, setPrompt] = useState('')
  const [done, setDone] = useState(false)
  const [stopped, setStopped] = useState(false)

  const { runWorkflowStep, runWorkflow, stopExecution } = useProject()
  const { subscribeToExecution, subscribeToStepStream } = useSocket()
  const { addNotification, config } = useStore()
  const inputRef = useRef(null)
  const messagesEndRef = useRef(null)
  const streamIdRef = useRef(null)
  const Icon = wfConfig.Icon

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history.length])

  useEffect(() => {
    if (!loading && !done && inputRef.current) inputRef.current.focus()
  }, [loading, step])

  useEffect(() => {
    if (executionId) {
      const unsub = subscribeToExecution(executionId, {
        onLog: (entry) => setLogs(l => [...l, entry]),
        onStream: (chunk) => setStreamText(t => t + chunk),
        onComplete: () => {
          setLoading(false)
          setDone(true)
          addNotification({ type: 'success', message: wfConfig.successMsg })
        },
        onStopped: () => {
          setLoading(false)
          setStopped(true)
          setLoadingMsg('')
        },
        onError: (msg) => {
          setLoading(false)
          addNotification({ type: 'error', message: `${actualWorkflowId} failed: ${msg}` })
        }
      })
      return unsub
    }
  }, [executionId])

  async function handleSend(e) {
    e?.preventDefault()
    if (!input.trim() || loading) return

    const message = input.trim()
    setInput('')
    setLoading(true)
    setLoadingMsg(`${wfConfig.agents[step] || 'Agent'} is thinking...`)

    const userMsg = { role: 'user', content: message }
    const newHistory = [...history, userMsg]
    setHistory(newHistory)

    // Add an empty streaming assistant placeholder
    setHistory(h => [...h, { role: 'assistant', content: '', _streaming: true }])

    // Set up streaming for this step
    const streamId = `${actualWorkflowId}-${Date.now()}`
    streamIdRef.current = streamId

    const unsub = subscribeToStepStream(streamId, {
      onChunk: (chunk) => {
        setHistory(h => h.map((m, i) =>
          i === h.length - 1 && m._streaming
            ? { ...m, content: m.content + chunk }
            : m
        ))
        setLoadingMsg('')
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
      },
      onError: (errMsg) => {
        unsub()
        setHistory(h => h.filter(m => !m._streaming))
        setLoading(false)
        setLoadingMsg('')
        addNotification({ type: 'error', message: errMsg || 'Step failed' })
      }
    })

    try {
      const currentStep2 = step  // capture before async
      if (step === firstStep) {
        setPrompt(message)
        const res = await runWorkflowStep(actualWorkflowId, step, message, newHistory.slice(0, -1), streamId)
        unsub()
        // Finalize the streaming bubble with the clean reply
        setHistory(h => h.map((m, i) =>
          i === h.length - 1 && m._streaming ? { role: 'assistant', content: res.reply } : m
        ))
        setStep('clarify')
        setLoading(false)
        setLoadingMsg('')

      } else if (step === 'clarify') {
        setClarifications(c => [...c, message])
        const res = await runWorkflowStep(actualWorkflowId, 'clarify', message, newHistory, streamId)
        unsub()
        setHistory(h => h.map((m, i) =>
          i === h.length - 1 && m._streaming ? { role: 'assistant', content: res.reply } : m
        ))
        setLoading(false)
        setLoadingMsg('')

        if (res.readyToImplement || res.rootCauseFound) {
          setTimeout(() => handleImplement(), 500)
        }
      }
    } catch (err) {
      unsub()
      // Remove the streaming placeholder on error
      setHistory(h => h.filter(m => !m._streaming))
      setLoading(false)
      setLoadingMsg('')
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function handleImplement() {
    setStep('implement')
    setLoading(true)
    setLoadingMsg('Scanning project files...')
    setStreamText('')
    setLogs([])
    setStopped(false)

    try {
      const res = await runWorkflow(actualWorkflowId, { prompt, clarifications })
      setExecutionId(res.executionId)
      setLoadingMsg('James Bond is implementing...')
    } catch (err) {
      setLoading(false)
      setLoadingMsg('')
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function handleStop() {
    if (executionId) {
      await stopExecution(executionId)
    }
    setLoading(false)
    setStopped(true)
    setLoadingMsg('')
  }

  function handleReset() {
    setStep(firstStep)
    setInput('')
    setHistory([])
    setLoading(false)
    setLoadingMsg('')
    setExecutionId(null)
    setLogs([])
    setStreamText('')
    setClarifications([])
    setPrompt('')
    setDone(false)
    setStopped(false)
  }

  const activeAgent = wfConfig.agents[step] || ''
  const agentColor = AGENT_COLORS[activeAgent] || 'var(--text-muted)'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '32px', height: '32px', borderRadius: 'var(--radius)',
              background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}>
              <Icon size={16} color="var(--accent-hover)" strokeWidth={1.75} />
            </div>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{wfConfig.name}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{wfConfig.subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {loading && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleStop}
                style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                title="Stop execution"
              >
                <Square size={12} fill="currentColor" /> Stop
              </button>
            )}
            {(done || stopped || history.length > 0) && !loading && (
              <button className="btn btn-ghost btn-sm" onClick={handleReset} title="Start over">
                <RotateCcw size={12} /> Reset
              </button>
            )}
          </div>
        </div>

        {/* Step pipeline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {STEPS.map((s, i) => {
            const isActive = s === step
            const isDone = STEPS.indexOf(s) < STEPS.indexOf(step) || done
            return (
              <React.Fragment key={s}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '3px 10px', borderRadius: '100px', fontSize: '11px',
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'var(--accent-dim)' : isDone ? 'var(--green-dim)' : 'var(--bg-elevated)',
                  border: `1px solid ${isActive ? 'var(--accent)' : isDone ? 'var(--green)' : 'var(--border)'}`,
                  color: isActive ? 'var(--accent-hover)' : isDone ? 'var(--green)' : 'var(--text-muted)',
                  transition: 'all 0.2s'
                }}>
                  {isDone && !done && <Check size={9} />}
                  {done && <Check size={9} />}
                  {isActive && loading && <Loader size={9} className="animate-spin" />}
                  {STEP_LABELS[s]}
                </div>
                {i < STEPS.length - 1 && <ChevronRight size={11} color="var(--text-muted)" />}
              </React.Fragment>
            )
          })}

          {/* Active agent */}
          {activeAgent && step !== 'implement' && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: 'var(--text-muted)' }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: agentColor }} />
              <span style={{ color: agentColor }}>{activeAgent}</span>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Chat area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Messages */}
          <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
            {history.length === 0 && !loading && (
              <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)', fontSize: '13px' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%', background: 'var(--bg-elevated)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px'
                }}>
                  <Icon size={22} color="var(--text-muted)" strokeWidth={1.5} />
                </div>
                <div style={{ fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '8px' }}>
                  {wfConfig.name} is ready
                </div>
                <div style={{ fontSize: '12px', maxWidth: '320px', margin: '0 auto', lineHeight: 1.6 }}>
                  {actualWorkflowId === 'bug-fix'
                    ? 'Tanner investigates the root cause, then James Bond applies the minimal correct fix.'
                    : 'The Orchestrator scopes it, Moneypenny clarifies, then James Bond implements.'}
                </div>
                {config?.projectDir && (
                  <div style={{
                    marginTop: '16px', display: 'flex', alignItems: 'center', gap: '6px',
                    justifyContent: 'center', fontSize: '11px', color: 'var(--text-muted)'
                  }}>
                    <FolderSearch size={12} />
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {config.projectDir.split('/').pop() || config.projectDir}
                    </span>
                  </div>
                )}
              </div>
            )}

            {history.map((msg, i) => (
              <ChatBubble
                key={i}
                message={msg}
                streaming={loading && i === history.length - 1 && msg.role === 'assistant'}
              />
            ))}

            {/* Thinking indicator — only when no stream has started yet */}
            {loading && history[history.length - 1]?.role === 'assistant' && !history[history.length - 1]?.content && step !== 'implement' && (
              <div style={{ display: 'flex', gap: '10px', padding: '4px 0', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '3px', marginLeft: '40px' }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{
                      width: '5px', height: '5px', borderRadius: '50%',
                      background: 'var(--accent-hover)', animation: `pulse 1s ease ${i * 0.2}s infinite`
                    }} />
                  ))}
                </div>
                {loadingMsg && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{loadingMsg}</span>}
              </div>
            )}

            {/* Stopped state */}
            {stopped && (
              <div style={{
                margin: '12px 0', padding: '10px 14px',
                background: 'rgba(255,160,0,0.08)', border: '1px solid rgba(255,160,0,0.3)',
                borderRadius: 'var(--radius)', fontSize: '12px', color: 'var(--orange)'
              }}>
                Execution stopped. You can continue from where you left off or reset to start over.
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          {step !== 'implement' && !done && (
            <form
              onSubmit={handleSend}
              style={{
                padding: '12px 16px', borderTop: '1px solid var(--border)',
                background: 'var(--bg-surface)', display: 'flex', gap: '6px', flexShrink: 0
              }}
            >
              <input
                ref={inputRef}
                className="input-base"
                style={{ flex: 1 }}
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={step === firstStep ? wfConfig.firstPlaceholder : 'Answer or ask a follow-up...'}
                disabled={loading}
              />
              <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
                <Send size={14} />
              </button>
              {step === 'clarify' && prompt && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => handleImplement()}
                  disabled={loading}
                  title="Skip clarification and implement now"
                  style={{ whiteSpace: 'nowrap' }}
                >
                  <Zap size={13} /> Implement now
                </button>
              )}
            </form>
          )}

          {done && (
            <div style={{
              padding: '14px 20px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: '8px',
              color: 'var(--green)', fontSize: '13px', fontWeight: 500, flexShrink: 0
            }}>
              <Check size={15} />
              {wfConfig.successMsg}
              <button className="btn btn-ghost btn-sm" onClick={handleReset} style={{ marginLeft: '8px' }}>
                <RotateCcw size={12} /> Start new
              </button>
            </div>
          )}
        </div>

        {/* Terminal panel — during implement */}
        {(step === 'implement' || logs.length > 0 || streamText) && (
          <div style={{
            width: '400px', borderLeft: '1px solid var(--border)',
            background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', overflow: 'hidden'
          }}>
            {/* Terminal header */}
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid var(--border)',
              background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center',
              gap: '8px', fontSize: '11px', color: 'var(--text-muted)'
            }}>
              {loading ? <Loader size={11} className="animate-spin" /> : <Check size={11} />}
              <span>{loading ? (loadingMsg || 'Running...') : (stopped ? 'Stopped' : 'Complete')}</span>
              {loading && (
                <button
                  className="btn btn-ghost"
                  onClick={handleStop}
                  style={{ marginLeft: 'auto', padding: '2px 8px', height: 'auto', fontSize: '11px', color: 'var(--red)' }}
                >
                  <Square size={10} fill="currentColor" /> Stop
                </button>
              )}
            </div>

            {/* Logs */}
            <div style={{ flex: 1, overflow: 'auto', padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: '12px', lineHeight: 1.7 }}>
              {logs.length === 0 && !streamText && (
                <div style={{ color: 'var(--text-muted)' }}>
                  {loading ? 'Scanning project files...' : 'No output yet'}
                </div>
              )}
              {logs.map((log, i) => {
                const colors = { success: 'var(--green)', error: 'var(--red)', warn: 'var(--orange)', system: 'var(--accent-hover)' }
                const prefixes = { success: '✓ ', error: '✗ ', warn: '⚠ ', system: '▶ ' }
                return (
                  <div key={i} style={{ color: colors[log.type] || 'var(--text-secondary)', wordBreak: 'break-word' }}>
                    <span style={{ color: 'var(--text-muted)', userSelect: 'none' }}>{prefixes[log.type] || '  '}</span>
                    {log.message}
                  </div>
                )
              })}
              {streamText && (
                <div style={{ color: 'var(--text-code)', whiteSpace: 'pre-wrap', marginTop: '8px', borderTop: '1px solid var(--border-bright)', paddingTop: '8px' }}>
                  {streamText}
                  {loading && <span className="cursor-blink" />}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
