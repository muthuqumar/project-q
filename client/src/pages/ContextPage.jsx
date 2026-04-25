import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Edit2, Save, X, FileText, Layers, Cpu, Users } from 'lucide-react'
import { useStore } from '../store'
import { useProject } from '../hooks/useProject'

const FILES = ['PRD', 'ARCHITECTURE', 'TECH_STACK', 'PERSONAS']
const FILE_LABELS = { PRD: 'PRD', ARCHITECTURE: 'Architecture', TECH_STACK: 'Tech Stack', PERSONAS: 'Personas' }
const FILE_ICON_COMPONENTS = { PRD: FileText, ARCHITECTURE: Layers, TECH_STACK: Cpu, PERSONAS: Users }

export default function ContextPage() {
  const { context, updateContextFile: storeUpdate } = useStore()
  const { updateContextFile } = useProject()
  const [activeFile, setActiveFile] = useState('PRD')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)

  const currentContent = context[`${activeFile}.md`] || ''

  function handleEdit() {
    setEditContent(currentContent)
    setEditing(true)
  }

  async function handleSave() {
    setSaving(true)
    try {
      await updateContextFile(`${activeFile}.md`, editContent)
      storeUpdate(`${activeFile}.md`, editContent)
      setEditing(false)
    } catch (err) {
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* File tabs */}
      <div style={{
        width: '180px', borderRight: '1px solid var(--border)',
        padding: '12px', background: 'var(--bg-surface)', flexShrink: 0
      }}>
        <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', padding: '0 6px' }}>
          Context Files
        </div>
        {FILES.map(file => {
          const hasContent = !!context[`${file}.md`]
          const Icon = FILE_ICON_COMPONENTS[file]
          return (
            <button
              key={file}
              onClick={() => { setActiveFile(file); setEditing(false) }}
              style={{
                width: '100%', textAlign: 'left', padding: '8px 10px',
                borderRadius: 'var(--radius)', fontSize: '12px',
                background: activeFile === file ? 'var(--bg-active)' : 'transparent',
                color: activeFile === file ? 'var(--text-primary)' : hasContent ? 'var(--text-secondary)' : 'var(--text-muted)',
                border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px',
                marginBottom: '2px'
              }}
            >
              <Icon size={13} strokeWidth={1.75} style={{ flexShrink: 0 }} />
              <span>{FILE_LABELS[file]}</span>
              {!hasContent && <span style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--text-muted)' }}>empty</span>}
            </button>
          )
        })}
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Toolbar */}
        <div style={{
          padding: '10px 20px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500 }}>
            {React.createElement(FILE_ICON_COMPONENTS[activeFile], { size: 14, strokeWidth: 1.75, color: 'var(--text-muted)' })}
            {FILE_LABELS[activeFile]}.md
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {editing ? (
              <>
                <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                  <Save size={13} /> {saving ? 'Saving...' : 'Save'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                  <X size={13} /> Cancel
                </button>
              </>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={handleEdit} disabled={!currentContent}>
                <Edit2 size={13} /> Edit
              </button>
            )}
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
          {!currentContent ? (
            <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
              <div style={{ marginBottom: '12px' }}>
                {React.createElement(FILE_ICON_COMPONENTS[activeFile], { size: 28, strokeWidth: 1.5, color: 'var(--text-muted)' })}
              </div>
              <div style={{ fontWeight: 500, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                {FILE_LABELS[activeFile]} not generated yet
              </div>
              <div style={{ fontSize: '12px' }}>
                Run the project initialization to generate context documents.
              </div>
            </div>
          ) : editing ? (
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              style={{
                width: '100%', height: '100%', minHeight: '400px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
                borderRadius: 'var(--radius)', padding: '16px',
                color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
                fontSize: '13px', lineHeight: 1.6, resize: 'none'
              }}
            />
          ) : (
            <div className="markdown-body" style={{ maxWidth: '720px' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentContent}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
