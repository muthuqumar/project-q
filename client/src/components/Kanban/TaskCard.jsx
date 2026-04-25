import React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Zap, Loader, GitMerge } from 'lucide-react'

const PRIORITY_DOT = {
  high:   { color: 'var(--red)',    label: 'H' },
  medium: { color: 'var(--yellow)', label: 'M' },
  low:    { color: 'var(--blue)',   label: 'L' },
}

const AI_BADGE = {
  claude: { label: 'Claude', color: 'var(--accent-hover)' },
  openai: { label: 'GPT',    color: 'var(--green)' },
  gemini: { label: 'Gemini', color: 'var(--blue)' },
  ollama: { label: 'Local',  color: 'var(--purple)' },
}

export default function TaskCard({ task, onClick, isDragging = false }) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging: isSortableDragging
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortableDragging ? 0.3 : 1,
  }

  const priority = PRIORITY_DOT[task.priority] || PRIORITY_DOT.medium
  const aiInfo = AI_BADGE[task.assignedTo] || AI_BADGE.claude
  const isRunning = task.column === 'in_progress'

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        background: isDragging ? 'var(--bg-active)' : 'var(--bg-elevated)',
        border: `1px solid ${isRunning ? 'var(--accent-dim)' : 'var(--border)'}`,
        borderRadius: 'var(--radius)',
        padding: '10px 10px 8px',
        cursor: 'pointer',
        boxShadow: isDragging ? 'var(--shadow)' : isRunning ? '0 0 0 1px var(--accent-dim)' : 'none',
        transition: 'all 0.12s',
        userSelect: 'none',
        display: 'flex', flexDirection: 'column', gap: '6px'
      }}
      onClick={onClick}
    >
      {/* Top row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
        <div
          {...attributes}
          {...listeners}
          style={{
            cursor: 'grab', color: 'var(--text-muted)', marginTop: '1px',
            flexShrink: 0, padding: '1px'
          }}
          onClick={e => e.stopPropagation()}
        >
          <GripVertical size={12} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)',
            lineHeight: 1.4, wordBreak: 'break-word',
            display: 'flex', alignItems: 'flex-start', gap: '6px'
          }}>
            {isRunning && <Loader size={11} className="animate-spin" style={{ flexShrink: 0, marginTop: '2px', color: 'var(--accent-hover)' }} />}
            {task.title}
          </div>
        </div>
      </div>

      {/* Description preview */}
      {task.description && (
        <div style={{
          fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4,
          overflow: 'hidden', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
        }}>
          {task.description}
        </div>
      )}

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {/* Priority */}
          <div style={{
            width: '6px', height: '6px', borderRadius: '50%',
            background: priority.color, flexShrink: 0
          }} title={`Priority: ${task.priority}`} />

          {/* Tags */}
          {task.tags?.slice(0, 2).map(tag => (
            <span key={tag} style={{
              fontSize: '9px', color: 'var(--text-muted)',
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              padding: '1px 5px', borderRadius: '100px'
            }}>{tag}</span>
          ))}

          {/* Dependencies indicator */}
          {task.dependencies?.length > 0 && (
            <GitMerge size={10} color="var(--text-muted)" title={`${task.dependencies.length} dependencies`} />
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {/* Parallel indicator */}
          {task.executionType === 'parallel' && (
            <span style={{ fontSize: '9px', color: 'var(--purple)', display: 'flex', alignItems: 'center', gap: '2px' }}>
              <Zap size={9} />
            </span>
          )}
          {/* AI badge */}
          <span style={{
            fontSize: '9px', color: aiInfo.color,
            background: 'var(--bg-surface)', border: `1px solid ${aiInfo.color}30`,
            padding: '1px 5px', borderRadius: '100px', fontFamily: 'var(--font-mono)'
          }}>{aiInfo.label}</span>
        </div>
      </div>
    </div>
  )
}
