import React, { useState } from 'react'
import {
  DndContext, DragOverlay, closestCorners,
  KeyboardSensor, PointerSensor, useSensor, useSensors
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import Column from './Column'
import TaskCard from './TaskCard'
import TaskDetail from './TaskDetail'
import { useStore } from '../../store'
import { useProject } from '../../hooks/useProject'

const COLUMNS = [
  { id: 'backlog',     label: 'Backlog',      color: 'var(--text-muted)' },
  { id: 'todo',        label: 'To Do',        color: 'var(--blue)' },
  { id: 'in_progress', label: 'In Progress',  color: 'var(--accent-hover)' },
  { id: 'review',      label: 'Review',       color: 'var(--yellow)' },
  { id: 'done',        label: 'Done',         color: 'var(--green)' },
]

export default function Board({ workflowId }) {
  const { tasks, selectedTask, setSelectedTask, updateTask, getBoardTasks } = useStore()
  const { moveTask } = useProject()
  const [activeId, setActiveId] = useState(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const boardTasks = getBoardTasks()
  const filteredBoard = workflowId
    ? Object.fromEntries(
        Object.entries(boardTasks).map(([col, tasks]) => [
          col, tasks.filter(t => t.workflowId === workflowId)
        ])
      )
    : boardTasks

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null

  function handleDragStart({ active }) {
    setActiveId(active.id)
  }

  async function handleDragEnd({ active, over }) {
    setActiveId(null)
    if (!over || active.id === over.id) return

    const activeTask = tasks.find(t => t.id === active.id)
    if (!activeTask) return

    // Determine target column
    let targetColumn = over.id
    // If dropped on a task, use that task's column
    const overTask = tasks.find(t => t.id === over.id)
    if (overTask) targetColumn = overTask.column

    if (activeTask.column !== targetColumn) {
      // Optimistic update
      updateTask(active.id, { column: targetColumn })
      await moveTask(active.id, targetColumn)
    }
  }

  function handleDragOver({ active, over }) {
    if (!over) return
    const activeTask = tasks.find(t => t.id === active.id)
    const overTask = tasks.find(t => t.id === over.id)

    if (!activeTask) return

    const targetColumn = overTask ? overTask.column : over.id
    if (COLUMNS.some(c => c.id === targetColumn) && activeTask.column !== targetColumn) {
      updateTask(active.id, { column: targetColumn })
    }
  }

  const totalTasks = tasks.filter(t => !workflowId || t.workflowId === workflowId).length
  const doneTasks = (filteredBoard.done || []).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Board stats */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '16px',
        padding: '12px 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0, fontSize: '12px'
      }}>
        <span style={{ color: 'var(--text-muted)' }}>{totalTasks} tasks total</span>
        {totalTasks > 0 && (
          <>
            <div style={{ height: '12px', width: '1px', background: 'var(--border-bright)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                height: '6px', borderRadius: '3px', overflow: 'hidden',
                background: 'var(--bg-elevated)', width: '120px'
              }}>
                <div style={{
                  height: '100%', width: `${(doneTasks / totalTasks) * 100}%`,
                  background: 'var(--green)', transition: 'width 0.3s'
                }} />
              </div>
              <span style={{ color: 'var(--text-muted)' }}>
                {Math.round((doneTasks / totalTasks) * 100)}% complete
              </span>
            </div>
          </>
        )}
        {(filteredBoard.in_progress || []).length > 0 && (
          <>
            <div style={{ height: '12px', width: '1px', background: 'var(--border-bright)' }} />
            <span style={{ color: 'var(--accent-hover)' }}>
              {(filteredBoard.in_progress || []).length} running
            </span>
          </>
        )}
      </div>

      {/* Kanban columns */}
      <div style={{
        display: 'flex', gap: '12px', padding: '16px 20px',
        flex: 1, overflow: 'auto', alignItems: 'flex-start'
      }}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {COLUMNS.map(col => (
            <Column
              key={col.id}
              column={col}
              tasks={filteredBoard[col.id] || []}
              onTaskClick={setSelectedTask}
            />
          ))}

          <DragOverlay>
            {activeTask && (
              <TaskCard task={activeTask} isDragging />
            )}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Task detail panel */}
      {selectedTask && (
        <TaskDetail
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  )
}
