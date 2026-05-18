/**
 * MultiStepWorkflow — Mission Control UI
 *
 * Design principles:
 *   1. Phase header is the dominant element — always know who's active and where you are
 *   2. Agent hand-offs get explicit ceremony in the chat
 *   3. Approval is a full-attention gate, not a footer button
 *   4. Artifacts accumulate in a persistent right-panel stack
 *   5. Execution shows a task checklist, not just log lines
 */

import React, { useState, useRef, useEffect } from 'react'
import { Send, Check, Loader, Play, RotateCcw, Square, ChevronDown, ChevronRight, ArrowRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useParams, useNavigate } from 'react-router-dom'
import ChatBubble from '../Common/ChatBubble'
import { useProject } from '../../hooks/useProject'
import { useSocket } from '../../hooks/useSocket'
import { useStore } from '../../store'

// ── Agent identity ────────────────────────────────────────────────────────────

const AGENTS = {
  'Moneypenny':    { color: '#22c55e', bg: '#16a34a22', initials: 'MP', title: 'Analyst' },
  'Mallory':       { color: '#3b82f6', bg: '#2563eb22', initials: 'MA', title: 'Product Manager' },
  'Quartermaster': { color: '#a855f7', bg: '#9333ea22', initials: 'QM', title: 'Architect' },
  'James Bond':    { color: '#f59e0b', bg: '#d9770622', initials: 'JB', title: 'Senior Developer' },
  'Tanner':        { color: '#ef4444', bg: '#dc262622', initials: 'TA', title: 'QA Engineer' },
  'Felix':         { color: '#f97316', bg: '#ea580c22', initials: 'FX', title: 'Scrum Master' },
  'You':           { color: 'var(--text-muted)', bg: 'var(--bg-elevated)', initials: 'YO', title: '' },
}

function resolveAgent(agentStr) {
  if (!agentStr) return null
  const key = Object.keys(AGENTS).find(k => agentStr.includes(k))
  return key ? { name: key, ...AGENTS[key] } : null
}

// ── Step type constants ────────────────────────────────────────────────────────

const AUTO_STEPS = new Set(['generation', 'planning'])

function getDefaultSteps(workflowId) {
  const defaults = {
    'feature-dev': [
      { id: 'requirements', name: 'Requirements',  type: 'conversation', agent: 'Moneypenny (Analyst)' },
      { id: 'spec',         name: 'Tech Spec',     type: 'generation',   agent: 'Quartermaster (Architect)' },
      { id: 'tasks',        name: 'Task Planning', type: 'planning',     agent: 'Felix (Scrum Master)' },
      { id: 'approval',     name: 'Approval',      type: 'approval',     agent: 'You' },
      { id: 'execute',      name: 'Execute',       type: 'execution',    agent: 'James Bond (Developer)' },
    ],
    'greenfield': [
      { id: 'discovery',    name: 'Discovery',     type: 'conversation', agent: 'Moneypenny (Analyst)' },
      { id: 'prd',          name: 'PRD',           type: 'generation',   agent: 'Mallory (PM)' },
      { id: 'architecture', name: 'Architecture',  type: 'generation',   agent: 'Quartermaster (Architect)' },
      { id: 'stories',      name: 'Sprint Plan',   type: 'planning',     agent: 'Felix (Scrum Master)' },
      { id: 'tasks',        name: 'Tasks',         type: 'planning',     agent: 'Felix (Scrum Master)' },
      { id: 'approval',     name: 'Approval',      type: 'approval',     agent: 'You' },
      { id: 'execute',      name: 'Build',         type: 'execution',    agent: 'James Bond (Developer)' },
    ],
    'brownfield-feature': [
      { id: 'requirements', name: 'Requirements',    type: 'conversation', agent: 'Moneypenny (Analyst)' },
      { id: 'spec',         name: 'Integration Spec',type: 'generation',   agent: 'Quartermaster (Architect)' },
      { id: 'tasks',        name: 'Tasks',           type: 'planning',     agent: 'Felix (Scrum Master)' },
      { id: 'approval',     name: 'Approval',        type: 'approval',     agent: 'You' },
      { id: 'execute',      name: 'Execute',         type: 'execution',    agent: 'James Bond (Developer)' },
    ],
    'bug-fix': [
      { id: 'investigate', name: 'Investigate', type: 'conversation', agent: 'Tanner (QA Engineer)' },
      { id: 'tasks',       name: 'Fix Plan',    type: 'planning',     agent: 'James Bond (Developer)' },
      { id: 'approval',    name: 'Approval',    type: 'approval',     agent: 'You' },
      { id: 'execute',     name: 'Fix',         type: 'execution',    agent: 'James Bond (Developer)' },
    ],
  }
  return defaults[workflowId] || defaults['feature-dev']
}

// ── Session persistence helpers ───────────────────────────────────────────────

