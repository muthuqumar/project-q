import React, { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import MissionBoardPage from './pages/MissionBoardPage'
import SettingsPage from './pages/SettingsPage'
import ContextPage from './pages/ContextPage'
import { useProject } from './hooks/useProject'
import { useSocket } from './hooks/useSocket'

export default function App() {
  const { loadProject } = useProject()
  useSocket()

  useEffect(() => {
    loadProject()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<MissionBoardPage />} />
          <Route path="context" element={<ContextPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
