import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Zap, Plus, Users, GitBranch, Layers, GitMerge, Bug, ChevronRight, Code2 } from 'lucide-react'
import { useStore } from '../store'

// Map lucide icon names (from registry) to components
const ICON_MAP = { Zap, GitBranch, Layers, GitMerge, Bug, Code2 }
function WorkflowIcon({ name, size = 18, color }) {
  const C = ICON_MAP[name]
  return C ? <C size={size} color={color} strokeWidth={1.75} /> : <Zap size={size} color={color} strokeWidth={1.75} />
}
import DevNow from '../components/Workflow/DevNow'
import MultiStepWorkflow from '../components/Workflow/MultiStepWorkflow'
import CustomWorkflowBuilder from '../components/Workflow/CustomWorkflowBuilder'
import CustomWorkflowRunner from '../components/Workflow/CustomWorkflowRunner'

// Workflows that use the DevNow (quick) runner
const DEV_NOW_WORKFLOWS = new Set(['dev-now', 'bug-fix'])

// Badge config by workflow id
const BADGE_CONFIG = {
  'dev-now':            { label: 'Fast',         color: 'var(--green)' },
  'feature-dev':        { label: 'Thorough',      color: 'var(--accent-hover)' },
  'greenfield':         { label: 'Full BMAD',     color: 'var(--purple)' },
  'brownfield-feature': { label: 'Integration',   color: 'var(--orange)' },
  'bug-fix':            { label: 'Investigation', color: 'var(--red)' },
}

export default function WorkflowsPage() {
  const { id } = useParams()
  const { workflows } = useStore()
  const navigate = useNavigate()

  // Route to specific workflow runners
  if (id) {
    if (DEV_NOW_WORKFLOWS.has(id)) return <DevNow workflowId={id} />
    if (id === 'new') return <CustomWorkflowBuilder onSave={() => navigate('/workflows')} />

    // Check if it's a known built-in multi-step workflow
    const builtinIds = ['feature-dev', 'greenfield', 'brownfield-feature']
    if (builtinIds.includes(id)) return <MultiStepWorkflow workflowId={id} />

    // Custom workflow
    const customWf = workflows.find(w => w.id === id && w.type === 'custom')
    if (customWf) return <CustomWorkflowRunner workflow={customWf} />
  }

  // Separate built-in from custom
  const builtins = workflows.filter(w => w.type === 'builtin')
  const custom   = workflows.filter(w => w.type === 'custom')

  return (
    <div style={{ padding: '32px', maxWidth: '960px' }}>

      {/* Header */}
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px' }}>Workflows</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
          BMAD-powered AI development pipelines. Each workflow activates the right specialist agents at every phase.
        </p>
      </div>

      {/* BMAD team callout */}
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
        borderRadius: 'var(--radius-lg)', padding: '14px 16px',
        display: 'flex', alignItems: 'center', gap: '12px',
        marginBottom: '28px', fontSize: '13px'
      }}>
        <Users size={16} color="var(--accent-hover)" style={{ flexShrink: 0 }} />
        <div>
          <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Your MI6 team: </span>
          <span style={{ color: 'var(--text-muted)' }}>
            Moneypenny (Analyst) · Mallory (PM) · Quartermaster (Architect) · James Bond (Developer) · Tanner (QA) · Felix (Scrum Master)
          </span>
        </div>
      </div>

      {/* Built-in workflows */}
      <div style={{ marginBottom: '32px' }}>
        <div style={{
          fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)',
          letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px'
        }}>
          Built-in
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '12px' }}>
          {builtins.map(wf => {
            const badge = BADGE_CONFIG[wf.id] || { label: 'Built-in', color: 'var(--text-muted)' }
            return (
              <WorkflowCard
                key={wf.id}
                icon={wf.icon}
                name={wf.name}
                description={wf.description}
                agent={wf.agent}
                steps={wf.steps?.map(s => s.name) || []}
                badge={badge.label}
                badgeColor={badge.color}
                onClick={() => navigate(`/workflows/${wf.id}`)}
              />
            )
          })}
        </div>
      </div>

      {/* Custom workflows */}
      <div>
        <div style={{
          fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)',
          letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        }}>
          Custom
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/workflows/new')}>
            <Plus size={13} /> New workflow
          </button>
        </div>
        {custom.length === 0 ? (
          <div
            style={{
              border: '1px dashed var(--border-bright)', borderRadius: 'var(--radius-lg)',
              padding: '32px', textAlign: 'center', cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: '13px'
            }}
            onClick={() => navigate('/workflows/new')}
          >
            <Plus size={20} style={{ marginBottom: '8px', opacity: 0.5 }} />
            <div>Create your first custom workflow</div>
            <div style={{ fontSize: '11px', marginTop: '4px' }}>Define steps, prompts, and execution logic</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: '12px' }}>
            {custom.map(wf => (
              <WorkflowCard
                key={wf.id}
                icon={wf.icon || 'Zap'}
                name={wf.name}
                description={wf.description}
                steps={wf.steps?.map(s => s.name) || []}
                badge="Custom"
                badgeColor="var(--orange)"
                onClick={() => navigate(`/workflows/${wf.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function WorkflowCard({ icon, name, description, agent, steps, badge, badgeColor, onClick }) {
  return (
    <div
      className="card"
      style={{
        cursor: 'pointer', transition: 'all 0.15s',
        borderColor: 'var(--border)', display: 'flex', flexDirection: 'column', gap: '12px'
      }}
      onClick={onClick}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = 'var(--border-bright)'
        e.currentTarget.style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.background = 'var(--bg-surface)'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '34px', height: '34px', borderRadius: 'var(--radius)',
            background: 'var(--bg-base)', border: '1px solid var(--border-bright)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
          }}>
            <WorkflowIcon name={icon} size={16} color="var(--text-secondary)" />
          </div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '14px', fontFamily: 'var(--font-mono)' }}>{name}</div>
            <span style={{ fontSize: '10px', color: badgeColor, background: `${badgeColor}20`, padding: '1px 6px', borderRadius: '100px' }}>
              {badge}
            </span>
          </div>
        </div>
      </div>

      <p style={{ fontSize: '12px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{description}</p>

      {agent && (
        <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
          <Users size={11} /> {agent}
        </div>
      )}

      {steps.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
          {steps.map((step, i) => (
            <React.Fragment key={step}>
              <span style={{
                fontSize: '10px', color: 'var(--text-secondary)',
                background: 'var(--bg-base)', border: '1px solid var(--border)',
                padding: '2px 7px', borderRadius: 'var(--radius-sm)'
              }}>{step}</span>
              {i < steps.length - 1 && <span style={{ color: 'var(--text-muted)', fontSize: '10px' }}>→</span>}
            </React.Fragment>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--accent-hover)', fontSize: '12px', fontWeight: 500, marginTop: 'auto' }}>
        Run workflow <ChevronRight size={13} />
      </div>
    </div>
  )
}
