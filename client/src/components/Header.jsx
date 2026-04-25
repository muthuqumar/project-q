import React from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Zap, RefreshCw, Bell } from 'lucide-react'
import { useStore } from '../store'
import { useProject } from '../hooks/useProject'

const TITLES = {
  '/':          { title: 'Dashboard',  sub: 'Project overview' },
  '/kanban':    { title: 'Kanban',     sub: 'Task board' },
  '/workflows': { title: 'Workflows',  sub: 'Run AI workflows' },
  '/context':   { title: 'Context',    sub: 'Project documentation' },
  '/settings':  { title: 'Settings',   sub: 'AI providers & config' },
}

export default function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const { notifications, config, currentAI } = useStore()
  const { loadProject } = useProject()

  // Find best matching title
  let info = TITLES[location.pathname]
  if (!info) {
    const match = Object.entries(TITLES).find(([k]) => location.pathname.startsWith(k) && k !== '/')
    info = match?.[1] || { title: 'project-q', sub: '' }
  }

  const unread = notifications.filter(n => !n.read).length

  return (
    <header style={{
      height: 'var(--header-height)',
      background: 'var(--bg-surface)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 20px', flexShrink: 0
    }}>
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '15px', fontWeight: 600, lineHeight: 1 }}>{info.title}</h1>
          {info.sub && (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{info.sub}</div>
          )}
        </div>
      </div>

      {/* Right controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {/* AI indicator */}
        {config?.ai && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '4px 10px', borderRadius: '100px',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
            fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer'
          }} onClick={() => navigate('/settings')}>
            <div style={{
              width: '6px', height: '6px', borderRadius: '50%',
              background: 'var(--green)', boxShadow: '0 0 6px var(--green)'
            }} />
            {currentAI?.provider} / {currentAI?.model?.split('-').slice(-1)[0]}
          </div>
        )}

        <button
          className="btn btn-ghost btn-icon"
          onClick={loadProject}
          title="Refresh"
        >
          <RefreshCw size={15} />
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={() => navigate('/workflows')}
          title="Run workflow"
          style={{ color: 'var(--accent-hover)', borderColor: 'var(--accent-dim)', background: 'var(--accent-dim)' }}
        >
          <Zap size={15} />
        </button>
      </div>
    </header>
  )
}
