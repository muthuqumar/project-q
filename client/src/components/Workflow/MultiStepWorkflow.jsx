/**
 * MultiStepWorkflow — generalized runner for feature-dev, greenfield, brownfield-feature
 *
 * Step flow:
 *   conversation → [auto-generation(s)] → planning → approval → execute
 *
 * The exact steps and labels come from the workflow definition (loaded from server).
 * All prompt logic lives server-side in engine.js — this component just drives the UI.
 */

import React, { useState, useRef, useEffect } from 'react'
import { Send, ChevronRight, Check, Loader, Play, RotateCcw, ArrowUpDown, Users } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useParams, useNavigate } from 'react-router-dom'
import ChatBubble from '../Common/ChatBubble'
import Terminal from '../Common/Terminal'
import { useProject } from '../../hooks/useProject'
import { useSocket } from '../../hooks/useSocket'
import { useStore } from '../../store'

// Step types that auto-run (no user input needed)
const AUTO_STEPS = new Set(['generation', 'planning'])

// Agent avatar colors
const AGENT_COLORS = {
  'Moneypenny':   'var(--green)',
  'Mallory':      'var(--blue)',
  'Quartermaster':'var(--purple)',
  'James Bond':   'var(--accent-hover)',
  'Tanner':       'var(--red)',
  'Felix':        'var(--orange)',
  'You':          'var(--text-muted)',
}

function agentColor(agentName) {
  // Match longest key first to avoid 'James' matching inside 'James Bond'
  const keys = Object.keys(AGENT_COLORS).sort((a, b) => b.length - a.length)
  const key = keys.find(k => agentName?.includes(k))
  return key ? AGENT_COLORS[key] : 'var(--text-muted)'
}

