/**
 * Day/night start-page mode indicator.
 *
 * Ported from system-core.js: automatic mode derives from the OS color scheme
 * or the hour of day (night before 7:00 / from 19:00); a manual toggle is
 * persisted in localStorage "startPageMode" and wins until cleared.
 */

import { useCallback, useEffect, useState } from 'react'
import { START_PAGE_MODE_KEY } from '../../utils/storage'

export type StartPageMode = 'day' | 'night'

export function getAutomaticStartPageMode(): StartPageMode {
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const hour = new Date().getHours()
  return prefersDark || hour < 7 || hour >= 19 ? 'night' : 'day'
}

function readCurrentMode(): StartPageMode {
  const stored = localStorage.getItem(START_PAGE_MODE_KEY)
  return stored === 'day' || stored === 'night' ? stored : getAutomaticStartPageMode()
}

export function useStartPageMode(): { mode: StartPageMode; toggle: () => void } {
  const [mode, setMode] = useState<StartPageMode>(readCurrentMode)

  useEffect(() => {
    document.body.dataset.startPageMode = mode
    return () => {
      delete document.body.dataset.startPageMode
    }
  }, [mode])

  useEffect(() => {
    if (!window.matchMedia) return
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (!localStorage.getItem(START_PAGE_MODE_KEY)) {
        setMode(getAutomaticStartPageMode())
      }
    }
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(() => {
    setMode((current) => {
      const next: StartPageMode = current === 'night' ? 'day' : 'night'
      localStorage.setItem(START_PAGE_MODE_KEY, next)
      return next
    })
  }, [])

  return { mode, toggle }
}

export function DayNightToggle({ mode, onToggle }: { mode: StartPageMode; onToggle: () => void }) {
  return (
    <button
      id="start-page-mode-indicator"
      className="mode-indicator"
      type="button"
      aria-live="polite"
      aria-label="Toggle day and night mode"
      title="Toggle day and night mode"
      onClick={onToggle}
    >
      <span className="mode-indicator-dot" />
      <span id="start-page-mode-label">{mode === 'night' ? 'Night mode' : 'Day mode'}</span>
    </button>
  )
}
