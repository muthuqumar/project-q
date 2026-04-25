import React, { useState } from 'react'
import { Send, Play, ChevronRight, Check, Loader } from 'lucide-react'
import ChatBubble from '../Common/ChatBubble'
import Terminal from '../Common/Terminal'
import { useProject } from '../../hooks/useProject'
import { useSocket } from '../../hooks/useSocket'
import { useStore } from '../../store'

export default function CustomWorkflowRunner({ workflow }) {
  const [currentStep, setCurrentStep] = useState(0)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [executionId, setExecutionId] = useState(null)
  const [logs, setLogs] = useState([])
  const [initialInput, setInitialInput] = useState('')
  const [started, setStarted] = useState(false)

  const { runWorkflowStep, runWorkflow } = useProject()
  const { subscribeToExecution } = useSocket()
  const { addNotification } = useStore()

  async function handleStart(e) {
    e?.preventDefault()
    if (!input.trim()) return
    setInitialInput(input)
    setInput('')
    setStarted(true)
    await runCurrentStep(input, [])
  }

  async function runCurrentStep(message, hist) {
    setLoading(true)
    const step = workflow.steps[currentStep]
    const userMsg = { role: 'user', content: message }
    const newHistory = [...hist, userMsg]
    setHistory(newHistory)

    try {
      const res = await runWorkflowStep(workflow.id, step.id, message, newHistory.slice(0, -1))
      const aiMsg = { role: 'assistant', content: res.reply || `Step "${step.name}" complete.` }
      setHistory(h => [...h, aiMsg])
      setLoading(false)

      if (step.type === 'execution') {
        // Auto-run via engine
        const execRes = await runWorkflow(workflow.id, { prompt: initialInput || message })
        setExecutionId(execRes.executionId)
        const unsub = subscribeToExecution(execRes.executionId, {
          onLog: (entry) => setLogs(l => [...l, entry]),
          onComplete: () => { setLoading(false); addNotification({ type: 'success', message: `${workflow.name}: complete!` }) },
          onError: (msg) => { setLoading(false); addNotification({ type: 'error', message: msg }) }
        })
      }
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function handleSend(e) {
    e?.preventDefault()
    if (!input.trim() || loading) return
    const message = input.trim()
    setInput('')
    await runCurrentStep(message, history)
  }

  async function handleNextStep() {
    if (currentStep < workflow.steps.length - 1) {
      setCurrentStep(s => s + 1)
    }
  }

  const step = workflow.steps[currentStep]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
          <span style={{ fontSize: '20px' }}>{workflow.icon || '⚡'}</span>
          <div>
            <h2 style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{workflow.name}</h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{workflow.description}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {workflow.steps.map((s, i) => (
            <React.Fragment key={s.id}>
              <div style={{
                padding: '3px 9px', borderRadius: '100px', fontSize: '10px',
                background: i === currentStep ? 'var(--accent-dim)' : i < currentStep ? 'var(--green-dim)' : 'var(--bg-elevated)',
                border: `1px solid ${i === currentStep ? 'var(--accent)' : i < currentStep ? 'var(--green)' : 'var(--border)'}`,
                color: i === currentStep ? 'var(--accent-hover)' : i < currentStep ? 'var(--green)' : 'var(--text-muted)',
                display: 'flex', alignItems: 'center', gap: '4px'
              }}>
                {i < currentStep && <Check size={8} />}
                {s.name}
              </div>
              {i < workflow.steps.length - 1 && <ChevronRight size={10} color="var(--text-muted)" />}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
            {!started ? (
              <div style={{ textAlign: 'center', padding: '48px 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>{workflow.icon || '⚡'}</div>
                <div style={{ fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>{workflow.name}</div>
                <div>{workflow.description || 'Start by providing your initial input below.'}</div>
              </div>
            ) : (
              history.map((msg, i) => <ChatBubble key={i} message={msg} />)
            )}
          </div>

          <form onSubmit={started ? handleSend : handleStart} style={{
            padding: '12px 20px', borderTop: '1px solid var(--border)',
            background: 'var(--bg-surface)', display: 'flex', gap: '8px', flexShrink: 0
          }}>
            <input
              className="input-base"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={started ? `Continue the conversation...` : `Start "${workflow.name}"...`}
              disabled={loading}
            />
            <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
              {loading ? <Loader size={14} className="animate-spin" /> : started ? <Send size={14} /> : <Play size={14} />}
            </button>
            {started && currentStep < workflow.steps.length - 1 && (
              <button type="button" className="btn btn-ghost" onClick={handleNextStep} disabled={loading}>
                Next <ChevronRight size={13} />
              </button>
            )}
          </form>
        </div>

        {/* Terminal */}
        {(executionId || logs.length > 0) && (
          <div style={{ width: '360px', borderLeft: '1px solid var(--border)', padding: '16px' }}>
            <Terminal logs={logs} streaming={loading} />
          </div>
        )}
      </div>
    </div>
  )
}
