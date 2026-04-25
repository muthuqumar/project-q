import React, { useState, useRef, useEffect } from 'react'
import { Send, Zap, ChevronRight, Check } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import ChatBubble from '../Common/ChatBubble'
import Terminal from '../Common/Terminal'
import { useProject } from '../../hooks/useProject'
import { useSocket } from '../../hooks/useSocket'
import { useStore } from '../../store'

const WORKFLOW_CONFIG = {
  'dev-now': {
    icon: '⚡', name: 'dev-now', subtitle: 'Quick implementation workflow',
    steps: ['understand', 'clarify', 'implement'],
    labels: { understand: 'Understand', clarify: 'Clarify', implement: 'Implement' },
    firstPlaceholder: 'Describe what you want to build...',
    successMsg: 'dev-now: Implementation complete!',
  },
  'bug-fix': {
    icon: '🐛', name: 'bug-fix', subtitle: 'Investigation-first bug resolution',
    steps: ['investigate', 'clarify', 'implement'],
    labels: { investigate: 'Investigate', clarify: 'Clarify', implement: 'Fix' },
    firstPlaceholder: 'Describe the bug — what happens vs. what should happen...',
    successMsg: 'bug-fix: Fix applied!',
  },
}

export default function DevNow({ workflowId: propWorkflowId }) {
  const { id: paramId } = { id: propWorkflowId }  // accept prop; no useParams needed here
  const wfConfig = WORKFLOW_CONFIG[propWorkflowId] || WORKFLOW_CONFIG['dev-now']
  const STEPS = wfConfig.steps
  const STEP_LABELS = wfConfig.labels
  const actualWorkflowId = propWorkflowId || 'dev-now'
  const firstStep = STEPS[0]
  const [step, setStep] = useState(firstStep)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [executionId, setExecutionId] = useState(null)
  const [logs, setLogs] = useState([])
  const [streamText, setStreamText] = useState('')
  const [clarifications, setClarifications] = useState([])
  const [prompt, setPrompt] = useState('')
  const [done, setDone] = useState(false)

  const { runWorkflowStep, runWorkflow } = useProject()
  const { subscribeToExecution } = useSocket()
  const { addNotification } = useStore()
  const inputRef = useRef(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history.length])

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

    const userMsg = { role: 'user', content: message }
    const newHistory = [...history, userMsg]
    setHistory(newHistory)

    try {
      if (step === firstStep) {
        setPrompt(message)
        const res = await runWorkflowStep(actualWorkflowId, step, message, newHistory.slice(0, -1))
        const aiMsg = { role: 'assistant', content: res.reply }
        setHistory(h => [...h, aiMsg])
        setStep('clarify')
        setLoading(false)

      } else if (step === 'clarify') {
        setClarifications(c => [...c, message])
        const res = await runWorkflowStep(actualWorkflowId, 'clarify', message, newHistory)
        const aiMsg = { role: 'assistant', content: res.reply }
        setHistory(h => [...h, aiMsg])
        setLoading(false)

        if (res.readyToImplement || res.rootCauseFound) {
          setTimeout(() => handleImplement(), 500)
        }

      }
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function handleImplement() {
    setStep('implement')
    setLoading(true)
    setStreamText('')
    setLogs([])

    try {
      const res = await runWorkflow(actualWorkflowId, { prompt, clarifications })
      setExecutionId(res.executionId)
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function handleSkipToImplement() {
    if (!prompt) return
    await handleImplement()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <span style={{ fontSize: '20px' }}>{wfConfig.icon}</span>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{wfConfig.name}</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{wfConfig.subtitle}</p>
          </div>
        </div>
        {/* Step indicators */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {STEPS.map((s, i) => {
            const isActive = s === step
            const isDone = STEPS.indexOf(s) < STEPS.indexOf(step) || done
            return (
              <React.Fragment key={s}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  padding: '4px 10px', borderRadius: '100px',
                  background: isActive ? 'var(--accent-dim)' : isDone ? 'var(--green-dim)' : 'var(--bg-elevated)',
                  border: `1px solid ${isActive ? 'var(--accent)' : isDone ? 'var(--green)' : 'var(--border)'}`,
                  fontSize: '11px', fontWeight: isActive ? 600 : 400,
                  color: isActive ? 'var(--accent-hover)' : isDone ? 'var(--green)' : 'var(--text-muted)',
                  transition: 'all 0.2s'
                }}>
                  {isDone && <Check size={10} />}
                  {STEP_LABELS[s]}
                </div>
                {i < STEPS.length - 1 && <ChevronRight size={12} color="var(--text-muted)" />}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Chat area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Messages */}
          <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
            {history.length === 0 && (
              <div style={{
                textAlign: 'center', padding: '40px 20px',
                color: 'var(--text-muted)', fontSize: '13px'
              }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>⚡</div>
                <div style={{ fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>{wfConfig.name} is ready</div>
                <div>{wfConfig.firstPlaceholder}</div>
                <div style={{ marginTop: '4px', fontSize: '12px' }}>
                  {actualWorkflowId === 'bug-fix'
                    ? 'Tanner will investigate the root cause, then James Bond applies the minimal correct fix.'
                    : 'The Orchestrator will estimate scope, Moneypenny will clarify, then James Bond will implement.'}
                </div>
              </div>
            )}
            {history.map((msg, i) => (
              <ChatBubble key={i} message={msg} streaming={loading && i === history.length - 1 && msg.role === 'assistant'} />
            ))}
            {loading && history[history.length - 1]?.role === 'user' && (
              <div style={{ display: 'flex', gap: '10px', padding: '10px 0' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', gap: '3px' }}>
                    {[0,1,2].map(i => (
                      <div key={i} style={{ width: '4px', height: '4px', borderRadius: '50%', background: 'var(--accent-hover)', animation: `pulse 1s ease ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          {step !== 'implement' && !done && (
            <form
              onSubmit={handleSend}
              style={{
                padding: '12px 20px', borderTop: '1px solid var(--border)',
                background: 'var(--bg-surface)', display: 'flex', gap: '8px', flexShrink: 0
              }}
            >
              <input
                ref={inputRef}
                className="input-base"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={step === firstStep ? wfConfig.firstPlaceholder : 'Answer or ask a question...'}
                disabled={loading}
              />
              <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
                <Send size={14} />
              </button>
              {step === 'clarify' && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={handleSkipToImplement}
                  disabled={loading}
                  title="Skip clarification and implement now"
                >
                  <Zap size={14} /> Implement
                </button>
              )}
            </form>
          )}

          {done && (
            <div style={{
              padding: '16px 20px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)', textAlign: 'center',
              color: 'var(--green)', fontSize: '14px', fontWeight: 500, flexShrink: 0
            }}>
              <Check size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
              Implementation complete
            </div>
          )}
        </div>

        {/* Terminal panel (only during implement) */}
        {(step === 'implement' || logs.length > 0) && (
          <div style={{
            width: '380px', borderLeft: '1px solid var(--border)',
            padding: '16px', background: 'var(--bg-surface)', overflow: 'auto'
          }}>
            <Terminal
              logs={[
                ...logs,
                ...(streamText ? [{ type: 'stream', message: streamText }] : [])
              ]}
              streaming={loading}
              title="Implementation log"
            />
          </div>
        )}
      </div>
    </div>
  )
}
