import React, { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Edit2, Save, X, FileText, Layers, Cpu, Users, RefreshCw, Loader, CheckCircle, AlertCircle } from 'lucide-react'
import { useStore } from '../store'
import { useProject } from '../hooks/useProject'
import { useSocket } from '../hooks/useSocket'

const FILES = ['PRD', 'ARCHITECTURE', 'TECH_STACK', 'PERSONAS']
const FILE_LABELS = { PRD: 'PRD', ARCHITECTURE: 'Architecture', TECH_STACK: 'Tech Stack', PERSONAS: 'Personas' }
const FILE_ICON_COMPONENTS = { PRD: FileText, ARCHITECTURE: Layers, TECH_STACK: Cpu, PERSONAS: Users }

export default function ContextPage() {
  const { context, updateContextFile: storeUpdate, config } = useStore()
  const { updateContextFile, scanAndGenerateContext } = useProject()
  const { subscribeToInit } = useSocket()

  const [activeFile, setActiveFile]       = useState('PRD')
  const [editing, setEditing]             = useState(false)
  const [editContent, setEditContent]     = useState('')
  const [saving, setSaving]               = useState(false)
  const [scanning, setScanning]           = useState(false)
  const [scanProgress, setScanProgress]   = useState([])   // array of { step, message }
  const [scanError, setScanError]         = useState(null)
  const [scanDone, setScanDone]           = useState(false)
  const unsubRef = useRef(null)
  const logEndRef = useRef(null)

  const currentContent = context[`${activeFile}.md`] || ''
  const hasAnyContext   = FILES.some(f => !!context[`${f}.md`])

  // Auto-scroll progress log
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [scanProgress])

  // Clean up init subscription on unmount
  useEffect(() => () => unsubRef.current?.(), [])

  // ── Edit handlers ────────────────────────────────────────────────────────────

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

  // ── Scan handler ─────────────────────────────────────────────────────────────

  async function handleScan() {
    setScanning(true)
    setScanProgress([])
    setScanError(null)
    setScanDone(false)

    // Subscribe to init socket events for live progress
    unsubRef.current?.()
    unsubRef.current = subscribeToInit({
      onProgress: ({ step, message }) => {
        setScanProgress(p => [...p, { step, message, type: 'progress' }])
      },
      onComplete: ({ message }) => {
        setScanProgress(p => [...p, { step: 'done', message, type: 'success' }])
        setScanDone(true)
        setScanning(false)
      },
      onError: ({ message }) => {
        setScanError(message)
        setScanProgress(p => [...p, { step: 'error', message, type: 'error' }])
        setScanning(false)
      },
    })

    try {
      await scanAndGenerateContext(config?.ai)
      // scanAndGenerateContext reloads context into the store when complete
    } catch (err) {
      setScanError(err.message)
      setScanning(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', position: 'relative' }}>

      {/* Scan progress overlay */}
      {(scanning || scanDone || scanError) && (
        <ScanOverlay
          progress={scanProgress}
          scanning={scanning}
          done={scanDone}
          error={scanError}
          logEndRef={logEndRef}
          onDismiss={() => { setScanDone(false); setScanError(null); setScanProgress([]) }}
          onRescan={handleScan}
        />
      )}

      {/* File tabs */}
      <div style={{
        width: '180px', borderRight: '1px solid var(--border)',
        padding: '12px', background: 'var(--bg-surface)', flexShrink: 0,
        display: 'flex', flexDirection: 'column',
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
                marginBottom: '2px',
              }}
            >
              <Icon size={13} strokeWidth={1.75} style={{ flexShrink: 0 }} />
              <span>{FILE_LABELS[file]}</span>
              {!hasContent
                ? <span style={{ marginLeft: 'auto', fontSize: '9px', color: 'var(--text-muted)' }}>empty</span>
                : <span style={{ marginLeft: 'auto', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)', flexShrink: 0 }} />
              }
            </button>
          )
        })}

        {/* Scan button in sidebar */}
        <div style={{ marginTop: 'auto', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={handleScan}
            disabled={scanning}
            style={{ width: '100%', justifyContent: 'center', gap: '6px', fontSize: '11px' }}
            title="Scan the project directory and regenerate all context files"
          >
            {scanning
              ? <><Loader size={11} className="animate-spin" /> Scanning…</>
              : <><RefreshCw size={11} /> {hasAnyContext ? 'Re-scan project' : 'Scan project'}</>
            }
          </button>
        </div>
      </div>

      {/* Content pane */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Toolbar */}
        <div style={{
          padding: '10px 20px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-surface)', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 500 }}>
            {React.createElement(FILE_ICON_COMPONENTS[activeFile], { size: 14, strokeWidth: 1.75, color: 'var(--text-muted)' })}
            {FILE_LABELS[activeFile]}.md
            {!currentContent && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: '100px', padding: '1px 7px' }}>
                not generated
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
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
              <>
                <button className="btn btn-ghost btn-sm" onClick={handleEdit} disabled={!currentContent}>
                  <Edit2 size={13} /> Edit
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={handleScan}
                  disabled={scanning}
                  title="Scan the project and regenerate all context files"
                >
                  {scanning
                    ? <><Loader size={12} className="animate-spin" /> Scanning…</>
                    : <><RefreshCw size={12} /> {hasAnyContext ? 'Re-scan' : 'Scan & generate'}</>
                  }
                </button>
              </>
            )}
          </div>
        </div>

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
          {!currentContent ? (
            <EmptyFileState
              file={activeFile}
              hasAnyContext={hasAnyContext}
              onScan={handleScan}
              scanning={scanning}
            />
          ) : editing ? (
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              style={{
                width: '100%', height: '100%', minHeight: '400px',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-bright)',
                borderRadius: 'var(--radius)', padding: '16px',
                color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
                fontSize: '13px', lineHeight: 1.6, resize: 'none',
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

// ── Scan progress overlay ─────────────────────────────────────────────────────

function ScanOverlay({ progress, scanning, done, error, logEndRef, onDismiss, onRescan }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 20,
      background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '28px 32px',
        width: '480px', maxWidth: '90vw',
        display: 'flex', flexDirection: 'column', gap: '16px',
        boxShadow: '0 16px 48px rgba(0,0,0,0.4)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {scanning && <Loader size={16} className="animate-spin" color="var(--accent)" />}
          {done    && <CheckCircle size={16} color="var(--green)" />}
          {error   && <AlertCircle size={16} color="var(--red)" />}
          <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }}>
            {scanning ? 'Scanning codebase…' : done ? 'Context generated' : 'Scan failed'}
          </span>
        </div>

        {/* Progress log */}
        <div style={{
          background: 'var(--bg-base)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', padding: '10px 12px',
          maxHeight: '220px', overflow: 'auto', fontFamily: 'var(--font-mono)',
          fontSize: '11px', lineHeight: 1.6,
        }}>
          {progress.length === 0 && (
            <span style={{ color: 'var(--text-muted)' }}>Starting scan…</span>
          )}
          {progress.map((entry, i) => (
            <div
              key={i}
              style={{
                color: entry.type === 'error'   ? 'var(--red)'
                     : entry.type === 'success' ? 'var(--green)'
                     : 'var(--text-secondary)',
              }}
            >
              {entry.type === 'progress' ? '› ' : entry.type === 'success' ? '✓ ' : '✗ '}
              {entry.message}
            </div>
          ))}
          <div ref={logEndRef} />
        </div>

        {/* Footer buttons */}
        {!scanning && (
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            {error && (
              <button className="btn btn-ghost btn-sm" onClick={onRescan}>
                <RefreshCw size={12} /> Try again
              </button>
            )}
            <button className="btn btn-primary btn-sm" onClick={onDismiss}>
              {done ? 'View context' : 'Close'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Empty file state ──────────────────────────────────────────────────────────

function EmptyFileState({ file, hasAnyContext, onScan, scanning }) {
  const Icon = FILE_ICON_COMPONENTS[file]
  return (
    <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--text-muted)' }}>
      <Icon size={28} strokeWidth={1.5} style={{ marginBottom: '14px', opacity: 0.4 }} />
      <div style={{ fontWeight: 500, marginBottom: '6px', color: 'var(--text-secondary)', fontSize: '14px' }}>
        {FILE_LABELS[file]} not generated yet
      </div>
      <div style={{ fontSize: '12px', marginBottom: '20px', lineHeight: 1.6 }}>
        {hasAnyContext
          ? 'This file was not generated in the last scan. Re-scan to regenerate all context.'
          : 'Scan your project directory to automatically generate PRD, Architecture, Tech Stack, and Personas docs.'
        }
      </div>
      <button
        className="btn btn-primary"
        onClick={onScan}
        disabled={scanning}
        style={{ gap: '7px' }}
      >
        {scanning
          ? <><Loader size={13} className="animate-spin" /> Scanning…</>
          : <><RefreshCw size={13} /> Scan & generate context</>
        }
      </button>
    </div>
  )
}
