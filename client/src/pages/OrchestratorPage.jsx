/**
 * Orchestrator Page
 *
 * Shows all missions: their status, plan, rationale, live execution log,
 * and approval / Q&A controls.
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  Bot, CheckCircle, XCircle, Clock, AlertTriangle, ChevronDown, ChevronRight,
  Play, X, MessageSquare, FileCode, Loader, RefreshCw, Zap, Users, Shield
} from 'lucide-react'
import { useStore } from '../store'
import { useSocket } from '../hooks/useSocket'

// ── Agent colour map ──────────────────────────────────────────────────────────
const AGENT_COLORS = {
  orchestrator:  'var(--accent-hover)',
  moneypenny:    'var(--green)',
  mallory:       'var(--blue)',
  quartermaster: 'var(--purple)',
  'james-bond':  'var(--yellow)',
  tanner:        'var(--red)',
  felix:         'var(--orange)',
  user:          'var(--text-secondary)',
}

function agentColor(agentName = '') {
  const lower = agentName.toLowerCase()
  for (const [key, color] of Object.entries(AGENT_COLORS).sort((a, b) => b[0].length - a[0].length)) {
    if (lower.includes(key.replace('-', ' ')) || lower.includes(key)) return color
  }
  return 'var(--text-muted)'
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS = {
  planning:          { label: 'Planning',          color: 'var(--accent-hover)', icon: Loader,        spin: true  },
  awaiting_info:     { label: 'Needs Info',         color: 'var(--yellow)',       icon: MessageSquare, spin: false },
  awaiting_approval: { label: 'Awaiting Approval',  color: 'var(--blue)',         icon: Shield,        spin: false },
  executing:         { label: 'Executing',          color: 'var(--orange)',       icon: Loader,        spin: true  },
  complete:          { label: 'Complete',           color: 'var(--green)',        icon: CheckCircle,   spin: false },
  failed:            { label: 'Failed',             color: 'var(--red)',          icon: XCircle,       spin: false },
  cancelled:         { label: 'Cancelled',          color: 'var(--text-muted)',   icon: XCircle,       spin: false },
}

const STEP_STATUS = {
  pending:     { color: 'var(--text-muted)',   label: 'Pending'    },
  in_progress: { color: 'var(--orange)',       label: 'Running'    },
  complete:    { color: 'var(--green)',        label: 'Complete'   },
  failed:      { color: 'var(--red)',          label: 'Failed'     },
}

const CONFIDENCE_COLOR = { high: 'var(--green)', medium: 'var(--yellow)', low: 'var(--red)' }

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OrchestratorPage() {
  const [missions, setMissions]         = useState([])
  const [selected, setSelected]         = useState(null)
  const [loading, setLoading]           = useState(true)
  const [triggering, setTriggering]     = useState(false)
  const { socket }                      = useSocket()
  const { tasks }                       = useStore()

  useEffect(() => { fetchMissions() }, [])

  // ── Socket listeners ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return

    const refresh = () => fetchMissions()
    const updateSelected = (data) => {
      if (selected && data.id === selected.id) setSelected(data)
      setMissions(ms => ms.map(m => m.id === data.id ? { ...m, ...data } : m))
    }

    socket.on('mission:created',   m => setMissions(ms => [m, ...ms]))
    socket.on('mission:updated',   updateSelected)
    socket.on('mission:plan_ready',updateSelected)
    socket.on('mission:complete',  updateSelected)
    socket.on('mission:error',     refresh)
    socket.on('mission:step_start', refresh)
    socket.on('mission:step_complete', refresh)
    socket.on('mission:file_changed', refresh)
    socket.on('mission:info_needed', refresh)

    return () => {
      socket.off('mission:created')
      socket.off('mission:updated')
      socket.off('mission:plan_ready')
      socket.off('mission:complete')
      socket.off('mission:error')
      socket.off('mission:step_start')
      socket.off('mission:step_complete')
      socket.off('mission:file_changed')
      socket.off('mission:info_needed')
    }
  }, [socket, selected])

  async function fetchMissions() {
    setLoading(true)
    try {
      const res = await fetch('/api/agents/missions')
      const data = await res.json()
      setMissions(data.missions || [])
      if (selected) {
        const fresh = (data.missions || []).find(m => m.id === selected.id)
        if (fresh) setSelected(fresh)
      }
    } catch {}
    setLoading(false)
  }

  async function triggerPickup() {
    setTriggering(true)
    await fetch('/api/agents/pickup', { method: 'POST' })
    await fetchMissions()
    setTriggering(false)
  }

  const todoTasks = tasks.filter(t => t.column === 'todo' && !t.missionId)

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* Left panel — mission list */}
      <div style={{
        width: '300px', borderRight: '1px solid var(--border)',
        background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column',
        flexShrink: 0
      }}>
        <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={15} color="var(--accent-hover)" />
              <span style={{ fontSize: '13px', fontWeight: 600 }}>Missions</span>
            </div>
            <button
              className="btn btn-ghost btn-icon"
              onClick={fetchMissions}
              title="Refresh"
            >
              <RefreshCw size={13} />
            </button>
          </div>
          {todoTasks.length > 0 && (
            <button
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center', fontSize: '12px' }}
              onClick={triggerPickup}
              disabled={triggering}
            >
              {triggering ? <Loader size={13} className="animate-spin" /> : <Zap size={13} />}
              Pick up {todoTasks.length} todo task{todoTasks.length !== 1 ? 's' : ''}
            </button>
          )}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
          {loading && missions.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '12px' }}>
              <Loader size={16} className="animate-spin" style={{ marginBottom: '8px' }} />
              <div>Loading missions...</div>
            </div>
          )}
          {!loading && missions.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-muted)', fontSize: '12px' }}>
              <Bot size={24} style={{ marginBottom: '10px', opacity: 0.4 }} />
              <div style={{ fontWeight: 500, marginBottom: '4px' }}>No missions yet</div>
              <div>Move tasks to the Todo column — the Orchestrator will pick them up automatically.</div>
            </div>
          )}
          {missions.map(m => (
            <MissionListItem
              key={m.id}
              mission={m}
              active={selected?.id === m.id}
              onClick={() => setSelected(m)}
            />
          ))}
        </div>
      </div>

      {/* Right panel — mission detail */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: '12px', color: 'var(--text-muted)' }}>
            <Bot size={32} style={{ opacity: 0.3 }} />
            <div style={{ fontSize: '13px' }}>Select a mission to view details</div>
          </div>
        ) : (
          <MissionDetail
            mission={selected}
            onRefresh={fetchMissions}
            onUpdate={m => setSelected(m)}
          />
        )}
      </div>
    </div>
  )
}

