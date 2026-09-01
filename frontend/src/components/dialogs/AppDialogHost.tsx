/**
 * Renders the currently active app dialog. Mounted once near the app root.
 * Supports Esc (cancel) and Enter (confirm) like the legacy implementation.
 */

import { useEffect, useRef, useState } from 'react'
import { useDialogStore } from '../../store/dialogStore'

export function AppDialogHost() {
  const current = useDialogStore((s) => s.current)
  const settle = useDialogStore((s) => s.settle)
  const [promptValue, setPromptValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (current?.kind === 'prompt') {
      setPromptValue(current.defaultValue ?? '')
      // Focus after render.
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [current])

  useEffect(() => {
    if (!current) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        settle(current.kind === 'confirm' ? false : current.kind === 'prompt' ? null : undefined)
      } else if (event.key === 'Enter' && current.kind !== 'prompt') {
        event.preventDefault()
        settle(current.kind === 'confirm' ? true : undefined)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, settle])

  if (!current) return null

  return (
    <div className="app-dialog-backdrop" role="presentation">
      <div className="app-dialog" role="dialog" aria-modal="true">
        {current.title ? <h3 className="app-dialog-title">{current.title}</h3> : null}
        <div className="app-dialog-message">{current.message}</div>
        {current.kind === 'prompt' ? (
          <input
            ref={inputRef}
            className="app-dialog-input"
            type="text"
            value={promptValue}
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                settle(promptValue)
              }
            }}
          />
        ) : null}
        <div className="app-dialog-actions">
          {current.kind === 'alert' ? (
            <button type="button" className="app-dialog-btn app-dialog-btn-primary" onClick={() => settle(undefined)}>
              OK
            </button>
          ) : null}
          {current.kind === 'confirm' ? (
            <>
              <button type="button" className="app-dialog-btn app-dialog-btn-primary" onClick={() => settle(true)}>
                OK
              </button>
              <button type="button" className="app-dialog-btn" onClick={() => settle(false)}>
                Cancel
              </button>
            </>
          ) : null}
          {current.kind === 'prompt' ? (
            <>
              <button type="button" className="app-dialog-btn app-dialog-btn-primary" onClick={() => settle(promptValue)}>
                OK
              </button>
              <button type="button" className="app-dialog-btn" onClick={() => settle(null)}>
                Cancel
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
