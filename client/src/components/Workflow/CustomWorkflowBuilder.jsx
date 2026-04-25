import React, { useState } from 'react'
import { Plus, Trash2, ArrowUp, ArrowDown, Save } from 'lucide-react'
import { useProject } from '../../hooks/useProject'
import { useStore } from '../../store'

const STEP_TYPES = [
  { id: 'conversation', label: 'Conversation', desc: 'Interactive chat with AI' },
  { id: 'analysis',     label: 'Analysis',     desc: 'AI analyzes input and provides assessment' },
  { id: 'generation',   label: 'Generation',   desc: 'AI generates a document or artifact' },
  { id: 'execution',    label: 'Execution',     desc: 'AI writes and applies code changes' },
  { id: 'approval',     label: 'Approval',      desc: 'Pause for user review and approval' },
]

const ICONS = ['⚡', '🚀', '🔧', '🎯', '🛠️', '🔍', '📋', '✨', '🤖', '💡']

export default function CustomWorkflowBuilder({ onSave }) {
  const { createCustomWorkflow } = useProject()
  const { setWorkflows, workflows, addNotification } = useStore()
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    name: '',
    description: '',
    icon: '⚡',
    steps: [
      { id: 'step-1', name: 'Step 1', description: '', type: 'conversation', prompt: '' }
    ]
  })

  function updateForm(key, value) {
    setForm(f => ({ ...f, [key]: value }))
  }

  function addStep() {
    const id = `step-${form.steps.length + 1}`
    setForm(f => ({
      ...f,
      steps: [...f.steps, { id, name: `Step ${f.steps.length + 1}`, description: '', type: 'conversation', prompt: '' }]
    }))
  }

  function removeStep(idx) {
    setForm(f => ({ ...f, steps: f.steps.filter((_, i) => i !== idx) }))
  }

  function updateStep(idx, key, value) {
    setForm(f => ({
      ...f,
      steps: f.steps.map((s, i) => i === idx ? { ...s, [key]: value } : s)
    }))
  }

  function moveStep(idx, dir) {
    const newSteps = [...form.steps]
    const target = idx + dir
    if (target < 0 || target >= newSteps.length) return
    ;[newSteps[idx], newSteps[target]] = [newSteps[target], newSteps[idx]]
    setForm(f => ({ ...f, steps: newSteps }))
  }

  async function handleSave() {
    if (!form.name.trim()) return addNotification({ type: 'error', message: 'Workflow name is required' })
    if (form.steps.length === 0) return addNotification({ type: 'error', message: 'Add at least one step' })

    setSaving(true)
    try {
      const result = await createCustomWorkflow(form)
      setWorkflows([...workflows, { ...result.workflow, type: 'custom' }])
      addNotification({ type: 'success', message: `Workflow "${form.name}" created!` })
      onSave?.()
    } catch (err) {
      addNotification({ type: 'error', message: err.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: '24px', maxWidth: '720px', overflow: 'auto', height: '100%' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '4px' }}>Create Custom Workflow</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '13px', marginBottom: '24px' }}>
        Define a reusable workflow with custom steps, prompts, and AI behavior.
      </p>

      {/* Basic info */}
      <div className="card" style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Workflow Info</div>

        <div style={{ display: 'flex', gap: '12px' }}>
          {/* Icon picker */}
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>Icon</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', width: '120px' }}>
              {ICONS.map(icon => (
                <button
                  key={icon}
                  onClick={() => updateForm('icon', icon)}
                  style={{
                    width: '32px', height: '32px', borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${form.icon === icon ? 'var(--accent)' : 'var(--border)'}`,
                    background: form.icon === icon ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                    cursor: 'pointer', fontSize: '16px'
                  }}
                >{icon}</button>
              ))}
            </div>
          </div>

          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Name *</label>
              <input
                className="input-base"
                value={form.name}
                onChange={e => updateForm('name', e.target.value)}
                placeholder="e.g. code-review, bug-fix, refactor"
                style={{ fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Description</label>
              <input
                className="input-base"
                value={form.description}
                onChange={e => updateForm('description', e.target.value)}
                placeholder="What does this workflow do?"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Steps */}
      <div className="card" style={{ marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Steps</div>
          <button className="btn btn-ghost btn-sm" onClick={addStep}>
            <Plus size={13} /> Add step
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {form.steps.map((step, idx) => (
            <div key={step.id} style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '12px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                <div style={{
                  width: '20px', height: '20px', borderRadius: '50%',
                  background: 'var(--accent-dim)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '10px', fontWeight: 700, color: 'var(--accent-hover)', flexShrink: 0
                }}>
                  {idx + 1}
                </div>
                <input
                  className="input-base"
                  value={step.name}
                  onChange={e => updateStep(idx, 'name', e.target.value)}
                  placeholder="Step name"
                  style={{ flex: 1, fontSize: '13px', fontWeight: 500 }}
                />
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button className="btn btn-ghost btn-icon" onClick={() => moveStep(idx, -1)} disabled={idx === 0} style={{ padding: '4px' }}>
                    <ArrowUp size={13} />
                  </button>
                  <button className="btn btn-ghost btn-icon" onClick={() => moveStep(idx, 1)} disabled={idx === form.steps.length - 1} style={{ padding: '4px' }}>
                    <ArrowDown size={13} />
                  </button>
                  <button className="btn btn-ghost btn-icon" onClick={() => removeStep(idx)} style={{ padding: '4px', color: 'var(--red)' }}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginBottom: '8px' }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' }}>Type</label>
                  <select
                    className="input-base"
                    value={step.type}
                    onChange={e => updateStep(idx, 'type', e.target.value)}
                    style={{ fontSize: '12px' }}
                  >
                    {STEP_TYPES.map(t => <option key={t.id} value={t.id}>{t.label} — {t.desc}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '3px' }}>
                  AI Prompt — use {`{{input}}`} for user's initial input
                </label>
                <textarea
                  className="input-base"
                  value={step.prompt}
                  onChange={e => updateStep(idx, 'prompt', e.target.value)}
                  placeholder={`Instructions for the AI in this step. E.g. "Analyze {{input}} and identify potential issues..."`}
                  rows={3}
                  style={{ resize: 'vertical', fontSize: '12px', fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          <Save size={14} /> {saving ? 'Saving...' : 'Save Workflow'}
        </button>
        <button className="btn btn-ghost" onClick={() => onSave?.()}>Cancel</button>
      </div>
    </div>
  )
}
