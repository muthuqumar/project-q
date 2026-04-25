import React from 'react'
import Board from '../components/Kanban/Board'

export default function KanbanPage() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Board />
    </div>
  )
}