// ── Mission list item ─────────────────────────────────────────────────────────

function MissionListItem({ mission, active, onClick }) {
  const s = STATUS[mission.status] || STATUS.planning
  const Icon = s.icon
  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px', borderRadius: 'var(--radius)', cursor: 'pointer',
        background: active ? 'var(--bg-active)' : 'transparent',
        border: `1px solid ${active ? 'var(--border-bright)' : 'transparent'}`,
        marginBottom: '2px', transition: 'all 0.12s'
      }}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <Icon size={13} color={s.color} className={s.spin ? 'animate-spin' : ''} style={{ flexShrink: 0 }} />
        <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {mission.taskTitle}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingLeft: '21px' }}>
        <span style={{ fontSize: '10px', color: s.color }}>{s.label}</span>
        {mission.steps?.length > 0 && (
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
            {mission.steps.filter(s => s.status === 'complete').length}/{mission.steps.length} steps
          </span>
        )}
      </div>
    </div>
  )
}

// ── Mission detail ────────────────────────────────────────────────────────────

function MissionDetail({ mission, onRefresh, onUpdate }) {
  const [approvalMode, setApprovalMode] = useState('all')
  const [selectedSteps, setSelectedSteps] = useState([])
  const [approving, setApproving] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState({})
  const logEndRef = useRef(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mission.log?.length])

  useEffect(() => {
    if (mission.steps) {
      setSelectedSteps(mission.steps.map(s => s.id))
    }
  }, [mission.id])

  async function handleApprove() {
    setApproving(true)
    await fetch(`/api/agents/missions/${mission.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalMode, approvedStepIds: selectedSteps }),
    })
    await onRefresh()
    setApproving(false)
  }

  async function handleCancel() {
    await fetch(`/api/agents/missions/${mission.id}`, { method: 'DELETE' })
    await onRefresh()
  }

  async function handleRetry() {
    setRetrying(true)
    await fetch(`/api/agents/missions/${mission.id}/retry`, { method: 'POST' })
    await onRefresh()
    setRetrying(false)
  }

  async function handleAnswer(questionId) {
    const answer = answers[questionId]
    if (!answer?.trim()) return
    setSubmitting(s => ({ ...s, [questionId]: true }))
    await fetch(`/api/agents/missions/${mission.id}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId, answer }),
    })
    setAnswers(a => ({ ...a, [questionId]: '' }))
    await onRefresh()
    setSubmitting(s => ({ ...s, [questionId]: false }))
  }

  const s = STATUS[mission.status] || STATUS.planning
  const Icon = s.icon

  return (
    <div style={{ padding: '24px', maxWidth: '860px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
            <Icon size={16} color={s.color} className={s.spin ? 'animate-spin' : ''} />
            <h2 style={{ fontSize: '16px', fontWeight: 700 }}>{mission.taskTitle}</h2>
          </div>
          <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
            <span style={{ color: s.color, fontWeight: 500 }}>{s.label}</span>
            {mission.fileChanges?.length > 0 && (
              <span>{mission.fileChanges.length} file(s) changed</span>
            )}
            {mission.createdAt && (
              <span>{new Date(mission.createdAt).toLocaleTimeString()}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {mission.status === 'failed' && (
            <button className="btn btn-primary btn-sm" onClick={handleRetry} disabled={retrying}>
              {retrying ? <Loader size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          )}
          {!['complete', 'cancelled', 'failed'].includes(mission.status) && (
            <button className="btn btn-ghost btn-sm" onClick={handleCancel}>
              <X size={13} /> Cancel
            </button>
          )}
        </div>
      </div>

      {/* Mission summary */}
      {mission.plan?.summary && (
        <div style={{
          padding: '12px 16px', borderRadius: 'var(--radius)',
          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '20px', lineHeight: 1.5
        }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
            Plan Summary
          </span>
          {mission.plan.summary}
          {mission.plan.riskLevel && mission.plan.riskLevel !== 'low' && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '6px', alignItems: 'center', color: mission.plan.riskLevel === 'high' ? 'var(--red)' : 'var(--yellow)', fontSize: '12px' }}>
              <AlertTriangle size={13} />
              <span>{mission.plan.riskNotes}</span>
            </div>
          )}
        </div>
      )}

      {/* Pending questions */}
      {mission.pendingQuestions?.filter(q => !q.answer).length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <SectionLabel icon={MessageSquare} label="Information Needed" color="var(--yellow)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {mission.pendingQuestions.filter(q => !q.answer).map(q => (
              <div key={q.id} style={{
                padding: '14px 16px', borderRadius: 'var(--radius)',
                background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)',
              }}>
                <div style={{ fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  {q.question}
                </div>
                {q.context && (
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                    {q.context}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    className="input-base"
                    value={answers[q.id] || ''}
                    onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleAnswer(q.id)}
                    placeholder="Your answer..."
                    style={{ flex: 1, fontSize: '12px' }}
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleAnswer(q.id)}
                    disabled={submitting[q.id] || !answers[q.id]?.trim()}
                  >
                    {submitting[q.id] ? <Loader size={12} className="animate-spin" /> : 'Submit'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Plan — step list with rationale */}
      {mission.steps?.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <SectionLabel icon={Bot} label="Mission Plan" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {mission.steps.map((step, idx) => (
              <StepCard
                key={step.id}
                step={step}
                index={idx}
                approvalMode={approvalMode}
                isSelected={selectedSteps.includes(step.id)}
                onToggle={() => setSelectedSteps(prev =>
                  prev.includes(step.id) ? prev.filter(id => id !== step.id) : [...prev, step.id]
                )}
                showCheckbox={mission.status === 'awaiting_approval' && approvalMode === 'individual'}
              />
            ))}
          </div>

          {/* Approval controls */}
          {mission.status === 'awaiting_approval' && (
            <div style={{
              marginTop: '16px', padding: '16px', borderRadius: 'var(--radius)',
              background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px'
            }}>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['all', 'individual'].map(mode => (
                  <button
                    key={mode}
                    onClick={() => setApprovalMode(mode)}
                    style={{
                      padding: '5px 12px', borderRadius: '100px', fontSize: '12px', cursor: 'pointer',
                      background: approvalMode === mode ? 'var(--accent-dim)' : 'transparent',
                      border: `1px solid ${approvalMode === mode ? 'var(--accent)' : 'var(--border)'}`,
                      color: approvalMode === mode ? 'var(--accent-hover)' : 'var(--text-muted)',
                    }}
                  >
                    {mode === 'all' ? 'Approve all' : 'Approve selected'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-ghost btn-sm" onClick={handleCancel}>
                  <X size={13} /> Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleApprove}
                  disabled={approving || (approvalMode === 'individual' && selectedSteps.length === 0)}
                >
                  {approving
                    ? <><Loader size={13} className="animate-spin" /> Starting...</>
                    : <><Play size={13} /> {approvalMode === 'all' ? 'Approve & Run' : `Run ${selectedSteps.length} step(s)`}</>
                  }
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* File changes */}
      {mission.fileChanges?.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <SectionLabel icon={FileCode} label={`File Changes (${mission.fileChanges.length})`} color="var(--green)" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {mission.fileChanges.map((fc, i) => (
              <div key={i} style={{
                padding: '10px 14px', borderRadius: 'var(--radius)',
                background: 'var(--green-dim)', border: '1px solid rgba(34,197,94,0.15)',
                fontSize: '12px', display: 'flex', gap: '12px', alignItems: 'flex-start'
              }}>
                <CheckCircle size={13} color="var(--green)" style={{ flexShrink: 0, marginTop: '1px' }} />
                <div>
                  <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', marginBottom: '2px' }}>
                    {fc.path}
                  </div>
                  <div style={{ color: 'var(--text-muted)' }}>{fc.rationale}</div>
                </div>
                <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  {fc.action}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Execution log */}
      {mission.log?.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <SectionLabel icon={Clock} label="Activity Log" />
          <div style={{
            borderRadius: 'var(--radius)', border: '1px solid var(--border)',
            background: 'var(--bg-base)', overflow: 'hidden', maxHeight: '280px', overflowY: 'auto'
          }}>
            {mission.log.map((entry, i) => (
              <LogEntry key={i} entry={entry} />
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Step card ─────────────────────────────────────────────────────────────────

function StepCard({ step, index, showCheckbox, isSelected, onToggle }) {
  const [expanded, setExpanded] = useState(false)
  const ss = STEP_STATUS[step.status] || STEP_STATUS.pending
  const aColor = agentColor(step.agentName)

  return (
    <div style={{
      borderRadius: 'var(--radius)', border: '1px solid var(--border)',
      background: step.status === 'complete' ? 'rgba(34,197,94,0.04)' : 'var(--bg-elevated)',
      overflow: 'hidden', transition: 'all 0.2s'
    }}>
      <div
        style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}
        onClick={() => setExpanded(e => !e)}
      >
        {showCheckbox && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={e => { e.stopPropagation(); onToggle() }}
            style={{ width: '14px', height: '14px', flexShrink: 0 }}
          />
        )}

        {/* Step number */}
        <div style={{
          width: '22px', height: '22px', borderRadius: '50%', flexShrink: 0,
          background: step.status === 'complete' ? 'var(--green-dim)' : step.status === 'in_progress' ? 'var(--accent-dim)' : 'var(--bg-base)',
          border: `1px solid ${step.status === 'complete' ? 'var(--green)' : step.status === 'in_progress' ? 'var(--accent)' : 'var(--border-bright)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600,
          color: step.status === 'complete' ? 'var(--green)' : step.status === 'in_progress' ? 'var(--accent-hover)' : 'var(--text-muted)'
        }}>
          {step.status === 'complete' ? <CheckCircle size={12} /> : step.status === 'in_progress' ? <Loader size={12} className="animate-spin" /> : index + 1}
        </div>

        {/* Agent badge */}
        <span style={{
          fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '100px',
          background: `${aColor}18`, color: aColor, flexShrink: 0
        }}>
          {step.agentName}
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '13px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {step.subTask}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {/* Confidence badge */}
          <span style={{
            fontSize: '10px', color: CONFIDENCE_COLOR[step.confidence] || 'var(--text-muted)',
            background: `${CONFIDENCE_COLOR[step.confidence]}18`, padding: '1px 6px', borderRadius: '100px'
          }}>
            {step.confidence}
          </span>
          {expanded ? <ChevronDown size={13} color="var(--text-muted)" /> : <ChevronRight size={13} color="var(--text-muted)" />}
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '0 14px 14px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '12px' }}>
            <DetailBlock label="Rationale" value={step.rationale} />
            <DetailBlock label="Evidence" value={step.evidence} />
          </div>
          {step.filesLikelyAffected?.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '4px' }}>
                Files affected
              </span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {step.filesLikelyAffected.map(f => (
                  <span key={f} style={{
                    fontSize: '11px', fontFamily: 'var(--font-mono)', padding: '2px 7px',
                    background: 'var(--bg-base)', border: '1px solid var(--border-bright)',
                    borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)'
                  }}>{f}</span>
                ))}
              </div>
            </div>
          )}
          {step.assumptions?.length > 0 && (
            <div style={{ marginTop: '10px', padding: '8px 12px', borderRadius: 'var(--radius)', background: 'rgba(234,179,8,0.06)', border: '1px solid rgba(234,179,8,0.2)' }}>
              <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--yellow)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '4px' }}>
                Assumptions
              </span>
              {step.assumptions.map((a, i) => (
                <div key={i} style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>• {a}</div>
              ))}
            </div>
          )}
          {step.result && (
            <div style={{ marginTop: '10px' }}>
              <DetailBlock label="Result" value={step.result} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Log entry ─────────────────────────────────────────────────────────────────

function LogEntry({ entry }) {
  const color = entry.type === 'error' ? 'var(--red)'
    : entry.type === 'success' ? 'var(--green)'
    : entry.type === 'warn' ? 'var(--yellow)'
    : 'var(--text-muted)'
  const aColor = agentColor(entry.agent)
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''

  return (
    <div style={{
      padding: '6px 14px', borderBottom: '1px solid var(--border)',
      display: 'flex', gap: '10px', alignItems: 'baseline', fontSize: '12px'
    }}>
      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: '10px', flexShrink: 0 }}>{time}</span>
      <span style={{ color: aColor, fontWeight: 600, flexShrink: 0, fontSize: '11px' }}>{entry.agent}</span>
      <span style={{ color }}>{entry.message}</span>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label, color = 'var(--text-muted)' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
      <Icon size={13} color={color} />
      <span style={{ fontSize: '11px', fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </span>
    </div>
  )
}

function DetailBlock({ label, value }) {
  if (!value) return null
  return (
    <div>
      <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '4px' }}>
        {label}
      </span>
      <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5, margin: 0 }}>{value}</p>
    </div>
  )
}
