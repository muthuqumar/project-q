import React, { useState } from 'react'
import { X, Tag, GitMerge, Zap, Trash2, ArrowRight } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useStore } from '../../store'
import { useProject } from '../../hooks/useProject'

const COLUMNS = ['backlog', 'todo', 'in_progress', 'review', 'done']
const COLUMN_LABELS = { backlog: 'Backlog', todo: 'To Do', in_progress: 'In Progress', review: 'Review', done: 'Done' }
const AI_PROVIDERS = ['claude', 'openai', 'gemini', 'ollama']
const PRIORITIES = ['high', 'medium', 'low']
const PRIORITY_COLORS = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--blue)' }

export default function TaskDetail({ task, onClose }) {
  const { updateTask: storeUpdateTask, removeTask } = useStore()
  const { updateTask, deleteTask, moveTask } = useProject()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ ...task })

  async function handleSave() {
    await updateTask(task.id, form)
    storeUpdateTask(task.id, form)
    setEditing(false)
  }

  async function handleDelete() {
    if (!confirm('Delete this task?')) return
    await deleteTask(task.id)
    removeTask(task.id)
    onClose()
  }

  async function handleMove(column) {
    await moveTask(task.id, column)
    storeUpdateTask(task.id, { column })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-end'
    }}>
      {/* Backdrop */}
      <div
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div style={{
        position: 'relative', zIndex: 1,
        width: '400px', height: '100vh',
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column',
        boxShadow: 'var(--shadow-lg)',
        animation: 'slideIn 0.2s ease-out'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              <input
                className="input-base"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                style={{ fontSize: '14px', fontWeight: 600 }}
              />
            ) : (
              <h3 style={{ fontSize: '14px', fontWeight: 600, lineHeight: 1.3 }}>{task.title}</h3>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', flexShrink: 0, marginLeft: '12px' }}>
            {editing ? (
              <>
                <button className="btn btn-primary btn-sm" onClick={handleSave}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>Edit</button>
            )}
            <button className="btn btn-ghost btn-icon" onClick={onClose} style={{ padding: '6px' }}>
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Status / Move */}
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Status</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {COLUMNS.map(col => (
                <button
                  key={col}
                  className={`btn btn-sm ${task.column === col ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => handleMove(col)}
                >
                  {COLUMN_LABELS[col]}
                </button>
              ))}
            </div>
          </div>

          {/* Priority + Assigned To */}
          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Priority</div>
              {editing ? (
                <select
                  className="input-base"
                  value={form.priority}
                  onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                  style={{ fontSize: '12px' }}
                >
                  {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: PRIORITY_COLORS[task.priority] }} />
                  <span style={{ fontSize: '13px' }}>{task.priority}</span>
                </div>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>AI Agent</div>
              {editing ? (
                <select
                  className="input-base"
                  value={form.assignedTo}
                  onChange={e => setForm(f => ({ ...f, assignedTo: e.target.value }))}
                  style={{ fontSize: '12px' }}
                >
                  {AI_PROVIDERS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              ) : (
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{task.assignedTo}</span>
              )}
            </div>
          </div>

          {/* Execution */}
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Execution</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '12px', color: 'var(--text-secondary)' }}>
              <span>Order: <strong style={{ color: 'var(--text-primary)' }}>{task.executionOrder ?? '—'}</strong></span>
              <div style={{ height: '12px', width: '1px', background: 'var(--border-bright)' }} />
              <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {task.executionType === 'parallel' ? <><Zap size={11} color="var(--purple)" /> parallel</> : <><ArrowRight size={11} color="var(--text-muted)" /> sequential</>}
              </span>
            </div>
          </div>

          {/* Description */}
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Description</div>
            {editing ? (
              <textarea
                className="input-base"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                rows={5}
                style={{ resize: 'vertical', fontSize: '12px', lineHeight: 1.6 }}
              />
            ) : (
              <div className="markdown-body" style={{ fontSize: '12px' }}>
                <ReactMarkdown>{task.description || '*No description*'}</ReactMarkdown>
              </div>
            )}
          </div>

          {/* Tags */}
          {task.tags?.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Tags</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {task.tags.map(tag => (
                  <span key={tag} className="badge" style={{
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
                    color: 'var(--text-secondary)', fontSize: '11px'
                  }}>
                    <Tag size={9} style={{ marginRight: '3px' }} />{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Execution log */}
          {task.logs?.length > 0 && (
            <div>
              <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Execution Log</div>
              <div style={{
                background: 'var(--bg-base)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '8px 10px',
                maxHeight: '150px', overflowY: 'auto',
                fontFamily: 'var(--font-mono)', fontSize: '11px', lineHeight: 1.6,
                color: 'var(--text-secondary)'
              }}>
                {task.logs.map((log, i) => (
                  <div key={i}>{log.message}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 16px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', flexShrink: 0
        }}>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>
            <Trash2 size={13} /> Delete
          </button>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            {new Date(task.createdAt).toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  )
}
