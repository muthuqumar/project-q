import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Bot, User, ChevronDown, ChevronUp } from 'lucide-react'

// Characters before we offer a "Show more" toggle
const COLLAPSE_THRESHOLD = 500

export default function ChatBubble({ message, streaming = false }) {
  const isUser = message.role === 'user'
  const content = message.content || ''
  const isLong = !streaming && content.length > COLLAPSE_THRESHOLD
  const [expanded, setExpanded] = useState(false)

  const displayContent = isLong && !expanded
    ? content.slice(0, COLLAPSE_THRESHOLD)
    : content

  return (
    <div style={{
      display: 'flex',
      gap: '10px',
      padding: '10px 0',
      flexDirection: isUser ? 'row-reverse' : 'row',
      animationName: 'fadeIn', animationDuration: '0.2s', animationFillMode: 'both'
    }}>
      {/* Avatar */}
      <div style={{
        width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
        background: isUser ? 'var(--bg-elevated)' : 'var(--accent-dim)',
        border: `1px solid ${isUser ? 'var(--border-bright)' : 'var(--border)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginTop: '2px'
      }}>
        {isUser
          ? <User size={12} color="var(--text-secondary)" />
          : <Bot size={12} color="var(--accent-hover)" />
        }
      </div>

      {/* Bubble */}
      <div style={{
        maxWidth: '84%',
        background: isUser ? 'var(--bg-elevated)' : 'var(--bg-surface)',
        border: `1px solid ${isUser ? 'var(--border-bright)' : 'var(--border)'}`,
        borderRadius: isUser
          ? 'var(--radius) 2px var(--radius) var(--radius)'
          : '2px var(--radius) var(--radius) var(--radius)',
        padding: '9px 13px',
        fontSize: '13px', lineHeight: '1.6'
      }}>
        {isUser ? (
          <div style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
            {content}
          </div>
        ) : (
          <>
            <div className="markdown-body" style={{ fontSize: '13px' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {displayContent + (streaming ? '▋' : (isLong && !expanded ? '…' : ''))}
              </ReactMarkdown>
            </div>

            {/* Show more / Show less toggle */}
            {isLong && (
              <button
                onClick={() => setExpanded(e => !e)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  marginTop: '6px', padding: '3px 0',
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: '11px', color: 'var(--accent-hover)',
                  fontWeight: 500, letterSpacing: '0.01em'
                }}
              >
                {expanded
                  ? <><ChevronUp size={12} /> Show less</>
                  : <><ChevronDown size={12} /> Show full response ({Math.round(content.length / 100) / 10}k chars)</>
                }
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
