import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, GitBranch, CheckCircle, Clock, AlertCircle, FileText, Settings, LayoutDashboard, ChevronRight, Loader } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore } from '../store'
import InitPage from './InitPage'

export default function Dashboard() {
  const { tasks, config, context, initialized } = useStore()
  const navigate = useNavigate()

  const stats = {
    total: tasks.length,
    active: tasks.filter(t => t.column === 'in_progress').length,
    done: tasks.filter(t => t.column === 'done').length,
    todo: tasks.filter(t => ['backlog', 'todo'].includes(t.column)).length
  }

  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    .slice(0, 5)

  if (!initialized) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', flexDirection: 'column', gap: '12px',
        color: 'var(--text-muted)'
      }}>
        <Loader size={20} className="animate-spin" />
        <div style={{ fontSize: '13px' }}>Loading project...</div>
      </div>
    )
  }

  // Not initialized — show the onboarding wizard
  if (!config) {
    return <InitPage onComplete={() => window.location.reload()} />
  }

  return (
    <div style={{ padding: '24px', height: '100%', overflow: 'auto' }}>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
        <StatCard icon={<Clock size={16} />} label="In Progress" value={stats.active} color="var(--accent-hover)" onClick={() => navigate('/kanban')} />
        <StatCard icon={<AlertCircle size={16} />} label="To Do" value={stats.todo} color="var(--blue)" onClick={() => navigate('/kanban')} />
        <StatCard icon={<CheckCircle size={16} />} label="Done" value={stats.done} color="var(--green)" onClick={() => navigate('/kanban')} />
        <StatCard icon={<GitBranch size={16} />} label="Total Tasks" value={stats.total} color="var(--text-secondary)" onClick={() => navigate('/kanban')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '16px' }}>
        {/* Left column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Quick actions */}
          <div className="card">
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
              Quick Actions
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <QuickAction
                icon={Zap}
                title="dev-now"
                desc="Implement a quick change"
                onClick={() => navigate('/workflows/dev-now')}
                accent
              />
              <QuickAction
                icon={GitBranch}
                title="feature-dev"
                desc="Build a full feature"
                onClick={() => navigate('/workflows/feature-dev')}
              />
              <QuickAction
                icon={LayoutDashboard}
                title="Kanban"
                desc="View and manage tasks"
                onClick={() => navigate('/kanban')}
              />
              <QuickAction
                icon={Settings}
                title="Settings"
                desc="Configure AI providers"
                onClick={() => navigate('/settings')}
              />
            </div>
          </div>

          {/* Recent tasks */}
          {recentTasks.length > 0 && (
            <div className="card">
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
                Recent Tasks
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {recentTasks.map(task => (
                  <div key={task.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 10px', borderRadius: 'var(--radius)',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                    fontSize: '12px', cursor: 'pointer'
                  }} onClick={() => navigate('/kanban')}>
                    <span style={{ color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.title}
                    </span>
                    <ColumnBadge column={task.column} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Project info */}
          <div className="card">
            <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
              Project
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
              <InfoRow label="AI" value={`${config?.ai?.provider} / ${config?.ai?.model?.split('-').slice(-1)[0]}`} />
              <InfoRow label="Directory" value={config?.projectDir?.split('/').pop()} mono />
              {context?.PRD && (
                <InfoRow label="Context" value="PRD, Architecture, Tech Stack" />
              )}
            </div>
          </div>

          {/* PRD excerpt */}
          {context?.PRD && (
            <div className="card" style={{ cursor: 'pointer' }} onClick={() => navigate('/context')}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <FileText size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                  PRD
                </div>
                <span style={{ fontSize: '10px', color: 'var(--accent-hover)' }}>View all →</span>
              </div>
              <div className="markdown-body" style={{ fontSize: '11px', maxHeight: '140px', overflow: 'hidden' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{(context.PRD || '').slice(0, 400)}</ReactMarkdown>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, color, onClick }) {
  return (
    <div className="card" style={{ cursor: 'pointer', transition: 'all 0.12s' }} onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-bright)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <span style={{ color }}>{icon}</span>
        <span style={{ fontSize: '22px', fontWeight: 700, color }}>{value}</span>
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{label}</div>
    </div>
  )
}

function QuickAction({ icon: Icon, title, desc, onClick, accent }) {
  return (
    <div
      style={{
        padding: '12px', borderRadius: 'var(--radius)', cursor: 'pointer',
        background: accent ? 'var(--accent-dim)' : 'var(--bg-elevated)',
        border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
        transition: 'all 0.12s', display: 'flex', flexDirection: 'column', gap: '4px'
      }}
      onClick={onClick}
      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-bright)'}
      onMouseLeave={e => e.currentTarget.style.borderColor = accent ? 'var(--accent)' : 'var(--border)'}
    >
      <Icon size={16} color={accent ? 'var(--accent-hover)' : 'var(--text-secondary)'} strokeWidth={1.75} style={{ marginBottom: '4px' }} />
      <div style={{ fontSize: '12px', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{title}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{desc}</div>
    </div>
  )
}

function ColumnBadge({ column }) {
  const config = {
    backlog:     { label: 'Backlog',     bg: 'var(--bg-base)',      color: 'var(--text-muted)' },
    todo:        { label: 'To Do',       bg: 'var(--blue-dim)',     color: 'var(--blue)' },
    in_progress: { label: 'In Progress', bg: 'var(--accent-dim)',   color: 'var(--accent-hover)' },
    review:      { label: 'Review',      bg: 'var(--yellow-dim)',   color: 'var(--yellow)' },
    done:        { label: 'Done',        bg: 'var(--green-dim)',    color: 'var(--green)' },
  }[column] || { label: column, bg: 'var(--bg-elevated)', color: 'var(--text-muted)' }

  return (
    <span style={{
      fontSize: '10px', padding: '2px 7px', borderRadius: '100px',
      background: config.bg, color: config.color, flexShrink: 0
    }}>
      {config.label}
    </span>
  )
}

function InfoRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span style={{
        color: 'var(--text-secondary)',
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        fontSize: mono ? '11px' : '12px',
        maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
      }}>{value}</span>
    </div>
  )
}
