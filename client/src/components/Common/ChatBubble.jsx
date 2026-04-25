import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Bot, User } from 'lucide-react'

export default function ChatBubble({ message, streaming = false }) {
  const isUser = message.role === 'user'

  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      padding: '12px 0',
      flexDirection: isUser ? 'row-reverse' : 'row',
      animationName: 'fadeIn', animationDuration: '0.2s', animationFillMode: 'both'
    }}>
      {/* Avatar */}
      <div style={{
        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
        background: isUser ? 'var(--bg-elevated)' : 'var(--accent-dim)',
        border: `1px solid ${isUser ? 'var(--border-bright)' : 'var(--accent-dim)'}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {isUser
          ? <User size={14} color="var(--text-secondary)" />
          : <Bot size={14} color="var(--accent-hover)" />
        }
      </div>

      {/* Bubble */}
      <div style={{
        maxWidth: '80%',
        background: isUser ? 'var(--bg-elevated)' : 'var(--bg-surface)',
        border: `1px solid ${isUser ? 'var(--border-bright)' : 'var(--border)'}`,
        borderRadius: isUser ? 'var(--radius) 2px var(--radius) var(--radius)' : '2px var(--radius) var(--radius) var(--radius)',
        padding: '10px 14px',
        fontSize: '13px', lineHeight: '1.6'
      }}>
        {isUser ? (
          <div style={{ color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
            {message.content}
          </div>
        ) : (
          <div className="markdown-body" style={{ fontSize: '13px' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content + (streaming ? '▋' : '')}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
