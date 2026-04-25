import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import Notifications from './Common/Notifications'
import { useStore } from '../store'

export default function Layout() {
  const { sidebarOpen } = useStore()

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      background: 'var(--bg-base)'
    }}>
      <Sidebar />
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        marginLeft: sidebarOpen ? 'var(--sidebar-width)' : '0',
        transition: 'margin-left 0.2s ease'
      }}>
        <Header />
        <main style={{
          flex: 1,
          overflow: 'auto',
          background: 'var(--bg-base)'
        }}>
          <Outlet />
        </main>
      </div>
      <Notifications />
    </div>
  )
}
