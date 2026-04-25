import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import KanbanPage from './pages/KanbanPage'
import WorkflowsPage from './pages/WorkflowsPage'
import SettingsPage from './pages/SettingsPage'
import ContextPage from './pages/ContextPage'
import { useProject } from './hooks/useProject'
import { useSocket } from './hooks/useSocket'
import { useStore } from './store'

export default function App() {
  const { loadProject } = useProject()
  const { config } = useStore()

  useSocket() // init socket connection

  useEffect(() => {
    loadProject()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="kanban" element={<KanbanPage />} />
          <Route path="workflows" element={<WorkflowsPage />} />
          <Route path="workflows/:id" element={<WorkflowsPage />} />
          <Route path="context" element={<ContextPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
