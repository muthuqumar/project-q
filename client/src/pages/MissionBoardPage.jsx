import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Bot, Loader, CheckCircle, XCircle, Play, Pause,
  SkipForward, RotateCcw, X, ChevronRight, AlertCircle,
  Send, Zap, RefreshCw, ToggleLeft, ToggleRight,
  Pencil, Trash2, Plus, Save
} from 'lucide-react'
import { io } from 'socket.io-client'

let _socket = null
function getSocket() {
  if (!_socket) _socket = io(window.location.origin, { transports: ['websocket', 'polling'] })
  return _socket
}

const COLUMNS = [
  { id: 'planning', label: 'Planning',  statuses: ['planning'],                         color: '#6366f1' },
  { id: 'review',   label: 'Review',    statuses: ['awaiting_info','awaiting_approval'], color: '#f59e0b' },
  { id: 'running',  label: 'Running',   statuses: ['executing','paused'],                color: '#3b82f6' },
  { id: 'done',     label: 'Done',      statuses: ['complete'],                          color: '#22c55e' },
  { id: 'failed',   label: 'Failed',    statuses: ['failed','cancelled'],                color: '#ef4444' },
]

const STATUS_LABELS = {
  planning: 'Planning…', awaiting_info: 'Needs Input', awaiting_approval: 'Awaiting Approval',
  executing: 'Running', paused: 'Paused', complete: 'Done', failed: 'Failed', cancelled: 'Cancelled',
}

function agentColor(name = '') {
  const colors = ['#6366f1','#22c55e','#f59e0b','#3b82f6','#a855f7','#ef4444','#f97316']
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % colors.length
  return colors[h]
}

function elapsed(ts) {
  if (!ts) return ''
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s/60)}m`; return `${Math.floor(s/3600)}h`
}

async function api(method, path, body) {
  const res = await fetch(`/api/agents${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  return res.json()
}

function StatusIcon({ status, size = 12 }) {
  if (status === 'planning')           return <Loader size={size} className="animate-spin" color="var(--accent)" />
  if (status === 'executing')          return <Loader size={size} className="animate-spin" color="#3b82f6" />
  if (status === 'paused')             return <Pause size={size} color="#f59e0b" />
  if (status === 'awaiting_info')      return <AlertCircle size={size} color="#f59e0b" />
  if (status === 'awaiting_approval')  return <CheckCircle size={size} color="#f59e0b" />
  if (status === 'complete')           return <CheckCircle size={size} color="#22c55e" />
  if (['failed','cancelled'].includes(status)) return <XCircle size={size} color="#ef4444" />
  return null
}

function SimpleMarkdown({ text }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let i = 0

  const renderInline = (str) => {
    // Bold: **text**
    const parts = str.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    return parts.map((p, idx) => {
      if (p.startsWith('**') && p.endsWith('**')) return <strong key={idx}>{p.slice(2, -2)}</strong>
      if (p.startsWith('`') && p.endsWith('`')) return <code key={idx} style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', background: 'var(--bg-base)', padding: '1px 4px', borderRadius: '3px' }}>{p.slice(1, -1)}</code>
      return p
    })
  }

  while (i < lines.length) {
    const line = lines[i]

    // Headings
    if (line.startsWith('### ')) {
      elements.push(<div key={i} style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '14px', marginBottom: '4px' }}>{renderInline(line.slice(4))}</div>)
    } else if (line.startsWith('## ')) {
      elements.push(<div key={i} style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '18px', marginBottom: '6px', borderBottom: '1px solid var(--border)', paddingBottom: '4px' }}>{renderInline(line.slice(3))}</div>)
    } else if (line.startsWith('# ')) {
      elements.push(<div key={i} style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)', marginTop: '8px', marginBottom: '10px' }}>{renderInline(line.slice(2))}</div>)
    }
    // Table row (starts with |)
    else if (line.trim().startsWith('|')) {
      // Skip separator rows (|---|---|)
      if (/^\|[\s\-:|]+\|/.test(line)) { i++; continue }
      const cells = line.split('|').filter((_, ci) => ci > 0 && ci < line.split('|').length - 1)
      const isHeader = i + 1 < lines.length && /^\|[\s\-:|]+\|/.test(lines[i + 1])
      elements.push(
        <div key={i} style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border)', background: isHeader ? 'var(--bg-base)' : undefined }}>
          {cells.map((cell, ci) => (
            <div key={ci} style={{ flex: 1, padding: '4px 8px', fontSize: '11px', fontWeight: isHeader ? 600 : 400, color: isHeader ? 'var(--text-muted)' : 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {renderInline(cell.trim())}
            </div>
          ))}
        </div>
      )
    }
    // Code block
    else if (line.startsWith('```')) {
      const lang = line.slice(3).trim()
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <pre key={i} style={{
          background: 'var(--bg-base)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '10px 12px',
          fontSize: '11px', fontFamily: 'var(--font-mono)',
          overflowX: 'auto', margin: '8px 0', lineHeight: 1.5,
          color: 'var(--text-secondary)',
        }}>
          {codeLines.join('\n')}
        </pre>
      )
    }
    // Bullet list
    else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(
        <div key={i} style={{ display: 'flex', gap: '6px', padding: '2px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '1px' }}>·</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      )
    }
    // Numbered list
    else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)/)
      elements.push(
        <div key={i} style={{ display: 'flex', gap: '8px', padding: '2px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <span style={{ color: 'var(--text-muted)', flexShrink: 0, minWidth: '16px', textAlign: 'right', fontSize: '11px' }}>{match[1]}.</span>
          <span>{renderInline(match[2])}</span>
        </div>
      )
    }
    // Blank line — small gap
    else if (!line.trim()) {
      elements.push(<div key={i} style={{ height: '6px' }} />)
    }
    // Regular paragraph text
    else {
      elements.push(<div key={i} style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6', padding: '1px 0' }}>{renderInline(line)}</div>)
    }

    i++
  }

  return <div style={{ lineHeight: 1.6 }}>{elements}</div>
}

