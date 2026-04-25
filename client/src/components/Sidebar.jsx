import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Kanban, Zap, FileText, Settings,
  ChevronLeft, ChevronRight, GitBranch, GitMerge, Layers, Bug, Plus, Code2, Cpu
} from 'lucide-react'
import { useStore } from '../store'

const WF_ICON_MAP = { Zap, GitBranch, Layers, GitMerge, Bug, Code2 }
function WfIcon({ name, size = 14 }) {
  const C = WF_ICON_MAP[name]
  return C ? <C size={size} strokeWidth={1.75} /> : <Zap size={size} strokeWidth={1.75} />
}

const NAV_ITEMS = [
  { path: '/',          icon: LayoutDashboard, label: 'Dashboard',  exact: true },
  { path: '/kanban',    icon: Kanban,          label: 'Kanban',     badge: 'tasks' },
  { path: '/workflows', icon: Zap,             label: 'Workflows' },
  { path: '/context',   icon: FileText,        label: 'Context' },
  { path: '/settings',  icon: Settings,        label: 'Settings' },
]

export default function Sidebar() {
  const { sidebarOpen, setSidebarOpen, tasks, workflows, config } = useStore()
  const navigate = useNavigate()

  const activeTasks = tasks.filter(t => t.column === 'in_progress').length
  const todoTasks = tasks.filter(t => ['backlog', 'todo'].includes(t.column)).length

  if (!sidebarOpen) {
    return (
      <div style={{
        position: 'fixed', left: 0, top: 0, bottom: 0, width: '48px',
        background: 'var(--bg-surface)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0',
        zIndex: 100, gap: '4px'
      }}>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setSidebarOpen(true)}
          title="Expand sidebar"
          style={{ marginBottom: '8px' }}
        >
          <ChevronRight size={16} />
        </button>
        {NAV_ITEMS.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            title={label}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '36px', height: '36px', borderRadius: 'var(--radius)',
              color: isActive ? 'var(--accent-hover)' : 'var(--text-muted)',
              background: isActive ? 'var(--accent-dim)' : 'transparent',
              transition: 'all 0.15s'
            })}
          >
            <Icon size={18} />
          </NavLink>
        ))}
      </div>
    )
  }

  return (
    <div style={{
      position: 'fixed', left: 0, top: 0, bottom: 0,
      width: 'var(--sidebar-width)',
      background: 'var(--bg-surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column',
      zIndex: 100, overflow: 'hidden'
    }}>
      {/* Logo */}
      <div style={{
        padding: '16px 16px 12px',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: 'var(--radius-sm)',
            background: 'linear-gradient(135deg, var(--accent) 0%, var(--purple) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0
          }}>
            <Code2 size={16} color="white" strokeWidth={2.5} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '-0.02em' }}>
              project-q
            </div>
            {config?.projectDir && (
              <div style={{
                fontSize: '10px', color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {config.projectDir.split('/').pop() || 'project'}
              </div>
            )}
          </div>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={() => setSidebarOpen(false)} style={{ padding: '4px' }}>
          <ChevronLeft size={16} />
        </button>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: '8px', overflow: 'auto' }}>
        {/* Quick action */}
        <button
          className="btn btn-primary w-full"
          style={{ marginBottom: '12px', justifyContent: 'center', gap: '6px' }}
          onClick={() => navigate('/workflows')}
        >
          <Zap size={14} />
          Run Workflow
        </button>

        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '4px', padding: '0 8px' }}>
          Navigation
        </div>

        {NAV_ITEMS.map(({ path, icon: Icon, label, badge, exact }) => (
          <NavLink
            key={path}
            to={path}
            end={exact}
            style={({ isActive }) => ({
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 10px', borderRadius: 'var(--radius)', gap: '10px',
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isActive ? 'var(--bg-active)' : 'transparent',
              marginBottom: '2px', textDecoration: 'none',
              transition: 'all 0.12s', fontSize: '13px', fontWeight: isActive ? 500 : 400
            })}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon size={16} />
              {label}
            </div>
            {badge === 'tasks' && activeTasks > 0 && (
              <span className="badge badge-accent" style={{ fontSize: '10px', padding: '1px 6px' }}>
                {activeTasks} active
              </span>
            )}
            {badge === 'tasks' && activeTasks === 0 && todoTasks > 0 && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>{todoTasks}</span>
            )}
          </NavLink>
        ))}

        {/* Workflows section */}
        {workflows.length > 0 && (
          <div style={{ marginTop: '16px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '4px', padding: '0 8px' }}>
              Workflows
            </div>
            {workflows.map(wf => (
              <NavLink
                key={wf.id}
                to={`/workflows/${wf.id}`}
                style={({ isActive }) => ({
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 10px', borderRadius: 'var(--radius)',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  background: isActive ? 'var(--bg-active)' : 'transparent',
                  textDecoration: 'none', fontSize: '12px', marginBottom: '2px',
                  transition: 'all 0.12s'
                })}
              >
                <WfIcon name={wf.icon || 'Zap'} size={13} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {wf.name}
                </span>
                {wf.type === 'custom' && (
                  <span style={{ fontSize: '9px', color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>custom</span>
                )}
              </NavLink>
            ))}
          </div>
        )}
      </nav>

      {/* Footer */}
      <div style={{
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: '8px'
      }}>
        <GitBranch size={14} color="var(--text-muted)" />
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
          {config?.ai?.provider || 'no ai'} / {config?.ai?.model?.split('-').slice(-1)[0] || 'none'}
        </span>
      </div>
    </div>
  )
}
