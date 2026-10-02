/**
 * Right-click canvas create menu — React port of the canvas-create-menu from
 * system-layout.js (Add plot / Add device / Add customized element / Layout
 * actions) with hover submenus.
 */

import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { getStoredPlotConfigs } from '../../utils/storage'
import { api } from '../../api/client'

export interface CanvasCreateRequest {
  x: number
  y: number
  canvasLeft: number
  canvasTop: number
}

interface CanvasCreateMenuProps {
  request: CanvasCreateRequest | null
  onClose: () => void
  onAddDevice: (device: string, pos: { left: number; top: number }) => void
  onAddDecoration: (type: string, pos: { left: number; top: number }) => void
  onUploadImage: (pos: { left: number; top: number }) => void
  onNewPlot: (pos: { left: number; top: number }) => void
  onCreateSavedPlot: (name: string, pos: { left: number; top: number }) => void
  onZoom: (delta: number) => void
  onResetView: () => void
  onSaveLayout: () => void
  onLoadLayout: () => void
  onNewLayout: () => void
}

const DECORATION_OPTIONS = [
  { value: 'line', label: 'Line' },
  { value: 'switch', label: 'Valve Switch' },
  { value: 'label', label: 'Text Label' },
]

export function CanvasCreateMenu({
  request,
  onClose,
  onAddDevice,
  onAddDecoration,
  onUploadImage,
  onNewPlot,
  onCreateSavedPlot,
  onZoom,
  onResetView,
  onSaveLayout,
  onLoadLayout,
  onNewLayout,
}: CanvasCreateMenuProps) {
  const deviceParams = useAppStore((s) => s.deviceParams)
  const [openSubmenu, setOpenSubmenu] = useState<'plot' | 'device' | 'decoration' | 'layout'>('plot')
  const [savedPlotNames, setSavedPlotNames] = useState<string[]>([])

  // Merge localStorage plot config names with server-side names (legacy updatePlotConfigList).
  useEffect(() => {
    if (!request) return
    const local = Object.keys(getStoredPlotConfigs())
    api
      .listPlotConfigs()
      .then((payload) => {
        const merged = Array.from(new Set([...local, ...(payload.names ?? [])])).sort()
        setSavedPlotNames(merged)
      })
      .catch(() => setSavedPlotNames(local.sort()))
  }, [request])

  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [request, onClose])

  const devices = useMemo(() => Object.keys(deviceParams ?? {}).sort(), [deviceParams])

  if (!request) return null

  const pos = { left: request.canvasLeft, top: request.canvasTop }
  const alignLeft = request.x > window.innerWidth - 320

  const entries: Array<{ key: typeof openSubmenu; label: string; items: Array<{ label: string; title?: string; action: () => void }> }> = [
    {
      key: 'plot',
      label: 'Add plot',
      items: [
        { label: 'New plot', action: () => onNewPlot(pos) },
        ...savedPlotNames.map((name) => ({ label: name, action: () => onCreateSavedPlot(name, pos) })),
      ],
    },
    {
      key: 'device',
      label: 'Add device',
      items: devices.map((d) => {
        const info = deviceParams?.[d]
        return { label: info?.original_name || d, title: d, action: () => onAddDevice(d, pos) }
      }),
    },
    {
      key: 'decoration',
      label: 'Add customized element',
      items: DECORATION_OPTIONS.map((o) => ({ label: o.label, title: o.value, action: () => onAddDecoration(o.value, pos) })),
    },
    {
      key: 'layout',
      label: 'Layout actions',
      items: [
        { label: 'Zoom in', action: () => onZoom(0.1) },
        { label: 'Zoom out', action: () => onZoom(-0.1) },
        { label: 'Reset view', action: () => onResetView() },
        { label: 'Save layout', action: () => onSaveLayout() },
        { label: 'Load layout', action: () => onLoadLayout() },
        { label: 'New layout', action: () => onNewLayout() },
      ],
    },
  ]

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 4990 }} onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div
        id="canvas-create-menu"
        className={`canvas-create-menu${alignLeft ? ' canvas-create-menu-align-left' : ''}`}
        style={{ display: 'block', position: 'fixed', left: Math.max(12, Math.min(request.x, window.innerWidth - 240)), top: Math.max(12, Math.min(request.y, window.innerHeight - 200)), zIndex: 4991 }}
      >
        <button
          type="button"
          className="canvas-create-submenu-item"
          onClick={() => {
            onUploadImage(pos)
            onClose()
          }}
        >
          Upload image...
        </button>
        {entries.map((entry) => (
          <div
            key={entry.key}
            className={`canvas-create-menu-entry${openSubmenu === entry.key ? ' is-open' : ''}`}
            data-submenu={entry.key}
            onMouseEnter={() => setOpenSubmenu(entry.key)}
          >
            <span>{entry.label}</span>
            <span className="canvas-create-menu-arrow">&#8250;</span>
            <div className={`canvas-create-submenu${openSubmenu === entry.key ? ' is-open' : ''}`} id={`canvas-create-submenu-${entry.key}`}>
              {entry.items.length === 0 ? (
                <div className="canvas-create-empty">No options</div>
              ) : (
                entry.items.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="canvas-create-submenu-item"
                    title={item.title || item.label}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      onClose()
                      item.action()
                    }}
                  >
                    {item.label}
                  </button>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