export default function MultiStepWorkflow({ workflowId: propWorkflowId }) {
  const { id: paramId } = useParams()
  const workflowId = propWorkflowId || paramId || 'feature-dev'

  const { workflows } = useStore()
  const navigate = useNavigate()

  // Get workflow definition from store (may not be loaded yet)
  const wfDef = workflows.find(w => w.id === workflowId)
  const steps = wfDef?.steps || getDefaultSteps(workflowId)

  const [currentStep, setCurrentStep] = useState(steps[0]?.id || 'requirements')
  const [input, setInput] = useState('')
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(false)
  const [artifacts, setArtifacts] = useState({})  // stepId → generated content
  const [generatedTasks, setGeneratedTasks] = useState([])
  const [executionId, setExecutionId] = useState(null)
  const [logs, setLogs] = useState([])
  const [sessionId] = useState(`${workflowId}-${Date.now()}`)

  const { runWorkflowStep, runWorkflow, createBulkTasks, deleteWorkflowTasks } = useProject()
  const { subscribeToExecution } = useSocket()
  const { addNotification, addTasks } = useStore()
  const inputRef = useRef(null)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history.length])

  useEffect(() => {
    if (!loading && inputRef.current) inputRef.current.focus()
  }, [loading, currentStep])

  useEffect(() => {
    if (executionId) {
      const unsub = subscribeToExecution(executionId, {
        onLog: (entry) => setLogs(l => [...l, entry]),
        onComplete: () => {
          setLoading(false)
          addNotification({ type: 'success', message: `${workflowId}: All tasks executed!` })
        },
        onError: (msg) => {
          setLoading(false)
          addNotification({ type: 'error', message: `Execution failed: ${msg}` })
        }
      })
      return unsub
    }
  }, [executionId])

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const currentStepDef = steps.find(s => s.id === currentStep)
  const currentStepIdx = steps.findIndex(s => s.id === currentStep)
  const isConversationStep = currentStepDef?.type === 'conversation'
  const isApprovalStep = currentStepDef?.type === 'approval'
  const isExecuteStep = currentStepDef?.type === 'execution'
  const historyForStep = (stepId) => history.filter(m => m._step === stepId || !m._step)

  function addMsg(role, content, stepId) {
    setHistory(h => [...h, { role, content, _step: stepId || currentStep }])
  }

  function advanceTo(stepId) {
    setCurrentStep(stepId)
  }

  // ── Main send handler ──────────────────────────────────────────────────────────

  async function handleSend(e) {
    e?.preventDefault()
    if (!input.trim() || loading) return

    const message = input.trim()
    setInput('')
    setLoading(true)

    addMsg('user', message)

    try {
      const res = await runWorkflowStep(workflowId, currentStep, message, history)
      addMsg('assistant', res.reply)
      setLoading(false)

      // Check if this conversation step is finalized
      if (res.requirementsFinalized || res.done) {
        const finContent = res.requirements || res.content || message
        setArtifacts(a => ({ ...a, [currentStep]: finContent }))
        addNotification({ type: 'success', message: `${currentStepDef?.name} finalized! Continuing...` })
        await runAutoSteps([...history, { role: 'assistant', content: res.reply }], steps, currentStepIdx + 1)
      }
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: err.message })
    }
  }

  // ── Auto-run non-conversation steps ────────────────────────────────────────────

  async function runAutoSteps(currentHistory, allSteps, fromIdx) {
    for (let i = fromIdx; i < allSteps.length; i++) {
      const step = allSteps[i]

      // Stop at approval or conversation steps — user must interact
      if (step.type === 'approval' || step.type === 'execution') {
        advanceTo(step.id)
        return
      }

      if (step.type === 'conversation') {
        advanceTo(step.id)
        return
      }

      // Auto-run generation/planning steps
      advanceTo(step.id)
      setLoading(true)

      try {
        // Build prompt from accumulated artifacts
        const artifactsSummary = Object.entries(artifacts)
          .map(([k, v]) => `${k.toUpperCase()}:\n${v?.slice?.(0, 1500) || ''}`)
          .join('\n\n')

        const autoMsg = buildAutoMessage(step, artifacts, generatedTasks)
        const res = await runWorkflowStep(workflowId, step.id, autoMsg, currentHistory)

        setArtifacts(a => ({ ...a, [step.id]: res.reply }))
        addMsg('assistant', formatAutoStepResult(step, res.reply), step.id)
        currentHistory = [...currentHistory, { role: 'assistant', content: res.reply }]

        // Extract tasks if this is a planning step
        if (step.type === 'planning' && res.tasks?.length) {
          setGeneratedTasks(res.tasks)
          addMsg('assistant', buildTaskSummaryMsg(res.tasks), step.id)
        } else if (step.type === 'planning' && !res.tasks?.length) {
          // Try parsing tasks from response
          const match = res.reply.match(/<tasks>([\s\S]*?)<\/tasks>/)
          if (match) {
            try {
              const parsedTasks = JSON.parse(match[1])
              setGeneratedTasks(parsedTasks)
              addMsg('assistant', buildTaskSummaryMsg(parsedTasks), step.id)
            } catch {}
          }
        }

        setLoading(false)
        addNotification({ type: 'info', message: `${step.name} complete — continuing...` })
      } catch (err) {
        setLoading(false)
        addNotification({ type: 'error', message: `${step.name} failed: ${err.message}` })
        return
      }
    }
  }

  // ── Approval handler ────────────────────────────────────────────────────────────

  async function handleApprove() {
    if (!generatedTasks.length) return
    setLoading(true)
    try {
      const tasksToCreate = generatedTasks.map(t => ({
        ...t,
        column: 'todo',
        workflowId: sessionId,
        techSpec: (artifacts.spec || artifacts.architecture || '').slice(0, 500)
      }))
      await createBulkTasks(tasksToCreate)
      addNotification({ type: 'success', message: `${generatedTasks.length} tasks added to Kanban!` })

      const executeStep = steps.find(s => s.type === 'execution')
      if (executeStep) advanceTo(executeStep.id)
      setLoading(false)

      addMsg('assistant',
        `## Plan Approved ✓\n\n${generatedTasks.length} tasks added to the Kanban board.\n\n` +
        `You can:\n- **Execute all** — run tasks in the planned order\n- **View Kanban** — manage tasks manually`,
        'approval'
      )
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: err.message })
    }
  }

  // ── Execute handler ──────────────────────────────────────────────────────────────

  async function handleExecute() {
    setLoading(true)
    setLogs([])
    const { tasks } = useStore.getState()
    const wfTasks = tasks.filter(t => t.workflowId === sessionId)

    try {
      const res = await runWorkflow(workflowId, { tasks: wfTasks, approvedPlan: true })
      setExecutionId(res.executionId)
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: err.message })
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────────────

  async function handleReset() {
    await deleteWorkflowTasks(sessionId)
    setCurrentStep(steps[0]?.id || 'requirements')
    setHistory([])
    setArtifacts({})
    setGeneratedTasks([])
    setLogs([])
    setExecutionId(null)
    setLoading(false)
  }

  // ── Render ─────────────────────────────────────────────────────────────────────

  const wfIcon = wfDef?.icon || '🚀'
  const wfName = wfDef?.name || workflowId
  const wfDescription = wfDef?.description || ''
  const activeStepAgent = currentStepDef?.agent || ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '20px' }}>{wfIcon}</span>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-mono)' }}>{wfName}</h2>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{wfDescription.slice(0, 80)}</p>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleReset} title="Start over">
            <RotateCcw size={13} /> Reset
          </button>
        </div>

        {/* Step pipeline */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', flexWrap: 'wrap' }}>
          {steps.map((s, i) => {
            const isActive = s.id === currentStep
            const isDone = i < currentStepIdx
            const aColor = agentColor(s.agent)
            return (
              <React.Fragment key={s.id}>
                <div style={{
                  padding: '3px 10px', borderRadius: '100px', fontSize: '11px',
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'var(--accent-dim)' : isDone ? `${aColor}18` : 'var(--bg-elevated)',
                  border: `1px solid ${isActive ? 'var(--accent)' : isDone ? aColor : 'var(--border)'}`,
                  color: isActive ? 'var(--accent-hover)' : isDone ? aColor : 'var(--text-muted)',
                  display: 'flex', alignItems: 'center', gap: '4px', transition: 'all 0.2s',
                  cursor: isDone ? 'default' : 'default',
                }}>
                  {isDone && <Check size={8} />}
                  {isActive && loading && <Loader size={8} className="animate-spin" />}
                  {s.name}
                  {s.agent && !isActive && !isDone && (
                    <span style={{ fontSize: '9px', opacity: 0.6 }}>{s.agent.split(' ')[0]}</span>
                  )}
                </div>
                {i < steps.length - 1 && <ChevronRight size={10} color="var(--text-muted)" />}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* Main content — split view */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: Chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>

          {/* Active agent indicator */}
          {activeStepAgent && (
            <div style={{
              padding: '6px 16px',
              background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)',
              fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px',
              color: 'var(--text-muted)'
            }}>
              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: agentColor(activeStepAgent) }} />
              <Users size={10} />
              Active: <span style={{ color: agentColor(activeStepAgent), fontWeight: 500 }}>{activeStepAgent}</span>
            </div>
          )}

          <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
            {history.length === 0 && (
              <EmptyState workflowId={workflowId} firstStep={steps[0]} />
            )}
            {history.map((msg, i) => (
              <ChatBubble
                key={i}
                message={msg}
                streaming={loading && i === history.length - 1 && msg.role === 'assistant'}
              />
            ))}
            {loading && history[history.length - 1]?.role === 'user' && isConversationStep && (
              <div style={{ display: 'flex', gap: '10px', padding: '10px 0' }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <Loader size={14} color="var(--accent-hover)" className="animate-spin" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input bar — conversation steps */}
          {isConversationStep && (
            <form onSubmit={handleSend} style={{
              padding: '12px 20px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)', display: 'flex', gap: '8px', flexShrink: 0
            }}>
              <input
                ref={inputRef}
                className="input-base"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={getInputPlaceholder(workflowId, currentStep)}
                disabled={loading}
              />
              <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
                <Send size={14} />
              </button>
            </form>
          )}

          {/* Approval bar */}
          {isApprovalStep && !loading && (
            <div style={{
              padding: '12px 20px', borderTop: '1px solid var(--border)',
              background: 'var(--bg-surface)', display: 'flex', gap: '8px', flexShrink: 0
            }}>
              <button className="btn btn-primary" onClick={handleApprove} style={{ flex: 1, justifyContent: 'center' }}>
                <Check size={14} /> Approve {generatedTasks.length} tasks
              </button>
            </div>
          )}

          {/* Execute bar */}
          {isExecuteStep && !executionId && (
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

        {/* Right: Context panel */}
        <div style={{ width: '460px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <RightPanel
            currentStep={currentStep}
            currentStepDef={currentStepDef}
            steps={steps}
            artifacts={artifacts}
            generatedTasks={generatedTasks}
            executionId={executionId}
            logs={logs}
            loading={loading}
          />
        </div>

      </div>
    </div>
  )
}

// ── Right panel (context-sensitive) ───────────────────────────────────────────

function RightPanel({ currentStep, currentStepDef, steps, artifacts, generatedTasks, executionId, logs, loading }) {
  // Terminal during execution
  if (executionId) {
    return (
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        <Terminal logs={logs} streaming={loading} title="Task execution" maxHeight="calc(100vh - 200px)" />
      </div>
    )
  }

  // Task plan during approval / execute
  if (currentStepDef?.type === 'approval' || (currentStepDef?.type === 'execution' && !executionId)) {
    return (
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        <SectionHeader label={currentStepDef?.type === 'approval' ? 'Review Execution Plan' : 'Task Plan (Approved)'} />
        <ExecutionPlan tasks={generatedTasks} />
      </div>
    )
  }

  // Artifacts panel — show most recently generated artifact
  const artifactKeys = steps.filter(s => AUTO_STEPS.has(s.type)).map(s => s.id)
  const latestArtifactKey = [...artifactKeys].reverse().find(k => artifacts[k])

  if (latestArtifactKey && artifacts[latestArtifactKey]) {
    const stepDef = steps.find(s => s.id === latestArtifactKey)
    return (
      <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
        <SectionHeader label={stepDef?.name || latestArtifactKey} />
        {loading && !artifacts[latestArtifactKey] ? (
          <div style={{ display: 'flex', gap: '8px', color: 'var(--text-muted)', fontSize: '12px', alignItems: 'center' }}>
            <Loader size={14} className="animate-spin" /> Generating...
          </div>
        ) : (
          <div className="markdown-body" style={{ fontSize: '12px' }}>
            <ReactMarkdown>{artifacts[latestArtifactKey]}</ReactMarkdown>
          </div>
        )}
      </div>
    )
  }

  // Default empty state
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '32px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center'
    }}>
      <div>
        <ArrowUpDown size={24} style={{ marginBottom: '12px', opacity: 0.3 }} />
        <div>Generated artifacts will appear here</div>
        <div style={{ fontSize: '11px', marginTop: '6px', opacity: 0.7 }}>
          Specs, architecture, tasks, etc.
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────────

function SectionHeader({ label }) {
  return (
    <div style={{
      fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)',
      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px'
    }}>
      {label}
    </div>
  )
}

function EmptyState({ workflowId, firstStep }) {
  const msgs = {
    'feature-dev':        { icon: '🚀', title: 'feature-dev is ready', body: 'Describe the feature you want to build. Moneypenny will ask detailed questions before Quartermaster generates the tech spec and Felix plans the tasks.' },
    'greenfield':         { icon: '🏗️', title: 'Greenfield build ready', body: 'Tell Moneypenny about your new project idea. She\'ll lead discovery before Mallory writes the PRD and Quartermaster designs the architecture.' },
    'brownfield-feature': { icon: '🔧', title: 'Brownfield feature ready', body: 'Describe the feature you\'re adding to your existing codebase. Moneypenny will focus on integration points and backwards compatibility.' },
  }
  const m = msgs[workflowId] || { icon: '🚀', title: `${workflowId} ready`, body: 'Start by describing what you want to build.' }

  return (
    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '13px' }}>
      <div style={{ fontSize: '32px', marginBottom: '12px' }}>{m.icon}</div>
      <div style={{ fontWeight: 500, color: 'var(--text-secondary)', marginBottom: '6px' }}>{m.title}</div>
      <div>{m.body}</div>
      {firstStep?.agent && (
        <div style={{ marginTop: '12px', fontSize: '11px', opacity: 0.6 }}>
          Starting with: {firstStep.agent}
        </div>
      )}
    </div>
  )
}

function ExecutionPlan({ tasks }) {
  if (!tasks.length) return <div style={{ color: 'var(--text-muted)', fontSize: '12px' }}>No tasks generated yet</div>

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
                borderRadius: 'var(--radius)', padding: '8px 10px', fontSize: '12px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: PRIORITY_COLORS[t.priority] || 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{t.title}</span>
                </div>
                {t.description && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.4 }}>
                    {t.description.slice(0, 100)}{t.description.length > 100 ? '…' : ''}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  {t.tags?.slice(0, 3).map(tag => (
                    <span key={tag} style={{ fontSize: '9px', color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: '100px' }}>{tag}</span>
                  ))}
                  {t.estimatedHours && (
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{t.estimatedHours}h</span>
                  )}
                  <span style={{ fontSize: '9px', color: 'var(--accent-hover)' }}>{t.assignedTo}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Utility helpers ─────────────────────────────────────────────────────────────

function buildAutoMessage(step, artifacts, generatedTasks) {
  const prevArtifacts = Object.entries(artifacts)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.toUpperCase()}:\n${v.slice(0, 2000)}`)
    .join('\n\n---\n\n')

  switch (step.id) {
    case 'spec':
    case 'prd':
      return `Generate the ${step.name} document based on the following:\n\n${prevArtifacts}`
    case 'architecture':
      return `Design the architecture based on:\n\n${prevArtifacts}`
    case 'stories':
      return `Create sprint-ready user stories from:\n\n${prevArtifacts}`
    case 'tasks':
      return `Break down into executable Kanban tasks based on:\n\n${prevArtifacts}`
    default:
      return `Generate ${step.name} based on:\n\n${prevArtifacts}`
  }
}

function formatAutoStepResult(step, reply) {
  const short = reply.slice(0, 200)
  return `## ${step.name} Generated ✓\n\n${short}${reply.length > 200 ? '…' : ''}\n\n*Full ${step.name} ready. Continuing to next phase.*`
}

function buildTaskSummaryMsg(tasks) {
  const lines = tasks.map((t, i) => `${i + 1}. **${t.title}** (step ${t.executionOrder}, ${t.executionType})`).join('\n')
  return `## ${tasks.length} Tasks Generated ✓\n\n${lines}\n\nReview the execution plan and approve to proceed.`
}

function getInputPlaceholder(workflowId, step) {
  const placeholders = {
    'feature-dev:requirements':        'Describe the feature or answer Moneypenny\'s question...',
    'greenfield:discovery':            'Tell Moneypenny about your project idea...',
    'brownfield-feature:requirements': 'Describe the feature to add, or answer Moneypenny\'s question...',
  }
  return placeholders[`${workflowId}:${step}`] || 'Type your response...'
}

function getDefaultSteps(workflowId) {
  const defaults = {
    'feature-dev': [
      { id: 'requirements', name: 'Requirements', type: 'conversation', agent: 'Moneypenny (Analyst)' },
      { id: 'spec',         name: 'Tech Spec',    type: 'generation',   agent: 'Quartermaster (Architect)' },
      { id: 'tasks',        name: 'Tasks',        type: 'planning',     agent: 'Felix (Scrum Master)' },
      { id: 'approval',     name: 'Approval',     type: 'approval',     agent: 'You' },
      { id: 'execute',      name: 'Execute',      type: 'execution',    agent: 'James Bond (Developer)' },
    ],
    'greenfield': [
      { id: 'discovery',    name: 'Discovery',    type: 'conversation', agent: 'Moneypenny (Analyst)' },
      { id: 'prd',          name: 'PRD',          type: 'generation',   agent: 'Mallory (PM)' },
      { id: 'architecture', name: 'Architecture', type: 'generation',   agent: 'Quartermaster (Architect)' },
      { id: 'stories',      name: 'Sprint Plan',  type: 'planning',     agent: 'Felix (Scrum Master)' },
      { id: 'tasks',        name: 'Tasks',        type: 'planning',     agent: 'Felix (Scrum Master)' },
      { id: 'approval',     name: 'Approval',     type: 'approval',     agent: 'You' },
      { id: 'execute',      name: 'Build',        type: 'execution',    agent: 'James Bond (Developer)' },
    ],
    'brownfield-feature': [
      { id: 'requirements', name: 'Requirements', type: 'conversation', agent: 'Moneypenny (Analyst)' },
      { id: 'spec',         name: 'Integration Spec', type: 'generation', agent: 'Quartermaster (Architect)' },
      { id: 'tasks',        name: 'Tasks',        type: 'planning',     agent: 'Felix (Scrum Master)' },
      { id: 'approval',     name: 'Approval',     type: 'approval',     agent: 'You' },
      { id: 'execute',      name: 'Execute',      type: 'execution',    agent: 'James Bond (Developer)' },
    ],
  }
  return defaults[workflowId] || defaults['feature-dev']
}
