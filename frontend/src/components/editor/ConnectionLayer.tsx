/**
 * SVG connection-line layer — renders persistent connections from the editor
 * store, the in-flight temporary wire while drawing, and handles selection,
 * right-click style menu (width/color/type/rotation) and arrow-key
 * re-anchoring. Port of the connection system in system-core.js.
 */

import { useEffect, useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { appAlert, appPrompt } from '../../store/dialogStore'
import { connectionDraft, notifyConnectionDraftChanged, onConnectionDraftChanged } from './ContactPoints'
import type { LayoutConnectionEntry } from '../../api/types'

function getLineDashArray(lineType?: string): string {
  if (lineType === 'dashed') return '8 4'
  if (lineType === 'dotted') return '2 4'
  return ''
}

/** Anchor point of one side of a box in grid coordinates. */
export function anchorOf(geo: { left: number; top: number; width: number; height: number }, side: string): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: geo.left + geo.width / 2, y: geo.top }
    case 'bottom':
      return { x: geo.left + geo.width / 2, y: geo.top + geo.height }
    case 'left':
      return { x: geo.left, y: geo.top + geo.height / 2 }
    case 'right':
      return { x: geo.left + geo.width, y: geo.top + geo.height / 2 }
    default:
      return { x: geo.left + geo.width / 2, y: geo.top + geo.height / 2 }
  }
}

/** Geometry lookup supplied by the canvas (device boxes, deco, valves, plots, slots). */
export type GeometryLookup = (boxId: string) => { left: number; top: number; width: number; height: number } | undefined

/** Read an element's live geometry from the DOM (authoritative for position after drags). */
function domGeometry(boxId: string): { left: number; top: number; width: number; height: number } | undefined {
  const el = document.getElementById(boxId)
  if (!el) return undefined
  const left = parseFloat(el.style.left || '')
  const top = parseFloat(el.style.top || '')
  const rect = el.getBoundingClientRect()
  const zoom = useEditorStore.getState().zoom || 1
  return {
    left: Number.isFinite(left) ? left : el.offsetLeft,
    top: Number.isFinite(top) ? top : el.offsetTop,
    width: Number.isFinite(el.offsetWidth) && el.offsetWidth > 0 ? el.offsetWidth : rect.width / zoom,
    height: Number.isFinite(el.offsetHeight) && el.offsetHeight > 0 ? el.offsetHeight : rect.height / zoom,
  }
}

interface ConnectionLayerProps {
  getGeometry: GeometryLookup
  interactive: boolean
}