function MissionCard({ mission, selected, onClick }) {
  const completedSteps = (mission.steps || []).filter(s => s.status === 'complete').length
  const totalSteps = (mission.steps || []).length
  const fileCount = (mission.fileChanges || []).length
  const agents = [...new Set((mission.steps || []).map(s => s.agentName).filter(Boolean))].slice(0,4)

  return (
    <div onClick={onClick} style={{
      background: selected ? 'var(--bg-active)' : 'var(--bg-elevated)',
      border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 'var(--radius)', padding: '12px', cursor: 'pointer',
      marginBottom: '8px', transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '8px' }}>
        <div style={{ marginTop: '3px', flexShrink: 0 }}>
          <StatusIcon status={mission.status} />
        </div>
        <div style={{ fontSize: '13px', fontWeight: 500, lineHeight: '1.4', flex: 1, color: 'var(--text-primary)' }}>
          {mission.taskTitle}
        </div>
      </div>

      {totalSteps > 0 && mission.status === 'executing' && (
        <div style={{ marginBottom: '8px' }}>
          <div style={{ height: '3px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(completedSteps/totalSteps)*100}%`, background: '#3b82f6', transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '3px' }}>
            step {completedSteps + 1} of {totalSteps}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        {agents.map(name => (
          <div key={name} style={{
            width: '18px', height: '18px', borderRadius: '50%', background: agentColor(name),
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '9px', fontWeight: 700, color: 'white', flexShrink: 0,
          }} title={name}>{name[0]}</div>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
          {fileCount > 0 && <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{fileCount} file{fileCount !== 1 ? 's' : ''}</span>}
          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{elapsed(mission.createdAt)}</span>
        </div>
      </div>

      {mission.status === 'awaiting_approval' && (
        <div style={{ marginTop: '8px', padding: '4px 8px', background: 'rgba(245,158,11,0.1)', borderRadius: 'var(--radius-sm)', fontSize: '11px', color: '#f59e0b' }}>
          Plan ready — tap to review &amp; approve
        </div>
      )}
      {mission.status === 'awaiting_info' && (
        <div style={{ marginTop: '8px', padding: '4px 8px', background: 'rgba(245,158,11,0.1)', borderRadius: 'var(--radius-sm)', fontSize: '11px', color: '#f59e0b' }}>
          Needs your input — tap to answer
        </div>
      )}
      {mission.status === 'paused' && (
        <div style={{ marginTop: '8px', padding: '4px 8px', background: 'rgba(59,130,246,0.1)', borderRadius: 'var(--radius-sm)', fontSize: '11px', color: '#3b82f6' }}>
          Paused — tap to resume
        </div>
      )}
    </div>
  )
}

function LogEntry({ entry }) {
  const isTool = entry.type === 'tool'
  return (
    <div style={{
      padding: isTool ? '3px 12px 3px 24px' : '6px 12px',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'baseline', gap: '8px',
      background: isTool ? 'var(--bg-base)' : undefined,
    }}>
      {!isTool && (
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
          {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      )}
      {!isTool && (
        <span style={{ fontSize: '11px', fontWeight: 600, color: agentColor(entry.agent), flexShrink: 0 }}>{entry.agent}</span>
      )}
      <span style={{
        fontSize: isTool ? '11px' : '12px', flex: 1,
        color: entry.type === 'error' ? '#ef4444' : entry.type === 'warn' ? '#f59e0b' : isTool ? 'var(--text-muted)' : 'var(--text-secondary)',
        fontFamily: isTool ? 'var(--font-mono)' : undefined,
      }}>{entry.message}</span>
    </div>
  )
}

function formatUSD(amount) {
  if (!amount) return '$0.00'
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  if (amount < 1)    return `$${amount.toFixed(3)}`
  return `$${amount.toFixed(2)}`
}

const BASIS_LABEL = {
  plan:   'from plan — coarse',
  scope:  'refined after scoping',
  design: 'refined after design',
}

function EstimateSummary({ estimate }) {
  const [open, setOpen] = useState(false)
  const total = estimate.total || { mid: 0, low: 0, high: 0 }
  const bandPct = Math.round((estimate.band || 0) * 100)
  const steps = estimate.byStep || []

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: steps.length ? 'pointer' : 'default' }}
      >
        <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', flex: 1 }}>
          Estimated Cost
        </div>
        <div style={{ display: 'flex', gap: '10px', fontSize: '12px', fontFamily: 'var(--font-mono)' }}>
          <span
            style={{ color: 'var(--accent)', fontWeight: 600 }}
            title="Projected from published list prices before/while the mission runs. This is NOT your actual bill — token counts are estimated, not measured."
          >
            ~{formatUSD(total.mid)}
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>{formatUSD(total.low)}–{formatUSD(total.high)}</span>
          <span style={{ color: 'var(--text-muted)' }}>±{bandPct}%</span>
        </div>
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px', fontStyle: 'italic' }}>
        Projection from list prices ({BASIS_LABEL[estimate.basis] || estimate.basis}) — an estimate, not actual billing. Narrows as scoping &amp; design complete.
      </div>
      {open && steps.length > 0 && (
        <div style={{ marginTop: '10px', paddingLeft: '4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {steps.map((s) => (
            <div key={s.stepId} style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ color: 'var(--text-primary)' }}>{s.agentName || s.agentId} <span style={{ color: 'var(--text-muted)' }}>· {s.model}</span></span>
              <span>
                {(s.inputTokens + s.outputTokens).toLocaleString()} tok · <span style={{ color: 'var(--accent)' }}>~{formatUSD(s.costUSD)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function StepRow({ step, index, missionId }) {
  const [expanded, setExpanded] = useState(false)
  const [deliverableOpen, setDeliverableOpen] = useState(false)
  const [deliverableContent, setDeliverableContent] = useState(null)
  const [loadingDeliverable, setLoadingDeliverable] = useState(false)

  const toggleDeliverable = async (e) => {
    e.stopPropagation()
    if (!deliverableOpen && !deliverableContent) {
      setLoadingDeliverable(true)
      try {
        const res = await api('GET', `/missions/${missionId}/deliverable/${step.agentId}`)
        setDeliverableContent(res.content || '')
      } catch {
        setDeliverableContent('(Could not load deliverable)')
      } finally {
        setLoadingDeliverable(false)
      }
    }
    setDeliverableOpen(o => !o)
    if (!expanded) setExpanded(true)
  }

  return (
    <div style={{ borderBottom: '1px solid var(--border)', background: step.status === 'in_progress' ? 'rgba(99,102,241,0.04)' : undefined }}>
      <div onClick={() => setExpanded(e => !e)} style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
        <div style={{
          width: '20px', height: '20px', borderRadius: '50%', flexShrink: 0,
          background: step.status === 'complete' ? 'rgba(34,197,94,0.15)' : step.status === 'in_progress' ? 'rgba(99,102,241,0.15)' : 'var(--bg-base)',
          border: `1px solid ${step.status === 'complete' ? '#22c55e' : step.status === 'in_progress' ? 'var(--accent)' : 'var(--border-bright)'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 600,
          color: step.status === 'complete' ? '#22c55e' : step.status === 'in_progress' ? 'var(--accent)' : 'var(--text-muted)',
        }}>
          {step.status === 'complete' ? <CheckCircle size={11} /> : step.status === 'in_progress' ? <Loader size={11} className="animate-spin" /> : step.status === 'failed' ? <XCircle size={11} color="#ef4444" /> : index + 1}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: agentColor(step.agentName), flexShrink: 0, display: 'inline-block' }} />
            {step.agentName}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>{step.subTask}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
          {step.status === 'complete' && step.result?.modelName && (
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{step.result.modelName}</span>
          )}
          {step.result?.deliverable && (
            <button
              onClick={toggleDeliverable}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                padding: '2px 7px', borderRadius: 'var(--radius-sm)',
                background: deliverableOpen ? 'rgba(99,102,241,0.12)' : 'var(--bg-base)',
                border: `1px solid ${deliverableOpen ? 'var(--accent)' : 'var(--border)'}`,
                color: deliverableOpen ? 'var(--accent)' : 'var(--text-muted)',
                fontSize: '10px', fontFamily: 'var(--font-mono)', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {loadingDeliverable ? <Loader size={9} className="animate-spin" /> : '📄'}
              {step.result.deliverable.name}
            </button>
          )}
          <ChevronRight size={12} color="var(--text-muted)" style={{ transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
        </div>
      </div>
      {expanded && (
        <div style={{ padding: '0 14px 12px 44px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {step.rationale && <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}><strong>Why:</strong> {step.rationale}</div>}
          {step.filesLikelyAffected?.length > 0 && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{step.filesLikelyAffected.join(', ')}</div>
          )}
          {step.result?.summary && <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{step.result.summary}</div>}
          {(step.fileChanges || []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
              {step.fileChanges.map((fc, j) => (
                <span key={j} style={{ fontSize: '10px', padding: '1px 6px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', color: fc.action === 'delete' ? '#ef4444' : '#22c55e' }}>
                  {fc.action === 'delete' ? '−' : '+'} {fc.path}
                </span>
              ))}
            </div>
          )}
          {/* Verification results (James Bond steps) */}
          {(step.result?.verificationResults || []).length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '4px' }}>
              {step.result.verificationResults.map((r, j) => (
                <span key={j} title={r.passed ? 'Passed' : r.output} style={{
                  fontSize: '10px', padding: '2px 7px',
                  background: r.passed ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  border: `1px solid ${r.passed ? '#22c55e' : '#ef4444'}`,
                  borderRadius: 'var(--radius-sm)',
                  color: r.passed ? '#22c55e' : '#ef4444',
                  fontFamily: 'var(--font-mono)', cursor: r.passed ? 'default' : 'help',
                }}>
                  {r.passed ? '✓' : '✗'} {r.script}
                </span>
              ))}
            </div>
          )}

          {/* Inline deliverable viewer */}
          {deliverableOpen && deliverableContent !== null && (
            <div style={{
              marginTop: '8px', padding: '14px 16px',
              background: 'var(--bg-base)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              borderLeft: '3px solid var(--accent)',
              maxHeight: '400px', overflowY: 'auto',
            }}>
              <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '10px' }}>
                {step.result.deliverable.name}
              </div>
              <SimpleMarkdown text={deliverableContent} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DetailPanel({ mission, onClose, onRefresh }) {
  const [answers, setAnswers] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [acting, setActing] = useState(null)
  const [selectedSteps, setSelectedSteps] = useState([])
  const [planEdits, setPlanEdits] = useState(null)   // null = not editing
  const [saving, setSaving] = useState(false)
  const logEndRef = useRef(null)

  const isEditing = mission.status === 'awaiting_approval'

  // Initialise editable plan whenever the mission changes and we're in review
  useEffect(() => {
    if (isEditing) {
      setPlanEdits({
        summary: mission.plan?.summary || '',
        steps: (mission.steps || []).map(s => ({ ...s })),
      })
    } else {
      setPlanEdits(null)
    }
  }, [mission.id, mission.status])

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [mission.log?.length])
  useEffect(() => { setAnswers({}); setSelectedSteps([]) }, [mission.id])

  const act = async (action, method = 'POST', body) => {
    setActing(action)
    try { await api(method, `/missions/${mission.id}/${action}`, body); await onRefresh() }
    finally { setActing(null) }
  }

  const handleAnswer = async () => {
    setSubmitting(true)
    try {
      const answersArr = Object.entries(answers).map(([id, answer]) => ({ id, answer }))
      await api('POST', `/missions/${mission.id}/answer`, { answers: answersArr })
      await onRefresh()
    } catch (e) {
      console.error('handleAnswer failed:', e)
    } finally {
      setSubmitting(false)
    }
  }

  const handleApprove = async () => {
    try {
      // Save any pending edits first, then approve
      if (planEdits) await savePlanEdits()
      const stepsToApprove = selectedSteps.length > 0 ? selectedSteps : (planEdits?.steps || mission.steps || []).map(s => s.id)
      setActing('approve')
      await api('POST', `/missions/${mission.id}/approve`, { stepIds: stepsToApprove })
      await onRefresh()
    } catch (e) {
      console.error('handleApprove failed:', e)
    } finally {
      setActing(null)
    }
  }

  const savePlanEdits = async () => {
    if (!planEdits) return
    setSaving(true)
    try {
      await api('PATCH', `/missions/${mission.id}/plan`, {
        summary: planEdits.summary,
        steps: planEdits.steps,
      })
      await onRefresh()
    } catch (e) {
      console.error('savePlanEdits failed:', e)
    } finally {
      setSaving(false)
    }
  }

  const toggleStepApproval = async () => {
    try {
      await api('PATCH', `/missions/${mission.id}/step-approval`, { stepApproval: !mission.stepApproval })
      await onRefresh()
    } catch (e) {
      console.error('toggleStepApproval failed:', e)
    }
  }

  // Plan edit helpers
  const updateStep = (idx, field, value) => {
    setPlanEdits(prev => {
      const steps = prev.steps.map((s, i) => i === idx ? { ...s, [field]: value } : s)
      return { ...prev, steps }
    })
  }
  const deleteStep = (idx) => {
    setPlanEdits(prev => ({ ...prev, steps: prev.steps.filter((_, i) => i !== idx) }))
  }
  const addStep = () => {
    const newStep = {
      id: `step-custom-${Date.now()}`,
      agentId: 'james-bond', agentName: 'James Bond',
      subTask: '', rationale: '', evidence: '',
      filesLikelyAffected: [], confidence: 'medium',
      assumptions: [], dependsOn: [], canParallel: false, status: 'pending',
    }
    setPlanEdits(prev => ({ ...prev, steps: [...prev.steps, newStep] }))
  }

  const status = mission.status

  // Determine if there are unsaved changes
  const hasUnsavedChanges = planEdits && (
    planEdits.summary !== (mission.plan?.summary || '') ||
    JSON.stringify(planEdits.steps.map(s => ({ id: s.id, subTask: s.subTask, rationale: s.rationale, agentId: s.agentId }))) !==
    JSON.stringify((mission.steps || []).map(s => ({ id: s.id, subTask: s.subTask, rationale: s.rationale, agentId: s.agentId })))
  )

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: '720px',
      background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', zIndex: 200,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
    }}>
      {/* Header */}
      <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', lineHeight: '1.4', marginBottom: '4px' }}>{mission.taskTitle}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              {STATUS_LABELS[status] || status}
            </span>
            {mission.plan?.riskLevel && (
              <span style={{ fontSize: '11px', color: mission.plan.riskLevel === 'high' ? '#ef4444' : mission.plan.riskLevel === 'medium' ? '#f59e0b' : '#22c55e' }}>
                {mission.plan.riskLevel} risk
              </span>
            )}
            {isEditing && (
              <span style={{ fontSize: '11px', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                <Pencil size={10} /> Editable
              </span>
            )}
          </div>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
      </div>

      {/* Action bar */}
      <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        {status === 'awaiting_approval' && (
          <>
            {hasUnsavedChanges && (
              <button className="btn btn-ghost btn-sm" onClick={savePlanEdits} disabled={saving}>
                {saving ? <Loader size={12} className="animate-spin" /> : <Save size={12} />}
                {saving ? 'Saving…' : 'Save edits'}
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={handleApprove} disabled={!!acting}>
              {acting === 'approve' ? <Loader size={12} className="animate-spin" /> : <Play size={12} />}
              {selectedSteps.length > 0 ? `Approve ${selectedSteps.length} step${selectedSteps.length !== 1 ? 's' : ''}` : 'Approve & Run'}
            </button>
          </>
        )}
        {status === 'executing' && (
          <button className="btn btn-ghost btn-sm" onClick={() => act('pause')} disabled={!!acting}>
            {acting === 'pause' ? <Loader size={12} className="animate-spin" /> : <Pause size={12} />}
            Pause
          </button>
        )}
        {status === 'executing' && (
          <button className="btn btn-ghost btn-sm" onClick={() => act('skip-step')} disabled={!!acting}>
            {acting === 'skip-step' ? <Loader size={12} className="animate-spin" /> : <SkipForward size={12} />}
            Skip Step
          </button>
        )}
        {status === 'paused' && (
          <button className="btn btn-primary btn-sm" onClick={() => act('resume')} disabled={!!acting}>
            {acting === 'resume' ? <Loader size={12} className="animate-spin" /> : <Play size={12} />}
            Resume
          </button>
        )}
        {status === 'failed' && (
          <button className="btn btn-primary btn-sm" onClick={() => act('retry')} disabled={!!acting}>
            {acting === 'retry' ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Retry
          </button>
        )}
        {['complete','failed','paused','cancelled'].includes(status) && (mission.fileChanges || []).length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => act('rollback')} disabled={!!acting} style={{ color: '#ef4444' }}>
            {acting === 'rollback' ? <Loader size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            Rollback
          </button>
        )}
        {!['complete','cancelled'].includes(status) && (
          <button className="btn btn-ghost btn-sm" onClick={() => act('cancel')} disabled={!!acting} style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
            {acting === 'cancel' ? <Loader size={12} className="animate-spin" /> : <X size={12} />}
            Cancel
          </button>
        )}
      </div>

      {/* Step-by-step toggle */}
      {status === 'awaiting_approval' && (
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button onClick={toggleStepApproval} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', padding: 0 }}>
            {mission.stepApproval ? <ToggleRight size={16} color="var(--accent)" /> : <ToggleLeft size={16} />}
            <span style={{ fontSize: '12px' }}>Step-by-step approval</span>
          </button>
          {mission.stepApproval && <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Pause after each step</span>}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Plan summary — editable during review */}
        {(isEditing ? planEdits?.summary !== undefined : mission.plan?.summary) && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-base)' }}>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Tech Spec Summary
            </div>
            {isEditing ? (
              <textarea
                value={planEdits?.summary || ''}
                onChange={e => setPlanEdits(prev => ({ ...prev, summary: e.target.value }))}
                rows={3}
                style={{
                  width: '100%', padding: '8px 10px', fontSize: '13px', resize: 'vertical',
                  background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', color: 'var(--text-primary)',
                  outline: 'none', fontFamily: 'inherit', lineHeight: '1.5', boxSizing: 'border-box',
                }}
              />
            ) : (
              <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{mission.plan?.summary}</div>
            )}
          </div>
        )}

        {/* Pending questions */}
        {status === 'awaiting_info' && (mission.pendingQuestions || []).filter(q => !q.answer).length > 0 && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(245,158,11,0.05)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Needs your input</div>
            {(mission.pendingQuestions || []).filter(q => !q.answer).map(q => (
              <div key={q.id} style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '13px', color: 'var(--text-primary)', marginBottom: '4px' }}>{q.question}</div>
                {q.context && <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>{q.context}</div>}
                <div style={{ display: 'flex', gap: '6px' }}>
                  <input
                    value={answers[q.id] || ''}
                    onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleAnswer()}
                    placeholder="Your answer…"
                    style={{ flex: 1, padding: '6px 10px', fontSize: '13px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', outline: 'none' }}
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleAnswer} disabled={submitting || !answers[q.id]}>
                    {submitting ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Steps — editable during review, read-only after */}
        {(isEditing ? (planEdits?.steps || []) : (mission.steps || [])).length > 0 && (
          <div style={{ borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: '8px 14px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Steps {!isEditing && status === 'awaiting_approval' && selectedSteps.length > 0 ? `(${selectedSteps.length} selected)` : `(${(isEditing ? planEdits?.steps : mission.steps || []).length})`}</span>
              {isEditing && (
                <button onClick={addStep} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent)', fontSize: '11px', padding: 0 }}>
                  <Plus size={12} /> Add step
                </button>
              )}
            </div>

            {(isEditing ? (planEdits?.steps || []) : (mission.steps || [])).map((step, i) => (
              isEditing ? (
                /* ── Editable step card ── */
                <div key={step.id} style={{
                  padding: '16px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex', flexDirection: 'column', gap: '12px',
                  background: 'var(--bg-elevated)'
                }}>
                  {/* Header row: agent selector + step number + delete */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {/* Color swatch */}
                    <div style={{
                      width: '28px', height: '28px', borderRadius: '50%',
                      background: agentColor(step.agentName), flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '12px', fontWeight: 700, color: '#fff'
                    }}>
                      {(step.agentName || '?')[0]}
                    </div>
                    {/* Agent selector — styled */}
                    <select
                      value={step.agentId}
                      onChange={e => {
                        const agentMap = {
                          'mallory': 'Mallory', 'quartermaster': 'Quartermaster',
                          'james-bond': 'James Bond', 'moneypenny': 'Moneypenny', 'felix': 'Felix'
                        }
                        updateStep(i, 'agentId', e.target.value)
                        updateStep(i, 'agentName', agentMap[e.target.value] || e.target.value)
                      }}
                      style={{
                        fontSize: '13px', fontWeight: 500,
                        background: 'var(--bg-base)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)', color: 'var(--text-primary)',
                        padding: '4px 8px', outline: 'none', cursor: 'pointer', flex: 1,
                      }}
                    >
                      <option value="mallory">Mallory — Scoping &amp; Discovery</option>
                      <option value="quartermaster">Quartermaster — Technical Design</option>
                      <option value="james-bond">James Bond — Implementation</option>
                      <option value="moneypenny">Moneypenny — QA &amp; Testing</option>
                      <option value="felix">Felix — Quick Task</option>
                    </select>
                    {/* Step label */}
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)', flexShrink: 0, fontWeight: 500 }}>
                      Step {i + 1}
                    </span>
                    {/* Delete */}
                    <button
                      onClick={() => deleteStep(i)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px', display: 'flex', alignItems: 'center', borderRadius: 'var(--radius-sm)' }}
                      title="Remove step"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* Sub-task */}
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
                      What to do
                    </label>
                    <textarea
                      value={step.subTask}
                      onChange={e => updateStep(i, 'subTask', e.target.value)}
                      placeholder="Describe exactly what this agent should accomplish…"
                      rows={4}
                      style={{
                        width: '100%', padding: '10px 12px', fontSize: '13px', resize: 'vertical',
                        background: 'var(--bg-base)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)', color: 'var(--text-primary)',
                        outline: 'none', fontFamily: 'inherit', lineHeight: '1.6', boxSizing: 'border-box',
                      }}
                    />
                  </div>

                  {/* Rationale */}
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: '6px' }}>
                      Why this step
                    </label>
                    <textarea
                      value={step.rationale}
                      onChange={e => updateStep(i, 'rationale', e.target.value)}
                      placeholder="Why is this step needed? What problem does it solve?"
                      rows={2}
                      style={{
                        width: '100%', padding: '8px 12px', fontSize: '12px', resize: 'vertical',
                        background: 'var(--bg-base)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)', color: 'var(--text-secondary)',
                        outline: 'none', fontFamily: 'inherit', lineHeight: '1.5', boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
              ) : (
                /* ── Read-only step row ── */
                <div key={step.id} style={{ position: 'relative' }}>
                  {status === 'awaiting_approval' && (
                    <input
                      type="checkbox"
                      checked={selectedSteps.includes(step.id)}
                      onChange={e => {
                        e.stopPropagation()
                        setSelectedSteps(prev => e.target.checked ? [...prev, step.id] : prev.filter(id => id !== step.id))
                      }}
                      style={{ position: 'absolute', left: '14px', top: '14px', zIndex: 1, width: '14px', height: '14px' }}
                    />
                  )}
                  <div style={{ paddingLeft: status === 'awaiting_approval' ? '36px' : '0' }}>
                    <StepRow step={step} index={i} missionId={mission.id} />
                  </div>
                </div>
              )
            ))}
          </div>
        )}

        {/* Estimated cost (projection, not actual billing) */}
        {mission.estimate && mission.estimate.total && (
          <EstimateSummary estimate={mission.estimate} />
        )}

        {/* File changes */}
        {(mission.fileChanges || []).length > 0 && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {mission.fileChanges.length} File{mission.fileChanges.length !== 1 ? 's' : ''} Changed
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {mission.fileChanges.map((fc, i) => (
                <span key={i} style={{ fontSize: '11px', padding: '2px 8px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontFamily: 'var(--font-mono)', color: fc.action === 'delete' ? '#ef4444' : '#22c55e' }}>
                  {fc.action === 'delete' ? '−' : '+'} {fc.path}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Activity log */}
        {(mission.log || []).length > 0 && (
          <div>
            <div style={{ padding: '8px 14px', fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid var(--border)' }}>Activity</div>
            {(mission.log || []).map((entry, i) => <LogEntry key={i} entry={entry} />)}
            <div ref={logEndRef} />
          </div>
        )}
      </div>
    </div>
  )
}

const CREATION_EXAMPLES = [
  'Add dark mode toggle to the settings page…',
  'Fix the bug where users can\'t upload files larger than 1MB…',
  'Refactor the auth service to use JWT refresh tokens…',
  'Add pagination to the user list API endpoint…',
  'Write unit tests for the payment processing module…',
  'Extract the email template logic into a reusable service…',
]

function CreationBar({ onCreated }) {
  const [description, setDescription] = useState('')
  const [stepApproval, setStepApproval] = useState(false)
  const [creating, setCreating] = useState(false)
  const [exampleIdx, setExampleIdx] = useState(0)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (focused || description) return
    const t = setInterval(() => setExampleIdx(i => (i + 1) % CREATION_EXAMPLES.length), 3000)
    return () => clearInterval(t)
  }, [focused, description])

  const handleStart = async () => {
    if (!description.trim()) return
    setCreating(true)
    await api('POST', '/missions', {
      taskDescription: description.trim(),
      stepApproval,
    })
    setDescription('')
    setCreating(false)
    onCreated?.()
  }

  const charCount = description.length

  return (
    <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ position: 'relative' }}>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleStart() }}
              placeholder={CREATION_EXAMPLES[exampleIdx]}
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', paddingBottom: '24px', fontSize: '13px', resize: 'none',
                background: 'var(--bg-elevated)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)', color: 'var(--text-primary)',
                outline: 'none', fontFamily: 'inherit', lineHeight: '1.5', boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
            />
            {charCount > 0 && (
              <span style={{
                position: 'absolute', bottom: '6px', right: '8px',
                fontSize: '10px', color: 'var(--text-muted)', pointerEvents: 'none',
              }}>
                {charCount}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button onClick={() => setStepApproval(v => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', color: stepApproval ? 'var(--accent)' : 'var(--text-muted)', padding: 0, fontSize: '12px', transition: 'color 0.15s' }}>
              {stepApproval ? <ToggleRight size={14} color="var(--accent)" /> : <ToggleLeft size={14} />}
              Step-by-step approval
            </button>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>⌘↵ to start</span>
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ height: '42px', paddingLeft: '20px', paddingRight: '20px', flexShrink: 0, alignSelf: 'flex-start', marginTop: '0' }}
          onClick={handleStart}
          disabled={creating || !description.trim()}
        >
          {creating ? <Loader size={14} className="animate-spin" /> : <Zap size={14} />}
          {creating ? 'Starting…' : 'Start'}
        </button>
      </div>
    </div>
  )
}

export default function MissionBoardPage() {
  const [missions, setMissions] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)

  const selectedMission = missions.find(m => m.id === selectedId) || null

  const fetchMissions = useCallback(async () => {
    try {
      const data = await api('GET', '/missions')
      setMissions(data.missions || [])
    } catch {}
  }, [])

  const fetchMission = useCallback(async (id) => {
    try {
      const data = await api('GET', `/missions/${id}`)
      if (data.mission) setMissions(prev => prev.map(m => m.id === id ? data.mission : m))
    } catch {}
  }, [])

  useEffect(() => {
    fetchMissions().then(() => setLoading(false))
    const socket = getSocket()
    const refresh = () => fetchMissions()
    const refreshOne = (data) => {
      const id = data?.id || data?.missionId
      if (id) fetchMission(id)
      else fetchMissions()
    }
    const events = ['mission:created','mission:updated','mission:plan_ready','mission:info_needed',
      'mission:step_start','mission:step_complete','mission:step_tool','mission:file_changed',
      'mission:complete','mission:error']
    events.forEach(e => socket.on(e, e === 'mission:created' ? refresh : refreshOne))
    return () => events.forEach(e => socket.off(e))
  }, [fetchMissions, fetchMission])

  const columns = COLUMNS.map(col => ({
    ...col,
    missions: missions.filter(m => col.statuses.includes(m.status)),
  }))

  const activeMissions = missions.filter(m => !['complete','failed','cancelled'].includes(m.status)).length

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
        <Loader size={20} className="animate-spin" />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Bot size={18} color="var(--accent)" />
        <h1 style={{ margin: 0, fontSize: '16px', fontWeight: 700 }}>Missions</h1>
        {activeMissions > 0 && (
          <span className="badge badge-accent" style={{ fontSize: '10px' }}>{activeMissions} active</span>
        )}
      </div>

      <div style={{ padding: '12px 20px 0' }}>
        <CreationBar onCreated={fetchMissions} />
      </div>

      <div style={{ flex: 1, overflowX: 'auto', overflowY: 'hidden', padding: '16px 20px', display: 'flex', gap: '12px' }}>
        {columns.map(col => (
          <div key={col.id} style={{ width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column', maxHeight: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', padding: '0 2px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: col.color, flexShrink: 0 }} />
              <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{col.label}</span>
              {col.missions.length > 0 && <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: 'auto' }}>{col.missions.length}</span>}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '2px' }}>
              {col.missions.length === 0 && (
                <div style={{ padding: '20px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>Empty</div>
              )}
              {col.missions.map(m => (
                <MissionCard
                  key={m.id} mission={m}
                  selected={m.id === selectedId}
                  onClick={() => setSelectedId(m.id === selectedId ? null : m.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {selectedMission && (
        <>
          <div onClick={() => setSelectedId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 199 }} />
          <DetailPanel
            mission={selectedMission}
            onClose={() => setSelectedId(null)}
            onRefresh={() => fetchMission(selectedMission.id)}
          />
        </>
      )}
    </div>
  )
}
