import React, { useEffect, useRef } from 'react'
import { Terminal as TerminalIcon, Loader } from 'lucide-react'

export default function Terminal({ logs = [], streaming = false, title = 'Execution Log', maxHeight = '280px' }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs.length])

  const TYPE_COLORS = {
    info:    'var(--text-secondary)',
    success: 'var(--green)',
    error:   'var(--red)',
    warn:    'var(--yellow)',
    stream:  'var(--text-code)',
    system:  'var(--accent-hover)'
  }

  const TYPE_PREFIXES = {
    info:    '  ',
    success: '✓ ',
    error:   '✗ ',
    warn:    '⚠ ',
    stream:  '  ',
    system:  '▶ '
  }

  return (
    <div style={{
      background: 'var(--bg-base)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
      fontFamily: 'var(--font-mono)'
    }}>
      {/* Title bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 12px',
        background: 'var(--bg-elevated)',
        borderBottom: '1px solid var(--border)',
        fontSize: '11px', color: 'var(--text-muted)'
      }}>
        {streaming ? (
          <Loader size={12} className="animate-spin" />
        ) : (
          <TerminalIcon size={12} />
        )}
        {title}
        {streaming && (
          <span style={{ marginLeft: 'auto', color: 'var(--green)', fontSize: '10px' }}>
            ● running
          </span>
        )}
      </div>

      {/* Log output */}
      <div style={{
        padding: '10px 12px',
        maxHeight,
        overflowY: 'auto',
        fontSize: '12px',
        lineHeight: '1.7'
      }}>
        {logs.length === 0 && (
          <span style={{ color: 'var(--text-muted)' }}>waiting for output...</span>
        )}
        {logs.map((log, i) => (
          <div key={i} style={{
            color: TYPE_COLORS[log.type] || TYPE_COLORS.info,
            wordBreak: 'break-word'
          }}>
            <span style={{ color: 'var(--text-muted)', userSelect: 'none', marginRight: '4px' }}>
              {TYPE_PREFIXES[log.type] || '  '}
            </span>
            {log.message}
          </div>
        ))}
        {streaming && (
          <span className="cursor-blink" style={{ color: 'var(--text-muted)' }} />
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
