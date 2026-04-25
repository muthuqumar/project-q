import React, { useEffect } from 'react'
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react'
import { useStore } from '../../store'

const ICONS = {
  success: <CheckCircle size={15} color="var(--green)" />,
  error:   <AlertCircle size={15} color="var(--red)" />,
  info:    <Info size={15} color="var(--accent-hover)" />,
  warn:    <AlertCircle size={15} color="var(--yellow)" />,
}

export default function Notifications() {
  const { notifications, removeNotification } = useStore()

  // Auto-dismiss after 5 seconds
  useEffect(() => {
    const timers = notifications.map(n =>
      setTimeout(() => removeNotification(n.id), 5000)
    )
    return () => timers.forEach(clearTimeout)
  }, [notifications.length])

  if (notifications.length === 0) return null

  return (
    <div style={{
      position: 'fixed', bottom: '20px', right: '20px',
      display: 'flex', flexDirection: 'column', gap: '8px',
      zIndex: 999, maxWidth: '360px'
    }}>
      {notifications.slice(-4).map(n => (
        <div
          key={n.id}
          className="animate-fade-in"
          style={{
            display: 'flex', alignItems: 'flex-start', gap: '10px',
            padding: '12px 14px',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-bright)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow)',
            fontSize: '13px'
          }}
        >
          <div style={{ flexShrink: 0, marginTop: '1px' }}>
            {ICONS[n.type] || ICONS.info}
          </div>
          <div style={{ flex: 1, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            {n.message}
          </div>
          <button
            onClick={() => removeNotification(n.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: '0', flexShrink: 0
            }}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
