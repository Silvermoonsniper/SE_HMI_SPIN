/**
 * Decoration element (line / switch / label) — React port of createDecoration,
 * create_decoration, applyDecorationLineStyle/Rotation, applyDecorationSwitchRotation,
 * rotateDecorationSwitch and the text context menu from system-layout.js.
 */

import { useRef, useState } from 'react'
import { useEditorStore } from '../../store/editorStore'
import { appAlert, appPrompt } from '../../store/dialogStore'
import { useCanvasDrag } from './useCanvasDrag'
import type { LayoutDecorationEntry } from '../../api/types'

export const DECORATION_LINE_MIN_LENGTH_PX = 38
export const SWITCH_SVG_DATA_URI =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgZmlsbD0id2hpdGUiLz48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSg2Miw1MykiPjxjaXJjbGUgY3g9IjAiIGN5PSIwIiByPSI0NSIgZmlsbD0id2hpdGUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIi8+PHBhdGggZD0iTSAtNDQuMyA2LjcgQSA0NSA0NSAwIDAgMSAtNi43IDQ0LjMiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNIDQ0LjMgLTYuNyBBIDQ1IDQ1IDAgMCAxIDYuNyAtNDQuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMzMzIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvZz48L3N2Zz4='

function parsePx(v: string | undefined, fallback: number): number {
  const n = parseFloat(v || '')
  return Number.isFinite(n) ? n : fallback
}

function rgbToHex(col: string): string | null {
  const m = String(col || '').match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
  if (!m) return col?.startsWith('#') ? col : null
  return '#' + [1, 2, 3].map((i) => ('0' + parseInt(m[i], 10).toString(16)).slice(-2)).join('')
}

interface DecorationBoxProps {
  decoration: LayoutDecorationEntry
  isConfigure: boolean
  onGeometryChange: (id: string, geo: { left: number; top: number; width?: number; height?: number }) => void
}