function loadSession(workflowId) {
  try {
    const raw = localStorage.getItem(`pq_session_${workflowId}`)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveSession(workflowId, data) {
  try {
    localStorage.setItem(`pq_session_${workflowId}`, JSON.stringify({ ...data, savedAt: new Date().toISOString() }))
  } catch {}
}

function clearSession(workflowId) {
  try { localStorage.removeItem(`pq_session_${workflowId}`) } catch {}
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MultiStepWorkflow({ workflowId: propWorkflowId }) {
  const { id: paramId } = useParams()
  const workflowId = propWorkflowId || paramId || 'feature-dev'
  const { workflows, tasks: storeTasks, config } = useStore()
  const navigate = useNavigate()

  const wfDef = workflows.find(w => w.id === workflowId)
  const steps = wfDef?.steps || getDefaultSteps(workflowId)

  // ── Persistent state — restored from localStorage on mount ─────────────────
  const [sessionId] = useState(() => {
    const saved = loadSession(workflowId)
    return saved?.sessionId || `${workflowId}-${Date.now()}`
  })
  const [currentStep, setCurrentStep] = useState(() => {
    const saved = loadSession(workflowId)
    return saved?.currentStep || steps[0]?.id || 'requirements'
  })
  const [history, setHistory] = useState(() => {
    const saved = loadSession(workflowId)
    return saved?.history || []
  })
  const [artifacts, setArtifacts] = useState(() => {
    const saved = loadSession(workflowId)
    return saved?.artifacts || {}
  })
  const [generatedTasks, setGeneratedTasks] = useState(() => {
    const saved = loadSession(workflowId)
    return saved?.generatedTasks || []
  })
  const [expandedArtifacts, setExpandedArtifacts] = useState(() => {
    const saved = loadSession(workflowId)
    return new Set(saved?.expandedArtifacts || [])
  })

  // ── Session restored banner ─────────────────────────────────────────────────
  const [sessionRestored] = useState(() => {
    const saved = loadSession(workflowId)
    return !!(saved?.history?.length || (saved?.artifacts && Object.keys(saved.artifacts).length > 0))
  })
  const [showRestoredBanner, setShowRestoredBanner] = useState(sessionRestored)

  // ── Transient state (not persisted) ────────────────────────────────────────
  const [input, setInput]                     = useState('')
  const [loading, setLoading]                 = useState(false)
  const [loadingMsg, setLoadingMsg]           = useState('')
  const [executionId, setExecutionId]         = useState(null)
  const [logs, setLogs]                       = useState([])
  const [stopped, setStopped]                 = useState(false)
  const [activeTaskId, setActiveTaskId]       = useState(null)
  // stepReady: the AI has signalled it's done with the current conversation step
  // (rootCauseFound / requirementsFinalized / done). The user still decides when
  // to actually advance — the cascade only fires on explicit Proceed click.
  const [stepReady, setStepReady]             = useState(false)

  // ── Persist session on state changes ───────────────────────────────────────
  useEffect(() => {
    // Don't persist an empty session — only save once something has happened
    if (history.length === 0 && Object.keys(artifacts).length === 0 && generatedTasks.length === 0) return
    saveSession(workflowId, {
      sessionId,
      currentStep,
      history: history.filter(m => !m._streaming).slice(-80),
      artifacts,
      generatedTasks,
      expandedArtifacts: [...expandedArtifacts],
    })
  }, [sessionId, currentStep, history, artifacts, generatedTasks, expandedArtifacts])

  const { runWorkflowStep, runWorkflow, stopExecution, createBulkTasks, deleteWorkflowTasks } = useProject()
  const { subscribeToExecution, subscribeToStepStream } = useSocket()
  const { addNotification } = useStore()
  const inputRef      = useRef(null)
  const messagesEndRef = useRef(null)
  const streamUnsubRef = useRef(null)

  // Derived
  const currentStepDef  = steps.find(s => s.id === currentStep)
  const currentStepIdx  = steps.findIndex(s => s.id === currentStep)
  const isConversation  = currentStepDef?.type === 'conversation'
  const isApproval      = currentStepDef?.type === 'approval'
  const isExecution     = currentStepDef?.type === 'execution'
  const isAutoStep      = AUTO_STEPS.has(currentStepDef?.type)
  const activeAgent     = resolveAgent(currentStepDef?.agent)

  // Tasks for this session (live from store)
  const sessionTasks = storeTasks.filter(t => t.workflowId === sessionId)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [history.length])

  useEffect(() => {
    if (!loading && inputRef.current && isConversation) inputRef.current.focus()
  }, [loading, currentStep])

  // Auto-expand the latest artifact
  useEffect(() => {
    const artifactSteps = steps.filter(s => AUTO_STEPS.has(s.type)).map(s => s.id)
    const latest = [...artifactSteps].reverse().find(id => artifacts[id])
    if (latest) setExpandedArtifacts(new Set([latest]))
  }, [artifacts])

  // Execution subscription
  useEffect(() => {
    if (!executionId) return
    const unsub = subscribeToExecution(executionId, {
      onLog:        (entry)  => setLogs(l => [...l, entry]),
      onTaskStream: ({ taskId }) => setActiveTaskId(taskId),
      onStep:       (data)   => {
        if (data.status === 'done') setActiveTaskId(null)
      },
      onComplete:   ()       => {
        setLoading(false)
        setLoadingMsg('')
        setActiveTaskId(null)
        addNotification({ type: 'success', message: `${workflowId}: all tasks complete!` })
      },
      onStopped:    ()       => { setLoading(false); setLoadingMsg(''); setStopped(true) },
      onError:      (msg)    => { setLoading(false); setLoadingMsg(''); addNotification({ type: 'error', message: `Execution failed: ${msg}` }) },
    })
    return unsub
  }, [executionId])

  // ── Helpers ───────────────────────────────────────────────────────────────

  function addMsg(role, content, meta = {}) {
    setHistory(h => [...h, { role, content, _step: meta.step || currentStep, ...meta }])
  }

  function advanceTo(stepId, fromStepId) {
    setCurrentStep(stepId)
    setStepReady(false)
    if (fromStepId && fromStepId !== stepId) {
      const fromDef = steps.find(s => s.id === fromStepId)
      const toDef   = steps.find(s => s.id === stepId)
      setHistory(h => [...h, {
        role: 'system',
        _type: 'phase_transition',
        _from: fromDef,
        _to:   toDef,
        _step: stepId,
      }])
    }
  }

  // ── Send handler ──────────────────────────────────────────────────────────

  async function handleSend(e) {
    e?.preventDefault()
    if (!input.trim() || loading) return

    const message = input.trim()
    setInput('')
    setLoading(true)
    setLoadingMsg(`${activeAgent?.name?.split(' ')[0] || 'Agent'} is thinking…`)

    addMsg('user', message)
    setHistory(h => [...h, { role: 'assistant', content: '', _streaming: true, _step: currentStep }])

    const streamId = `${workflowId}-${currentStep}-${Date.now()}`
    const unsub = subscribeToStepStream(streamId, {
      onChunk: (chunk) => {
        setHistory(h => h.map((m, i) =>
          i === h.length - 1 && m._streaming ? { ...m, content: m.content + chunk } : m
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
    streamUnsubRef.current = unsub

    try {
      const res = await runWorkflowStep(workflowId, currentStep, message, history, streamId)
      unsub()
      streamUnsubRef.current = null

      setHistory(h => h.map((m, i) =>
        i === h.length - 1 && m._streaming
          ? { role: 'assistant', content: res.reply, _step: currentStep }
          : m
      ))
      setLoading(false)
      setLoadingMsg('')

      if (res.requirementsFinalized || res.done || res.rootCauseFound) {
        const content = res.requirements || res.rootCause || res.content || message
        setArtifacts(a => ({ ...a, [currentStep]: content }))
        // Signal ready — but don't auto-cascade. The user must click Proceed.
        // This prevents jumping forward on a preliminary or wrong analysis.
        setStepReady(true)
      } else if (AUTO_STEPS.has(currentStepDef?.type)) {
        // Generation step: the user answered a question from the AI.
        // Update the artifact with the refined output and keep stepReady=true
        // so the Proceed button stays visible.
        setArtifacts(a => ({ ...a, [currentStep]: res.reply }))
        setStepReady(true)
      }
    } catch (err) {
      unsub()
      streamUnsubRef.current = null
      setHistory(h => h.filter(m => !m._streaming))
      setLoading(false)
      setLoadingMsg('')
      addNotification({ type: 'error', message: err.message })
    }
  }

  // ── Auto-step cascade ─────────────────────────────────────────────────────

  async function runAutoSteps(currentHistory, allSteps, fromIdx, prevStepId, artifactsOverride = null) {
    // Use the override when provided (avoids React state lag when called from handleProceed).
    const effectiveArtifacts = artifactsOverride || artifacts
    for (let i = fromIdx; i < allSteps.length; i++) {
      const step     = allSteps[i]
      const prevStep = allSteps[i - 1]

      if (step.type === 'approval' || step.type === 'execution' || step.type === 'conversation') {
        advanceTo(step.id, prevStep?.id || prevStepId)
        setLoading(false)
        setLoadingMsg('')
        return
      }

      advanceTo(step.id, prevStep?.id || prevStepId)
      setLoading(true)
      setLoadingMsg(`${resolveAgent(step.agent)?.name?.split(' ')[0] || 'Agent'} is generating ${step.name}…`)

      setHistory(h => [...h, { role: 'assistant', content: '', _streaming: true, _step: step.id }])
      const autoStreamId = `${workflowId}-${step.id}-auto-${Date.now()}`
      const autoUnsub = subscribeToStepStream(autoStreamId, {
        onChunk: (chunk) => {
          setHistory(h => h.map((m, idx) =>
            idx === h.length - 1 && m._streaming ? { ...m, content: m.content + chunk } : m
          ))
          setLoadingMsg('')
        }
      })

      try {
        const autoMsg = buildAutoMessage(step, effectiveArtifacts, generatedTasks, workflowId)
        const res = await runWorkflowStep(workflowId, step.id, autoMsg, currentHistory, autoStreamId)
        autoUnsub()

        setArtifacts(a => ({ ...a, [step.id]: res.reply }))
        setHistory(h => h.map((m, idx) =>
          idx === h.length - 1 && m._streaming
            ? { role: 'assistant', content: formatAutoResult(step, res.reply), _step: step.id }
            : m
        ))
        currentHistory = [...currentHistory, { role: 'assistant', content: res.reply }]

        if (step.type === 'planning') {
          const tasks = res.tasks?.length ? res.tasks : parseTasks(res.reply)
          if (tasks.length) {
            setGeneratedTasks(tasks)
            addMsg('assistant', buildTaskSummary(tasks), { step: step.id })
          } else {
            // Surface a clear error so the user isn't silently stuck on "Waiting for fix plan..."
            addMsg('assistant',
              `⚠️ **No tasks generated for this step.**\n\nThe AI responded but didn't produce a task list in the expected format. This can happen when:\n- The model exceeded its context length\n- The AI produced explanation but no structured output\n\nClick **Proceed** again to retry, or go back and refine the investigation.`,
              { step: step.id }
            )
            addNotification({ type: 'error', message: `${step.name}: no tasks generated — see chat for details.` })
          }
        }

        setLoading(false)
        setLoadingMsg('')

        // ── Review gate ───────────────────────────────────────────────────────
        // Pause the cascade after every generation step (spec, PRD, architecture).
        // Without this, an incomplete or wrong spec immediately kicks off task
        // planning — the user has no chance to review. setStepReady(true) causes
        // the ActionBar to show a Proceed button; handleProceed then continues
        // the cascade from the next step.
        if (step.type === 'generation') {
          setStepReady(true)
          return
        }
      } catch (err) {
        autoUnsub()
        setHistory(h => h.filter(m => !m._streaming))
        setLoading(false)
        setLoadingMsg('')
        addNotification({ type: 'error', message: `${step.name} failed: ${err.message}` })
        return
      }
    }
  }

  // ── Approve ───────────────────────────────────────────────────────────────

  async function handleApprove() {
    if (!generatedTasks.length) {
      addNotification({ type: 'error', message: 'No tasks to approve — the fix plan may still be generating. Please wait a moment.' })
      return
    }
    setLoading(true)
    try {
      const result = await createBulkTasks(generatedTasks.map(t => ({
        ...t, column: 'todo', workflowId: sessionId,
        techSpec: (artifacts.spec || artifacts.architecture || '').slice(0, 500)
      })))

      // Immediately update the local store — don't rely on the socket event arriving
      // in time before the user clicks "Execute all tasks".
      if (result?.tasks?.length) {
        useStore.getState().addTasks(result.tasks)
      }

      const execStep = steps.find(s => s.type === 'execution')
      if (execStep) advanceTo(execStep.id, currentStep)
      setLoading(false)
      addMsg('assistant',
        `## Plan Approved ✓\n\n${generatedTasks.length} task${generatedTasks.length !== 1 ? 's' : ''} committed to Kanban. James Bond is standing by.\n\nClick **Execute all tasks** when you're ready — or visit the Kanban board to reorder before running.`,
        { step: 'approval' }
      )
    } catch (err) {
      setLoading(false)
      addNotification({ type: 'error', message: `Failed to create tasks: ${err.message}` })
    }
  }

  // ── Execute ───────────────────────────────────────────────────────────────

  async function handleExecute() {
    setLoading(true)
    setLoadingMsg('James Bond is on the mission…')
    setLogs([])
    setStopped(false)

    // Read tasks from local store first
    let wfTasks = useStore.getState().tasks.filter(t => t.workflowId === sessionId)

    // Fallback: fetch from API if store is empty (handles timing/socket issues)
    if (wfTasks.length === 0) {
      try {
        const res = await fetch(`/api/tasks?workflowId=${encodeURIComponent(sessionId)}`)
        const data = await res.json()
        wfTasks = data.tasks || []
        if (wfTasks.length) useStore.getState().addTasks(wfTasks)
      } catch { /* non-critical */ }
    }

    if (wfTasks.length === 0) {
      setLoading(false)
      setLoadingMsg('')
      addNotification({ type: 'error', message: 'No tasks found for this session. Please go back and approve the plan first.' })
      return
    }

    try {
      const res = await runWorkflow(workflowId, { tasks: wfTasks, approvedPlan: true })
      setExecutionId(res.executionId)
    } catch (err) {
      setLoading(false)
      setLoadingMsg('')
      addNotification({ type: 'error', message: err.message })
    }
  }

  async function handleStop() {
    if (executionId) await stopExecution(executionId)
    setLoading(false)
    setStopped(true)
    setLoadingMsg('')
  }

  // ── Manual advance from a conversation step ───────────────────────────────
  // Primary trigger for moving past any conversation step. The AI signals readiness
  // via rootCauseFound / requirementsFinalized (which sets stepReady), but the cascade
  // only fires here — never automatically. This lets the user keep refining before
  // committing to the fix plan.
  async function handleProceed() {
    setStepReady(false)
    const lastAssistant = [...history].reverse().find(m => m.role === 'assistant' && !m._streaming)
    const content = artifacts[currentStep] || lastAssistant?.content || 'Analysis complete.'
    // Build updatedArtifacts synchronously and pass it to runAutoSteps — don't rely on
    // setArtifacts flushing before the auto-step cascade reads from the artifacts closure.
    const updatedArtifacts = { ...artifacts, [currentStep]: content }
    setArtifacts(updatedArtifacts)
    await runAutoSteps(history, steps, currentStepIdx + 1, currentStep, updatedArtifacts)
  }

  async function handleReset() {
    clearSession(workflowId)
    await deleteWorkflowTasks(sessionId)
    // Force a new sessionId by reloading — this also clears all React state cleanly
    window.location.reload()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)' }}>

      {/* Session restored banner */}
      {showRestoredBanner && (
        <div style={{
          background: 'var(--accent-dim)',
          borderBottom: '1px solid var(--accent)',
          padding: '7px 16px',
          display: 'flex', alignItems: 'center', gap: '10px',
          fontSize: '12px', color: 'var(--accent-hover)',
          flexShrink: 0,
        }}>
          <span style={{ flex: 1 }}>
            ↺ &nbsp;Session restored — your previous work is still here.
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowRestoredBanner(false)}
            style={{ fontSize: '11px', color: 'var(--text-muted)' }}
          >
            Dismiss
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleReset}
            style={{ fontSize: '11px', color: 'var(--red)' }}
          >
            Start fresh
          </button>
        </div>
      )}

      {/* Phase Header */}
      <PhaseHeader
        stepDef={currentStepDef}
        stepIdx={currentStepIdx}
        totalSteps={steps.length}
        steps={steps}
        loading={loading}
        loadingMsg={loadingMsg}
        onStop={handleStop}
        onReset={handleReset}
        workflowName={wfDef?.name || workflowId}
      />

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* Left: Chat */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>

          <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
            {history.length === 0 && <EmptyState workflowId={workflowId} steps={steps} />}

            {history.map((msg, i) => {
              if (msg._type === 'phase_transition') {
                return <PhaseTransition key={i} from={msg._from} to={msg._to} />
              }
              return (
                <ChatBubble
                  key={i}
                  message={msg}
                  streaming={loading && i === history.length - 1 && msg._streaming}
                />
              )
            })}

            {loading && !history.some(m => m._streaming) && isAutoStep && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                <Loader size={14} className="animate-spin" color={activeAgent?.color} />
                {loadingMsg}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Action bar */}
          <ActionBar
            isConversation={isConversation}
            isApproval={isApproval}
            isExecution={isExecution}
            isAutoStep={isAutoStep}
            loading={loading}
            loadingMsg={loadingMsg}
            stopped={stopped}
            executionId={executionId}
            input={input}
            onInputChange={e => setInput(e.target.value)}
            onSend={handleSend}
            onApprove={handleApprove}
            onExecute={handleExecute}
            onProceed={handleProceed}
            onViewKanban={() => navigate('/kanban')}
            taskCount={generatedTasks.length}
            hasExchanges={history.filter(m => m.role === 'assistant' && !m._streaming).length >= 1}
            stepReady={stepReady}
            inputRef={inputRef}
            workflowId={workflowId}
            currentStep={currentStep}
          />
        </div>

        {/* Right: Context panel */}
        <div style={{ width: '440px', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <RightPanel
            currentStepDef={currentStepDef}
            steps={steps}
            artifacts={artifacts}
            expandedArtifacts={expandedArtifacts}
            onToggleArtifact={(id) => setExpandedArtifacts(prev => {
              const next = new Set(prev)
              next.has(id) ? next.delete(id) : next.add(id)
              return next
            })}
            generatedTasks={generatedTasks}
            sessionTasks={sessionTasks}
            activeTaskId={activeTaskId}
            executionId={executionId}
            logs={logs}
            loading={loading}
            stopped={stopped}
            onApprove={handleApprove}
          />
        </div>
      </div>
    </div>
  )
}

// ── Phase Header ──────────────────────────────────────────────────────────────

function PhaseHeader({ stepDef, stepIdx, totalSteps, steps, loading, loadingMsg, onStop, onReset, workflowName }) {
  const agent = resolveAgent(stepDef?.agent)
  const completedCount = stepIdx
  const progress = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0

  return (
    <div style={{
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      flexShrink: 0,
    }}>
      {/* Progress bar */}
      <div style={{ height: '2px', background: 'var(--border)', position: 'relative' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%',
          width: `${progress}%`,
          background: agent?.color || 'var(--accent)',
          transition: 'width 0.4s ease',
        }} />
      </div>

      <div style={{ padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '14px' }}>
        {/* Agent avatar */}
        {agent && (
          <div style={{
            width: '42px', height: '42px', borderRadius: '50%',
            background: agent.bg,
            border: `2px solid ${agent.color}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: '13px', color: agent.color,
            flexShrink: 0, letterSpacing: '0.05em',
          }}>
            {agent.initials}
          </div>
        )}

        {/* Phase info */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
            <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
              {agent?.name || stepDef?.agent || 'Agent'}
            </span>
            {agent?.title && (
              <span style={{ fontSize: '11px', color: agent.color, fontWeight: 500 }}>
                {agent.title}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {stepDef?.name || 'Loading…'}
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', opacity: 0.6 }}>·</span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {stepIdx + 1} / {totalSteps}
            </span>
            {loading && loadingMsg && (
              <>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', opacity: 0.6 }}>·</span>
                <span style={{ fontSize: '11px', color: agent?.color || 'var(--accent)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Loader size={10} className="animate-spin" />
                  {loadingMsg}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Step pipeline - compact */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
          {steps.map((s, i) => {
            const isDone    = i < stepIdx
            const isActive  = i === stepIdx
            const stepAgent = resolveAgent(s.agent)
            return (
              <div
                key={s.id}
                title={`${s.name}${s.agent ? ` · ${s.agent}` : ''}`}
                style={{
                  width: isActive ? '24px' : '8px',
                  height: '8px',
                  borderRadius: '100px',
                  background: isDone ? (stepAgent?.color || 'var(--accent)')
                    : isActive ? (stepAgent?.color || 'var(--accent)')
                    : 'var(--border-bright)',
                  opacity: isDone ? 0.6 : isActive ? 1 : 0.3,
                  transition: 'all 0.3s ease',
                }}
              />
            )
          })}
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
          {loading && (
            <button className="btn btn-ghost btn-sm" onClick={onStop} style={{ color: 'var(--red)', borderColor: 'var(--red)' }}>
              <Square size={11} fill="currentColor" /> Stop
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onReset} title="Start over">
            <RotateCcw size={12} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Phase Transition divider ───────────────────────────────────────────────────

function PhaseTransition({ from, to }) {
  const fromAgent = resolveAgent(from?.agent)
  const toAgent   = resolveAgent(to?.agent)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      margin: '20px 0', padding: '0 4px',
    }}>
      <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '5px 12px', borderRadius: '100px',
        border: '1px solid var(--border)',
        background: 'var(--bg-surface)',
        fontSize: '11px', whiteSpace: 'nowrap',
      }}>
        {fromAgent && (
          <span style={{ color: fromAgent.color, fontWeight: 500 }}>
            {from?.name || fromAgent.name}
          </span>
        )}
        {fromAgent && <span style={{ color: 'var(--text-muted)' }}>✓</span>}
        <ArrowRight size={11} color="var(--text-muted)" />
        {toAgent && (
          <span style={{ color: toAgent.color, fontWeight: 600 }}>
            {to?.name || toAgent.name}
          </span>
        )}
      </div>
      <div style={{ flex: 1, height: '1px', background: 'var(--border)' }} />
    </div>
  )
}

// ── Action bar ────────────────────────────────────────────────────────────────

function ActionBar({
  isConversation, isApproval, isExecution, isAutoStep,
  loading, loadingMsg, stopped, executionId,
  input, onInputChange, onSend, onApprove, onExecute, onProceed, onViewKanban,
  taskCount, hasExchanges, stepReady, inputRef, workflowId, currentStep
}) {
  if (isConversation && !loading) {
    const proceedLabel = getProceedLabel(workflowId, currentStep)
    return (
      <div style={{ borderTop: `2px solid ${stepReady ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--bg-surface)', flexShrink: 0 }}>
        {/* Full-width Proceed button when agent has signalled completion */}
        {stepReady && (
          <div style={{
            padding: '12px 16px',
            background: 'var(--accent-dim)',
            display: 'flex', flexDirection: 'column', gap: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ fontSize: '12px', color: 'var(--accent-hover)', fontWeight: 500 }}>
                ✓ Analysis complete — review above, then generate the fix plan.
              </span>
            </div>
            <button
              className="btn btn-primary"
              onClick={onProceed}
              style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: '14px', gap: '8px' }}
            >
              {proceedLabel} <ArrowRight size={14} />
            </button>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>
              This will automatically generate a task list for James Bond to implement.
            </div>
          </div>
        )}
        <form onSubmit={onSend} style={{ padding: '12px 20px', display: 'flex', gap: '8px' }}>
          <input
            ref={inputRef}
            className="input-base"
            value={input}
            onChange={onInputChange}
            placeholder={stepReady ? 'Ask a follow-up if something looks wrong, or click the button above…' : getPlaceholder(workflowId, currentStep)}
            disabled={loading}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
            <Send size={14} />
          </button>
        </form>
        {/* Subtle manual proceed — visible after first exchange even without AI signal */}
        {hasExchanges && !stepReady && (
          <div style={{ padding: '0 20px 12px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={onProceed}
              title="Manually advance to the next stage if the conversation feels complete"
              style={{ fontSize: '11px', color: 'var(--text-muted)', gap: '5px' }}
            >
              {proceedLabel} <ArrowRight size={11} />
            </button>
          </div>
        )}
      </div>
    )
  }

  if (isApproval && !loading) {
    const noTasks = taskCount === 0
    return (
      <div style={{
        padding: '16px 20px', borderTop: `2px solid ${noTasks ? 'var(--border)' : 'var(--accent)'}`,
        background: 'var(--bg-surface)', flexShrink: 0,
      }}>
        {noTasks ? (
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'center', padding: '4px 0' }}>
            Waiting for the fix plan to generate… If this takes too long, start fresh and try again.
          </div>
        ) : (
          <>
            <div style={{ fontSize: '11px', color: 'var(--accent-hover)', fontWeight: 600, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              ● Your review is required
            </div>
            <button
              className="btn btn-primary"
              onClick={onApprove}
              style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: '14px' }}
            >
              <Check size={16} /> Approve {taskCount} task{taskCount !== 1 ? 's' : ''} and proceed
            </button>
          </>
        )}
      </div>
    )
  }

  if (isExecution && !executionId && !stopped) {
    return (
      <div style={{
        padding: '12px 20px', borderTop: '1px solid var(--border)',
        background: 'var(--bg-surface)', display: 'flex', gap: '8px', flexShrink: 0,
      }}>
        <button
          className="btn btn-primary"
          onClick={onExecute}
          disabled={loading}
          style={{ flex: 1, justifyContent: 'center', padding: '10px' }}
        >
          {loading ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
          {loading ? 'Running…' : 'Execute all tasks'}
        </button>
        <button className="btn btn-ghost" onClick={onViewKanban}>
          View Kanban
        </button>
      </div>
    )
  }

  if (stopped) {
    return (
      <div style={{
        padding: '10px 20px', borderTop: '1px solid var(--border)',
        background: 'rgba(255,160,0,0.05)', display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0,
      }}>
        <span style={{ fontSize: '12px', color: 'var(--orange)', flex: 1 }}>
          Execution stopped. Completed tasks are preserved in Kanban.
        </span>
        <button className="btn btn-ghost btn-sm" onClick={onViewKanban}>View Kanban</button>
      </div>
    )
  }

  if (isAutoStep && loading) {
    return (
      <div style={{
        padding: '12px 20px', borderTop: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: '8px',
        fontSize: '12px', color: 'var(--text-muted)',
      }}>
        <Loader size={12} className="animate-spin" />
        {loadingMsg || 'Generating…'}
      </div>
    )
  }

  // Generation step completed — waiting for user to review before cascade continues.
  // stepReady is set by runAutoSteps after a generation step finishes.
  // The input box lets the user answer questions from the agent or request changes;
  // handleSend will re-run the generation step with the response and keep stepReady=true.
  if (isAutoStep && !loading && stepReady) {
    return (
      <div style={{
        borderTop: '2px solid var(--accent)', background: 'var(--bg-surface)',
        flexShrink: 0, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '10px',
      }}>
        <div style={{ fontSize: '12px', color: 'var(--accent-hover)', fontWeight: 500 }}>
          ✓ Review the output in the right panel.
        </div>
        {/* Let the user answer a question from the agent or request changes */}
        <form onSubmit={onSend} style={{ display: 'flex', gap: '8px' }}>
          <input
            ref={inputRef}
            className="input-base"
            value={input}
            onChange={onInputChange}
            placeholder="Answer a question or request changes — then send to regenerate…"
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" type="submit" disabled={!input.trim()}>
            <Send size={14} />
          </button>
        </form>
        <button
          className="btn btn-primary"
          onClick={onProceed}
          style={{ width: '100%', justifyContent: 'center', padding: '10px', fontSize: '14px', gap: '8px' }}
        >
          Looks good — proceed to task planning <ArrowRight size={14} />
        </button>
      </div>
    )
  }

  return null
}

// ── Right Panel ───────────────────────────────────────────────────────────────

function RightPanel({ currentStepDef, steps, artifacts, expandedArtifacts, onToggleArtifact, generatedTasks, sessionTasks, activeTaskId, executionId, logs, loading, stopped, onApprove }) {
  const isApproval = currentStepDef?.type === 'approval'
  const isExecution = currentStepDef?.type === 'execution'
  const displayTasks = sessionTasks.length ? sessionTasks : generatedTasks

  return (
    <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>

      {/* Approval: prominent task review */}
      {isApproval && (
        <ApprovalPanel tasks={generatedTasks} onApprove={onApprove} loading={loading} />
      )}

      {/* Execution: task checklist */}
      {(isExecution || executionId) && (
        <ExecutionPanel
          tasks={displayTasks}
          activeTaskId={activeTaskId}
          logs={logs}
          loading={loading}
          stopped={stopped}
        />
      )}

      {/* Tasks badge — visible on non-approval, non-execution steps when tasks exist */}
      {!isApproval && !isExecution && !executionId && displayTasks.length > 0 && (
        <div style={{
          margin: '12px 16px 0',
          padding: '10px 14px',
          background: 'var(--accent-dim)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius)',
          display: 'flex', alignItems: 'center', gap: '8px',
        }}>
          <Check size={14} color="var(--accent)" />
          <span style={{ fontSize: '12px', color: 'var(--accent-hover)', fontWeight: 500 }}>
            {displayTasks.length} task{displayTasks.length !== 1 ? 's' : ''} ready — approve them in the next step
          </span>
        </div>
      )}

      {/* Artifact stack — always visible alongside other panels */}
      {!isApproval && !executionId && (
        <ArtifactStack
          steps={steps}
          artifacts={artifacts}
          expanded={expandedArtifacts}
          onToggle={onToggleArtifact}
        />
      )}
    </div>
  )
}

// ── Approval Panel ────────────────────────────────────────────────────────────

function ApprovalPanel({ tasks, onApprove, loading }) {
  const groups = groupByOrder(tasks)
  const PRIORITY_COLORS = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--blue)' }

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px',
        background: 'var(--accent-dim)',
        border: '1px solid var(--accent)',
        borderRadius: 'var(--radius)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-hover)' }}>
            Plan ready for your review
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
            {tasks.length} tasks · review before James Bond executes
          </div>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={onApprove}
          disabled={loading || !tasks.length}
        >
          <Check size={12} /> Approve
        </button>
      </div>

      {/* Task groups */}
      {Object.entries(groups).sort(([a], [b]) => Number(a) - Number(b)).map(([order, groupTasks]) => (
        <div key={order}>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: '100px', padding: '1px 8px',
            }}>
              Step {Number(order) + 1}
            </span>
            {groupTasks.length > 1 && (
              <span style={{ color: 'var(--purple)', fontSize: '10px' }}>⚡ parallel · {groupTasks.length} tasks</span>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', paddingLeft: '10px', borderLeft: '2px solid var(--border-bright)' }}>
            {groupTasks.map((t, i) => (
              <div key={i} style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '9px 11px', fontSize: '12px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '3px' }}>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: PRIORITY_COLORS[t.priority] || 'var(--text-muted)', flexShrink: 0 }} />
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.title}</span>
                </div>
                {t.description && (
                  <div style={{ color: 'var(--text-muted)', fontSize: '11px', lineHeight: 1.45, paddingLeft: '13px' }}>
                    {t.description.slice(0, 120)}{t.description.length > 120 ? '…' : ''}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '6px', marginTop: '5px', paddingLeft: '13px', alignItems: 'center' }}>
                  {t.tags?.slice(0, 3).map(tag => (
                    <span key={tag} style={{ fontSize: '9px', color: 'var(--text-muted)', background: 'var(--bg-base)', border: '1px solid var(--border)', padding: '1px 5px', borderRadius: '100px' }}>{tag}</span>
                  ))}
                  {t.estimatedHours && (
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{t.estimatedHours}h est.</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Execution Panel ───────────────────────────────────────────────────────────

function ExecutionPanel({ tasks, activeTaskId, logs, loading, stopped }) {
  const done    = tasks.filter(t => ['done', 'review'].includes(t.column)).length
  const running = tasks.filter(t => t.column === 'in_progress').length
  const total   = tasks.length
  const pct     = total ? Math.round((done / total) * 100) : 0

  return (
    <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Progress overview */}
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {stopped ? 'Stopped' : loading ? 'Executing…' : 'Complete'}
          </span>
          <span style={{ fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
            {done} / {total}
          </span>
        </div>
        <div style={{ height: '4px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: '2px',
            width: `${pct}%`,
            background: stopped ? 'var(--orange)' : 'var(--green)',
            transition: 'width 0.4s ease',
          }} />
        </div>
      </div>

      {/* Task checklist */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {tasks.map((task) => {
          const isRunning = task.id === activeTaskId || task.column === 'in_progress'
          const isDone    = ['done', 'review'].includes(task.column)
          const taskLogs  = logs.filter(l => l.message?.includes(task.title))

          return (
            <div key={task.id} style={{
              background: 'var(--bg-elevated)',
              border: `1px solid ${isRunning ? 'var(--accent)' : isDone ? 'var(--border)' : 'var(--border)'}`,
              borderRadius: 'var(--radius)', padding: '9px 11px', fontSize: '12px',
              transition: 'border-color 0.2s',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Status indicator */}
                <div style={{ flexShrink: 0, width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isDone   && <Check size={13} color="var(--green)" />}
                  {isRunning && !isDone && <Loader size={13} className="animate-spin" color="var(--accent)" />}
                  {!isDone && !isRunning && (
                    <div style={{ width: '8px', height: '8px', borderRadius: '50%', border: '1.5px solid var(--border-bright)' }} />
                  )}
                </div>
                <span style={{
                  flex: 1,
                  color: isDone ? 'var(--text-muted)' : isRunning ? 'var(--text-primary)' : 'var(--text-secondary)',
                  fontWeight: isRunning ? 600 : 400,
                  textDecoration: isDone ? 'line-through' : 'none',
                }}>
                  {task.title}
                </span>
                {task.executionType === 'parallel' && (
                  <span style={{ fontSize: '9px', color: 'var(--purple)', flexShrink: 0 }}>⚡</span>
                )}
              </div>
              {isRunning && task.description && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px', paddingLeft: '24px', lineHeight: 1.4 }}>
                  {task.description.slice(0, 80)}…
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Recent log entries */}
      {logs.length > 0 && (
        <div style={{
          background: 'var(--bg-base)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '8px 10px',
          maxHeight: '160px', overflow: 'auto',
        }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '6px' }}>
            Log
          </div>
          {logs.slice(-15).map((entry, i) => (
            <div key={i} style={{
              fontSize: '11px', fontFamily: 'var(--font-mono)',
              color: entry.type === 'error' ? 'var(--red)'
                : entry.type === 'success' ? 'var(--green)'
                : 'var(--text-muted)',
              lineHeight: 1.5,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {entry.message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Artifact Stack ────────────────────────────────────────────────────────────

function ArtifactStack({ steps, artifacts, expanded, onToggle }) {
  const artifactSteps = steps.filter(s => AUTO_STEPS.has(s.type) && artifacts[s.id])

  if (!artifactSteps.length) {
    return (
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '32px', color: 'var(--text-muted)', fontSize: '12px', textAlign: 'center',
      }}>
        <div>
          <div style={{ fontSize: '28px', marginBottom: '10px', opacity: 0.3 }}>📄</div>
          <div>Generated artifacts will appear here</div>
          <div style={{ fontSize: '11px', marginTop: '6px', opacity: 0.6 }}>Spec, task plan, architecture docs, etc.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '0 4px', marginBottom: '2px' }}>
        Generated Artifacts
      </div>
      {artifactSteps.map(stepDef => {
        const agent  = resolveAgent(stepDef.agent)
        const isOpen = expanded.has(stepDef.id)
        return (
          <div key={stepDef.id} style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', overflow: 'hidden',
          }}>
            {/* Card header */}
            <button
              onClick={() => onToggle(stepDef.id)}
              style={{
                width: '100%', padding: '10px 12px',
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'none', border: 'none', cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{
                width: '22px', height: '22px', borderRadius: '50%',
                background: agent?.bg || 'var(--bg-base)',
                border: `1.5px solid ${agent?.color || 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '9px', fontWeight: 700, color: agent?.color,
                flexShrink: 0,
              }}>
                {agent?.initials || '?'}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>{stepDef.name}</div>
                <div style={{ fontSize: '10px', color: agent?.color || 'var(--text-muted)' }}>{agent?.name}</div>
              </div>
              <div style={{ flexShrink: 0 }}>
                {isOpen ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
              </div>
            </button>

            {/* Card content */}
            {isOpen && (
              <div style={{
                padding: '0 12px 12px',
                borderTop: '1px solid var(--border)',
                maxHeight: '320px', overflow: 'auto',
              }}>
                <div className="markdown-body" style={{ fontSize: '11px', paddingTop: '10px' }}>
                  <ReactMarkdown>{artifacts[stepDef.id]}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ workflowId, steps }) {
  const first = steps[0]
  const agent = resolveAgent(first?.agent)
  const msgs = {
    'feature-dev':        { title: 'feature-dev', body: 'Describe the feature you want to build. Moneypenny will make sure requirements are solid before the team generates the spec and task plan.' },
    'greenfield':         { title: 'greenfield build', body: 'Tell Moneypenny about your new project. She\'ll lead discovery before the team writes the PRD, designs the architecture, and plans the build.' },
    'brownfield-feature': { title: 'brownfield feature', body: 'Describe the feature you\'re adding to an existing codebase. Moneypenny will focus on integration risks and backwards compatibility.' },
    'bug-fix':            { title: 'bug fix', body: 'Describe the bug. Tanner will investigate the root cause, then James Bond will create a minimal fix plan for your approval before touching any code.' },
  }
  const m = msgs[workflowId] || { title: workflowId, body: 'Describe what you want to build.' }

  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted)', fontSize: '13px' }}>
      {agent && (
        <div style={{
          width: '52px', height: '52px', borderRadius: '50%',
          background: agent.bg, border: `2px solid ${agent.color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: '16px', color: agent.color,
          margin: '0 auto 14px',
        }}>
          {agent.initials}
        </div>
      )}
      <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px', fontSize: '14px' }}>{m.title}</div>
      <div style={{ lineHeight: 1.6, maxWidth: '320px', margin: '0 auto' }}>{m.body}</div>
      {agent && (
        <div style={{ marginTop: '12px', fontSize: '11px', color: agent.color }}>
          {agent.name} · {agent.title}
        </div>
      )}
    </div>
  )
}

// ── Utility helpers ────────────────────────────────────────────────────────────

function groupByOrder(tasks) {
  return tasks.reduce((acc, t) => {
    const order = t.executionOrder ?? 0
    if (!acc[order]) acc[order] = []
    acc[order].push(t)
    return acc
  }, {})
}

function parseTasks(reply) {
  const match = reply.match(/<tasks>([\s\S]*?)<\/tasks>/)
  if (!match) return []
  try { return JSON.parse(match[1]) } catch { return [] }
}

function buildAutoMessage(step, artifacts, generatedTasks, workflowId) {
  const prevArtifacts = Object.entries(artifacts)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.toUpperCase()}:\n${v.slice(0, 2000)}`)
    .join('\n\n---\n\n')

  switch (step.id) {
    case 'spec':
    case 'prd':         return `Generate the ${step.name} document based on:\n\n${prevArtifacts}`
    case 'architecture':return `Design the architecture based on:\n\n${prevArtifacts}`
    case 'stories':     return `Create sprint-ready stories from:\n\n${prevArtifacts}`
    case 'tasks':
      if (workflowId === 'bug-fix') {
        return `Based on the bug investigation above, create a minimal targeted fix plan. Output the tasks as a JSON array inside <tasks></tasks> tags. Keep it lean — only the changes needed to fix this specific bug plus a regression test:\n\n${prevArtifacts}`
      }
      return `Break down into executable Kanban tasks based on:\n\n${prevArtifacts}`
    default:            return `Generate ${step.name} based on:\n\n${prevArtifacts}`
  }
}

function formatAutoResult(step, reply) {
  return `## ${step.name} ready ✓\n\n${reply.slice(0, 180)}${reply.length > 180 ? '…' : ''}\n\n*Full ${step.name} is in the right panel.*`
}

function buildTaskSummary(tasks) {
  const lines = tasks.map((t, i) => `${i + 1}. **${t.title}** · step ${t.executionOrder} · ${t.executionType}`).join('\n')
  return `## ${tasks.length} tasks planned ✓\n\n${lines}\n\nReview the execution plan in the panel →`
}

function getPlaceholder(workflowId, step) {
  const map = {
    'feature-dev:requirements':         'Describe the feature, or answer Moneypenny\'s question…',
    'greenfield:discovery':             'Tell Moneypenny about your project idea…',
    'brownfield-feature:requirements':  'Describe the feature to add, or answer Moneypenny\'s question…',
    'bug-fix:investigate':              'Describe the bug, or answer Tanner\'s question…',
  }
  return map[`${workflowId}:${step}`] || 'Type your response…'
}

function getProceedLabel(workflowId, step) {
  const map = {
    'bug-fix:investigate':              'Investigation complete — proceed to fix plan',
    'feature-dev:requirements':         'Requirements captured — proceed to tech spec',
    'brownfield-feature:requirements':  'Requirements captured — proceed to spec',
    'greenfield:discovery':             'Discovery complete — proceed to PRD',
  }
  return map[`${workflowId}:${step}`] || 'This step is complete — proceed'
}