export function ConnectionLayer({ getGeometry, interactive }: ConnectionLayerProps) {
  const connections = useEditorStore((s) => s.connections)
  const updateConnection = useEditorStore((s) => s.updateConnection)
  const removeConnection = useEditorStore((s) => s.removeConnection)
  const deviceGeometry = useEditorStore((s) => s.deviceGeometry)
  const [selected, setSelected] = useState<number | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [submenu, setSubmenu] = useState<'width' | 'color' | 'type' | null>(null)
  const [, setDraftTick] = useState(0)
  const [, setRedrawTick] = useState(0)

  // Re-render while a connection draft is in flight.
  useEffect(() => onConnectionDraftChanged(() => setDraftTick((t) => t + 1)), [])

  // Redraw on element drags (mousemove) and store geometry commits — legacy refreshConnectionLines().
  useEffect(() => {
    let raf = 0
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setRedrawTick((t) => t + 1))
    }
    document.addEventListener('mousemove', schedule)
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('mousemove', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])

  // Resolve geometry: prefer live DOM position, fall back to the store-derived lookup.
  const resolveGeo = (boxId: string) => domGeometry(boxId) ?? getGeometry(boxId)

  // Track the cursor for the temporary wire (grid coordinates).
  useEffect(() => {
    if (!interactive) return
    const grid = document.getElementById('device-grid')
    if (!grid) return
    const onMove = (e: MouseEvent) => {
      if (!connectionDraft.active) return
      const rect = grid.getBoundingClientRect()
      const zoom = useEditorStore.getState().zoom || 1
      connectionDraft.cursor = {
        x: (e.clientX - rect.left) / zoom,
        y: (e.clientY - rect.top) / zoom,
      }
      notifyConnectionDraftChanged()
    }
    const onUp = () => {
      if (connectionDraft.active) {
        connectionDraft.active = null
        connectionDraft.cursor = null
        notifyConnectionDraftChanged()
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [interactive])

  // Arrow-key re-anchoring + Escape (legacy setupConnectionLineKeyboardControl).
  useEffect(() => {
    if (!interactive) return
    const onKey = (event: KeyboardEvent) => {
      if (selected === null) return
      const target = event.target as HTMLElement
      if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const sideByKey: Record<string, string> = {
        ArrowUp: 'top',
        ArrowDown: 'bottom',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      }
      const nextSide = sideByKey[event.key]
      if (!nextSide) {
        if (event.key === 'Escape') setSelected(null)
        return
      }
      event.preventDefault()
      const conn = connections[selected]
      if (!conn) return
      updateConnection(selected, { startSide: nextSide, endSide: nextSide })
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [interactive, selected, connections, updateConnection])

  const openMenu = (index: number, e: React.MouseEvent) => {
    if (!interactive) return
    e.preventDefault()
    setSelected(index)
    setMenu({ x: e.clientX, y: e.clientY })
    setSubmenu(null)
  }

  const applyStyle = (patch: Partial<LayoutConnectionEntry>) => {
    if (selected === null) return
    updateConnection(selected, patch)
  }

  const rotateLine = async () => {
    if (selected === null) return
    const conn = connections[selected]
    const current = parseFloat(conn?.rotationDegrees || '0') || 0
    setMenu(null)
    const response = await appPrompt('Enter line rotation in degrees', String(current), 'Rotate Line')
    if (response === null) return
    const next = parseFloat(String(response).trim())
    if (!Number.isFinite(next)) {
      await appAlert('Please enter a valid number of degrees.', 'Rotate Line')
      return
    }
    updateConnection(selected, { rotationDegrees: String(next) })
  }

  const lineTransform = (a: { x: number; y: number }, b: { x: number; y: number }, rotationDegrees?: string) => {
    const deg = parseFloat(rotationDegrees || '0') || 0
    if (Math.abs(deg) < 0.0001) return undefined
    const cx = (a.x + b.x) / 2
    const cy = (a.y + b.y) / 2
    return `rotate(${deg} ${cx} ${cy})`
  }

  return (
    <>
      <svg
        id="connection-svg"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: interactive ? 'auto' : 'none',
        }}
      >
        {connections.map((conn, index) => {
          const startGeo = resolveGeo(conn.startBoxId)
          const endGeo = resolveGeo(conn.endBoxId)
          if (!startGeo || !endGeo) return null
          const a = anchorOf(startGeo, conn.startSide)
          const b = anchorOf(endGeo, conn.endSide)
          return (
            <line
              key={index}
              className={`device-connection-line${selected === index ? ' is-selected' : ''}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              transform={lineTransform(a, b, conn.rotationDegrees)}
              style={{
                stroke: conn.strokeColor || '#007bff',
                strokeWidth: conn.strokeWidth || '2',
                strokeDasharray: getLineDashArray(conn.lineType),
                pointerEvents: interactive ? 'visibleStroke' : 'none',
                cursor: interactive ? 'pointer' : 'default',
              }}
              onMouseDown={(e) => {
                if (!interactive) return
                e.stopPropagation()
                setSelected(index)
              }}
              onContextMenu={(e) => openMenu(index, e)}
            />
          )
        })}
        {connectionDraft.active && connectionDraft.cursor && (
          <line
            className="device-connection-line is-temporary"
            x1={connectionDraft.active.x}
            y1={connectionDraft.active.y}
            x2={connectionDraft.cursor.x}
            y2={connectionDraft.cursor.y}
            style={{ stroke: '#007bff', strokeWidth: 2, pointerEvents: 'none' }}
          />
        )}
      </svg>

      {/* Line context menu (legacy #context-menu) */}
      {menu && selected !== null && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 5000 }} onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null) }} />
          <div className="line-context-menu" style={{ display: 'block', position: 'fixed', left: menu.x, top: menu.y, zIndex: 5001 }}>
            <div className="line-context-title">Edit Line</div>
            <button type="button" className="line-context-item" onClick={() => setSubmenu(submenu === 'width' ? null : 'width')}>
              Line Width
            </button>
            <button type="button" className="line-context-item" onClick={() => setSubmenu(submenu === 'color' ? null : 'color')}>
              Line Color
            </button>
            <button type="button" className="line-context-item" onClick={() => setSubmenu(submenu === 'type' ? null : 'type')}>
              Line Type
            </button>
            <button type="button" className="line-context-item" onClick={() => void rotateLine()}>
              Rotation...
            </button>
            <button
              type="button"
              className="line-context-item"
              onClick={() => {
                removeConnection(selected)
                setMenu(null)
                setSelected(null)
              }}
            >
              Delete Line
            </button>

            {submenu === 'width' && (
              <div className="line-context-submenu" style={{ display: 'block' }}>
                {[1, 2, 4, 6].map((w) => (
                  <button
                    key={w}
                    type="button"
                    className="line-width-option"
                    onClick={() => {
                      applyStyle({ strokeWidth: String(w) })
                      setMenu(null)
                    }}
                  >
                    <span className={`line-width-preview line-width-preview-${w}`} />
                    {w} px
                  </button>
                ))}
              </div>
            )}
            {submenu === 'color' && (
              <div className="line-context-submenu" style={{ display: 'block' }}>
                <label className="line-color-row" htmlFor="line-color-picker">
                  Choose color
                </label>
                <input
                  type="color"
                  id="line-color-picker"
                  value={connections[selected]?.strokeColor || '#007bff'}
                  onChange={(e) => applyStyle({ strokeColor: e.target.value })}
                />
              </div>
            )}
            {submenu === 'type' && (
              <div className="line-context-submenu" style={{ display: 'block' }}>
                {(['solid', 'dashed', 'dotted'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="line-type-option"
                    onClick={() => {
                      applyStyle({ lineType: t })
                      setMenu(null)
                    }}
                  >
                    <span className={`line-type-preview line-type-${t}`} />
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  )
}