export function DecorationBox({ decoration, isConfigure, onGeometryChange }: DecorationBoxProps) {
  const ref = useRef<HTMLDivElement>(null)
  const updateDecoration = useEditorStore((s) => s.updateDecoration)
  const removeDecoration = useEditorStore((s) => s.removeDecoration)
  const selectedId = useEditorStore((s) => s.selectedId)
  const setSelected = useEditorStore((s) => s.setSelected)

  const [textMenu, setTextMenu] = useState<{ x: number; y: number } | null>(null)
  const [lineMenu, setLineMenu] = useState<{ x: number; y: number } | null>(null)

  const type = decoration.type
  const isLine = type === 'line'
  const isSwitch = type === 'switch'
  const isLabel = type === 'label'
  const isImage = type === 'image'

  const geo = {
    left: parsePx(decoration.left, 100),
    top: parsePx(decoration.top, 100),
    width: parsePx(decoration.width, isLine ? 120 : isSwitch ? 80 : 100),
    height: parsePx(decoration.height, isLine ? 12 : isSwitch ? 80 : 24),
  }

  useCanvasDrag(ref, {
    enabled: isConfigure,
    minWidth: isLine ? DECORATION_LINE_MIN_LENGTH_PX : 40,
    minHeight: isLine ? 12 : 24,
    lineOnly: isLine,
    onDragEnd: (r) => {
      updateDecoration(decoration.id, { left: `${r.left}px`, top: `${r.top}px` })
      onGeometryChange(decoration.id, r)
    },
    onResizeEnd: (r) => {
      updateDecoration(decoration.id, { width: `${r.width}px`, height: `${r.height}px` })
      onGeometryChange(decoration.id, r)
    },
  })

  const rotation = parseFloat(decoration.rotationDegrees || '0') || 0
  const selected = selectedId === decoration.id

  const commitText = (text: string) => updateDecoration(decoration.id, { text })

  const openTextMenu = (e: React.MouseEvent) => {
    if (!isLabel || !isConfigure) return
    e.preventDefault()
    e.stopPropagation()
    setSelected(decoration.id)
    setTextMenu({ x: e.clientX, y: e.clientY })
  }

  const openLineMenu = (e: React.MouseEvent) => {
    if (!isLine || !isConfigure) return
    e.preventDefault()
    e.stopPropagation()
    setSelected(decoration.id)
    setLineMenu({ x: e.clientX, y: e.clientY })
  }

  const rotateLine = async () => {
    setLineMenu(null)
    const response = await appPrompt('Enter line rotation in degrees', String(rotation), 'Rotate Line')
    if (response === null) return
    const next = parseFloat(String(response).trim())
    if (!Number.isFinite(next)) {
      await appAlert('Please enter a valid number of degrees.', 'Rotate Line')
      return
    }
    updateDecoration(decoration.id, { rotationDegrees: String(next) })
  }

  const lineVisualStyle: React.CSSProperties = {
    height: 0,
    backgroundColor: 'transparent',
    borderTop: `${decoration.lineWidth || '2'}px ${decoration.lineType || 'solid'} ${decoration.lineColor || '#007bff'}`,
    position: 'absolute',
    top: '50%',
    width: '100%',
    left: 0,
    borderRadius: Math.max(1, Number(decoration.lineWidth || 2)),
    transform: `translateY(-50%) rotate(${rotation}deg)`,
  }

  return (
    <>
      <div
        ref={ref}
        className={`deco-box${isConfigure ? ' configure-layout' : ''}${isLine ? ' deco-type-line' : ''}${isSwitch ? ' deco-type-switch' : ''}${isImage ? ' deco-type-image' : ''}${isLabel ? ' deco-label' : ''}${selected ? ' selected' : ''}`}
        id={decoration.id}
        data-type={type}
        data-rotation-degrees={String(rotation)}
        data-line-color={decoration.lineColor}
        data-line-width={decoration.lineWidth}
        data-line-type={decoration.lineType}
        style={{
          position: 'absolute',
          left: geo.left,
          top: geo.top,
          width: geo.width,
          height: geo.height,
          minWidth: isLine ? '1cm' : isSwitch ? 40 : undefined,
          minHeight: isLine ? 12 : isSwitch ? 40 : undefined,
          color: isLabel ? decoration.color : undefined,
          fontFamily: isLabel ? decoration.fontFamily : undefined,
          fontSize: isLabel ? decoration.fontSize : undefined,
          userSelect: isLabel ? 'text' : undefined,
        }}
        contentEditable={isConfigure && isLabel}
        suppressContentEditableWarning
        tabIndex={isLabel ? 0 : undefined}
        onMouseDown={(e) => {
          if (!isConfigure) return
          e.stopPropagation()
          setSelected(decoration.id)
        }}
        onClick={(e) => {
          // Switch decorations rotate on click, but only in configure mode
          // (legacy behavior gates all editing on areDecorationEditsEnabled).
          if (!isSwitch || !isConfigure) return
          e.preventDefault()
          e.stopPropagation()
          updateDecoration(decoration.id, { rotationDegrees: String(rotation + 90) })
        }}
        onBlur={(e) => {
          if (isLabel) commitText(e.currentTarget.textContent || '')
        }}
        onContextMenu={isLabel ? openTextMenu : isLine ? openLineMenu : undefined}
      >
        {isLine && <div className="deco-visual" style={lineVisualStyle} />}
        {isSwitch && (
          <div className="deco-visual">
            <img src={SWITCH_SVG_DATA_URI} alt="Valve switch" style={{ transform: `rotate(${rotation}deg)` }} />
          </div>
        )}
        {isLabel && (decoration.text ?? 'Label')}
        {isImage && (
          <img
            className="deco-image"
            src={decoration.imageSrc}
            alt={decoration.imageName || 'Uploaded image'}
            draggable={false}
          />
        )}
        {isLabel && isConfigure && (
          <div
            className="deco-drag-handle"
            title="Drag to move"
            style={{
              position: 'absolute',
              top: -6,
              left: -6,
              width: 12,
              height: 12,
              background: 'rgba(0,0,0,0.22)',
              borderRadius: '50%',
              cursor: 'move',
              pointerEvents: 'auto',
              display: 'block',
              zIndex: 20,
            }}
          />
        )}
        {isConfigure && (
          <div
            className="deco-remove"
            onClick={(e) => {
              e.stopPropagation()
              removeDecoration(decoration.id)
            }}
          >
            &times;
          </div>
        )}
        {isConfigure && !isLabel && <div className="resize-handle" title="Drag to resize" />}
      </div>

      {/* Text context menu (legacy #text-context-menu) */}
      {textMenu && isLabel && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 5000 }} onMouseDown={() => setTextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setTextMenu(null) }} />
          <div className="line-context-menu text-context-menu" style={{ display: 'block', position: 'fixed', left: textMenu.x, top: textMenu.y, zIndex: 5001 }}>
            <div className="line-context-title">Edit Text</div>
            <label className="text-context-field" htmlFor="text-font-family">Font</label>
            <select
              id="text-font-family"
              className="text-context-select"
              value={decoration.fontFamily || 'Arial, sans-serif'}
              onChange={(e) => updateDecoration(decoration.id, { fontFamily: e.target.value })}
            >
              <option value="Arial, sans-serif">Arial</option>
              <option value="Verdana, sans-serif">Verdana</option>
              <option value="Tahoma, sans-serif">Tahoma</option>
              <option value="Trebuchet MS, sans-serif">Trebuchet MS</option>
              <option value="Georgia, serif">Georgia</option>
              <option value="Times New Roman, serif">Times New Roman</option>
              <option value="Courier New, monospace">Courier New</option>
            </select>
            <label className="text-context-field" htmlFor="text-font-size">Size</label>
            <select
              id="text-font-size"
              className="text-context-select"
              value={decoration.fontSize || '16px'}
              onChange={(e) => updateDecoration(decoration.id, { fontSize: e.target.value })}
            >
              {['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px'].map((s) => (
                <option key={s} value={s}>{s.replace('px', ' px')}</option>
              ))}
            </select>
            <label className="text-context-field" htmlFor="text-font-color">Color</label>
            <input
              type="color"
              id="text-font-color"
              value={rgbToHex(decoration.color || '') || '#333333'}
              onChange={(e) => updateDecoration(decoration.id, { color: e.target.value })}
            />
          </div>
        </>
      )}

      {/* Line decoration context menu */}
      {lineMenu && isLine && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 5000 }} onMouseDown={() => setLineMenu(null)} onContextMenu={(e) => { e.preventDefault(); setLineMenu(null) }} />
          <div className="line-context-menu" style={{ display: 'block', position: 'fixed', left: lineMenu.x, top: lineMenu.y, zIndex: 5001 }}>
            <div className="line-context-title">Edit Line</div>
            <div className="line-context-submenu" style={{ display: 'block', position: 'static' }}>
              <label className="line-color-row" htmlFor="deco-line-color-picker">Choose color</label>
              <input
                type="color"
                id="deco-line-color-picker"
                value={decoration.lineColor || '#007bff'}
                onChange={(e) => updateDecoration(decoration.id, { lineColor: e.target.value })}
              />
            </div>
            {[1, 2, 4, 6].map((w) => (
              <button key={w} type="button" className="line-context-item" onClick={() => updateDecoration(decoration.id, { lineWidth: String(w) })}>
                {w} px
              </button>
            ))}
            {(['solid', 'dashed', 'dotted'] as const).map((t) => (
              <button key={t} type="button" className="line-context-item" onClick={() => updateDecoration(decoration.id, { lineType: t })}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
            <button type="button" className="line-context-item" onClick={() => void rotateLine()}>
              Rotation...
            </button>
          </div>
        </>
      )}
    </>
  )
}
