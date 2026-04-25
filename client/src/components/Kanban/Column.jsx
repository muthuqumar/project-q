import React from 'react'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import TaskCard from './TaskCard'

export default function Column({ column, tasks, onTaskClick }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      minWidth: '240px', maxWidth: '280px', flex: '1',
      background: isOver ? 'var(--bg-elevated)' : 'var(--bg-surface)',
      borderRadius: 'var(--radius-lg)',
      border: `1px solid ${isOver ? 'var(--border-bright)' : 'var(--border)'}`,
      transition: 'all 0.15s',
      maxHeight: 'calc(100vh - 160px)'
    }}>
      {/* Column header */}
      <div style={{
        padding: '12px 14px 10px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid var(--border)', flexShrink: 0
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '8px', height: '8px', borderRadius: '50%',
            background: column.color, flexShrink: 0
          }} />
          <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {column.label}
          </span>
        </div>
        <span style={{
          fontSize: '11px', color: 'var(--text-muted)',
          background: 'var(--bg-elevated)', borderRadius: '100px',
          padding: '1px 7px', border: '1px solid var(--border)'
        }}>
          {tasks.length}
        </span>
      </div>

      {/* Tasks */}
      <div
        ref={setNodeRef}
        style={{
          padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px',
          overflowY: 'auto', flex: 1,
          minHeight: '60px'
        }}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '60px', color: 'var(--text-muted)', fontSize: '12px',
            border: '1px dashed var(--border)', borderRadius: 'var(--radius)',
          }}>
            Drop tasks here
          </div>
        )}
      </div>
    </div>
  )
}
