import React, { useState, useRef, useEffect } from 'react'
import { Send, ChevronRight, Check, Loader, Play, RotateCcw, ArrowUpDown } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useNavigate } from 'react-router-dom'
import ChatBubble from '../Common/ChatBubble'
import Terminal from '../Common/Terminal'
import Board from '../Kanban/Board'
import { useProject } from '../../hooks/useProject'
import { useSocket } from '../../hooks/useSocket'
import { useStore } from '../../store'

const STEPS = ['requirements', 'spec', 'tasks', 'approval', 'execute']
const STEP_LABELS = {
  requirements: 'Requirements',
  spec: 'Tech Spec',
  tasks: 'Task Planning',
  approval: 'Approval',
  execute: 'Execute'
}

export default function FeatureDev() {
  const [step, setStep] = useState('requirements')
  const [input, setInput] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [requirements, setRequirements] = useState('')
  const [techSpec, setTechSpec] = useState('')
  const [generatedTasks, setGeneratedTasks] = useState([])
  const [executionId, setExecutionId] = useState(null)
  const [logs, setLogs] = useState([])
  const [workflowId] = useState(`feature-dev-${Date.now()}`)

  const { runWorkflowStep, runWorkflow, createBulkTasks, deleteWorkflowTasks } = useProject()
  const { subscribeToExecution } = useSocket()
  const { addNotification, addTasks } = useStore()
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history.length])

  useEffect(() => {
    if (executionId) {
      const unsub = subscribeToExecution(executionId, {
        onLog: (entry) => setLogs(l => [...l, entry]),
        onComplete: () => {
          setLoading(false)
          addNotification({ type: 'success', message: 'feature-dev: All tasks executed!' })
        },
        onError: (msg) => {
          setLoading(false)
          addNotification({ type: 'error', message: `Execution failed: ${msg}` })
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
      if (step === 'requirements') {
        const res = await runWorkflowStep('feature-dev', 'requirements', message, newHistory.slice(0, -1))
        const aiMsg = { role: 'assistant', content: res.reply }
        setHistory(h => [...h, aiMsg])
        setLoading(false)

        if (res.requirementsFinalized) {
          setRequirements(res.requirements)
          addNotification({ type: 'success', message: 'Requirements finalized! Generating tech spec...' })
          await generateSpec(res.requirements, [...newHistory, aiMsg])
        }
      }
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function generateSpec(reqs, currentHistory) {
    setStep('spec')
    setLoading(true)

    try {
      const specMsg = `Generate the technical specification for these requirements:\n\n${reqs}`
      const res = await runWorkflowStep('feature-dev', 'spec', specMsg, currentHistory)
      setTechSpec(res.reply)
      setHistory(h => [...h, { role: 'assistant', content: `## Tech Spec Generated ✓\n\n${res.reply.slice(0, 200)}...\n\n*Full spec saved. Moving to task planning.*` }])
      setLoading(false)

      addNotification({ type: 'info', message: 'Tech spec ready. Generating tasks...' })
      await generateTasks(reqs, res.reply, [...currentHistory, { role: 'assistant', content: res.reply }])
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function generateTasks(reqs, spec, currentHistory) {
    setStep('tasks')
    setLoading(true)

    try {
      const taskMsg = `Based on these requirements and tech spec, generate the Kanban tasks:\n\nRequirements: ${reqs}\n\nTech Spec: ${spec.slice(0, 2000)}`
      const res = await runWorkflowStep('feature-dev', 'tasks', taskMsg, currentHistory)

      const tasks = res.tasks || []
      setGeneratedTasks(tasks)

      setHistory(h => [...h, { role: 'assistant', content: `## ${tasks.length} Tasks Generated ✓\n\n${tasks.map((t, i) => `${i + 1}. **${t.title}** (order: ${t.executionOrder}, ${t.executionType})`).join('\n')}\n\nReview the execution plan below and approve to proceed.` }])
      setStep('approval')
      setLoading(false)
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function handleApprove() {
    setLoading(true)
    try {
      // Create tasks in Kanban
      const tasksToCreate = generatedTasks.map(t => ({
        ...t,
        column: 'todo',
        workflowId,
        techSpec: techSpec.slice(0, 500)
      }))
      const result = await createBulkTasks(tasksToCreate)
      addNotification({ type: 'success', message: `${generatedTasks.length} tasks added to Kanban!` })

      setStep('execute')
      setLoading(false)

      setHistory(h => [...h, { role: 'assistant', content: `## Tasks Approved ✓\n\n${generatedTasks.length} tasks added to the Kanban board. Ready for execution.\n\nYou can:\n- **Execute all** — run tasks in planned order\n- **View Kanban** — manage tasks manually\n- **Edit tasks** — drag and reorder in Kanban before executing` }])
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function handleExecute() {
    setLoading(true)
    setLogs([])
    const { tasks } = useStore.getState()
    const wfTasks = tasks.filter(t => t.workflowId === workflowId)

    try {
      const res = await runWorkflow('feature-dev', {
        tasks: wfTasks,
        approvedPlan: true
      })
      setExecutionId(res.executionId)
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function handleReset() {
    await deleteWorkflowTasks(workflowId)
    setStep('requirements')
    setHistory([])
    setRequirements('')
    setTechSpec('')
    setGeneratedTasks([])
    setLogs([])
    setExecutionId(null)
    setLoading(false)
  }

  const currentStepIdx = STEPS.indexOf(step)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '20px' }}>🚀</span>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>feature-dev</h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Full feature development workflow</p>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleReset} title="Start over">
            <RotateCcw size={13} /> Reset
          </button>
        </div>

        {/* Step pipeline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {STEPS.map((s, i) => {
            const isActive = s === step
            const isDone = i < currentStepIdx
            return (
              <React.Fragment key={s}>
                <div style={{
                  padding: '4px 10px', borderRadius: '100px', fontSize: '11px',
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'var(--accent-dim)' : isDone ? 'var(--green-dim)' : 'var(--bg-elevated)',
                  border: `1px solid ${isActive ? 'var(--accent)' : isDone ? 'var(--green)' : 'var(--border)'}`,
                  color: isActive ? 'var(--accent-hover)' : isDone ? 'var(--green)' : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', gap: '5px', transition: 'all 0.2s'
                }}>
                  {isDone ? <Check size={9} /> : isActive && loading ? <Loader size={9} className="animate-spin" /> : null}
                  {STEP_LABELS[s]}
                </div>
                {i < STEPS.length - 1 && <ChevronRight size={11} color="var(--text-muted)" />}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Main content — split view */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: Chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>
          <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
            {history.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
                <div style={{ fontSize: '32px', marginBottom: '12px' }}>🚀</div>
                <div style={{ fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>feature-dev is ready</div>
                <div>Describe the feature you want to build.</div>
                <div style={{ marginTop: '4px', fontSize: '12px' }}>
                  The AI will ask detailed questions before generating a tech spec and task plan.
                </div>
              </div>
            )}
            {history.map((msg, i) => (
              <ChatBubble key={i} message={msg} streaming={loading && i === history.length - 1 && msg.role === 'assistant'} />
            ))}
            {loading && history[history.length - 1]?.role === 'user' && step === 'requirements' && (
              <div style={{ display: 'flex', gap: '10px', padding: '10px 0' }}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Loader size={14} color="var(--accent-hover)" className="animate-spin" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input (requirements phase) */}
          {step === 'requirements' && (
            <form onSubmit={handleSend} style={{
              padding: '12px 20px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)', display: 'flex', gap: '8px', flexShrink: 0
            }}>
              <input
                ref={inputRef}
                className="input-base"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Describe the feature or answer the AI's question..."
                disabled={loading}
              />
              <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
                <Send size={14} />
              </button>
            </form>
          )}

          {/* Approval actions */}
          {step === 'approval' && !loading && (
            <div style={{
              padding: '12px 20px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)', display: 'flex', gap: '8px', flexShrink: 0
            }}>
              <button className="btn btn-primary" onClick={handleApprove} style={{ flex: 1, justifyContent: 'center' }}>
                <Check size={14} /> Approve {generatedTasks.length} tasks
              </button>
            </div>
          )}

          {/* Execute actions */}
          {step === 'execute' && !executionId && (
            <div style={{
              padding: '12px 20px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)', display: 'flex', gap: '8px', flexShrink: 0
            }}>
              <button className="btn btn-primary" onClick={handleExecute} disabled={loading} style={{ flex: 1, justifyContent: 'center' }}>
                <Play size={14} /> Execute all tasks
              </button>
              <button className="btn btn-ghost" onClick={() => navigate('/kanban')} style={{ flex: 1, justifyContent: 'center' }}>
                View Kanban
              </button>
            </div>
          )}
        </div>

        {/* Right: Execution plan / Kanban / Terminal */}
        <div style={{ width: '460px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Task approval view */}
          {(step === 'approval' || step === 'execute') && !executionId && (
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
                {step === 'approval' ? 'Review Execution Plan' : 'Task Plan (Approved)'}
              </div>
              <ExecutionPlan tasks={generatedTasks} />
            </div>
          )}

          {/* Spec view */}
          {step === 'spec' && (
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
                Tech Spec
              </div>
              {loading ? (
                <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)', fontSize: '12px', alignItems: 'center' }}>
                  <Loader size={14} className="animate-spin" /> Generating spec...
                </div>
              ) : (
                <div className="markdown-body" style={{ fontSize: '12px' }}>
                  <ReactMarkdown>{techSpec}</ReactMarkdown>
                </div>
              )}
            </div>
          )}

          {/* Execution terminal */}
          {executionId && (
            <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
              <Terminal logs={logs} streaming={loading} title="Task execution" maxHeight="calc(100vh - 200px)" />
            </div>
          )}

          {/* Default state */}
          {step === 'requirements' && (
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '32px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center'
            }}>
              <div>
                <ArrowUpDown size={24} style={{ marginBottom: '12px', opacity: 0.3 }} />
                <div>Tech spec and tasks will appear here after requirements are gathered</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ExecutionPlan({ tasks }) {
  if (!tasks.length) return <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No tasks yet</div>

  // Group by execution order
  const groups = tasks.reduce((acc, t) => {
    const order = t.executionOrder ?? 0
    if (!acc[order]) acc[order] = []
    acc[order].push(t)
    return acc
  }, {})

  const PRIORITY_COLORS = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--blue)' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {Object.entries(groups).sort(([a], [b]) => Number(a) - Number(b)).map(([order, groupTasks]) => (
        <div key={order}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '100px', padding: '1px 7px' }}>
              Step {Number(order) + 1}
            </span>
            {groupTasks.length > 1 && <span style={{ color: 'var(--purple)' }}>⚡ parallel ({groupTasks.length})</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '12px', borderLeft: '2px solid var(--border-bright)' }}>
            {groupTasks.map((t, i) => (
              <div key={i} style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '8px 10px',
                fontSize: '12px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: PRIORITY_COLORS[t.priority] || 'var(--text-muted)' }} />
                  <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{t.title}</span>
                </div>
                {t.description && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.4 }}>
                    {t.description.slice(0, 100)}{t.description.length > 100 ? '...' : ''}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  {t.tags?.slice(0, 3).map(tag => (
                    <span key={tag} style={{ fontSize: '9px', color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: '100px' }}>{tag}</span>
                  ))}
                  <span style={{ fontSize: '9px', color: 'var(--accent-hover)', marginLeft: 'auto' }}>{t.assignedTo}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
