/**
 * Contact points + connection drawing for canvas elements.
 *
 * Ports the connection-line system from system-core.js: each canvas element
 * gets 4 contact points (top/bottom/left/right). Mousedown on a point starts
 * a temporary wire; mouseup on another point finalizes a persistent
 * connection stored in the editor store and rendered as SVG lines.
 */

import { useEditorStore } from '../../store/editorStore'

export type ContactSide = 'top' | 'bottom' | 'left' | 'right'

export interface ContactPointDef {
  boxId: string
  side: ContactSide
  /** Anchor position in grid (canvas) coordinates. */
  x: number
  y: number
}

interface ContactPointsProps {
  boxId: string
  /** Geometry of the owning element in grid coordinates. */
  geometry: { left: number; top: number; width: number; height: number }
  visible: boolean
}

/** Where in-flight drawing state is kept (module-level, not React state). */
export const connectionDraft: {
  active: ContactPointDef | null
  cursor: { x: number; y: number } | null
} = { active: null, cursor: null }

const listeners = new Set<() => void>()
export function notifyConnectionDraftChanged(): void {
  listeners.forEach((fn) => fn())
}
export function onConnectionDraftChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function ContactPoints({ boxId, geometry, visible }: ContactPointsProps) {
  if (!visible) return null

  const { left, top, width, height } = geometry
  const anchorFor = (side: ContactSide): { x: number; y: number } => {
    switch (side) {
      case 'top':
        return { x: left + width / 2, y: top }
      case 'bottom':
        return { x: left + width / 2, y: top + height }
      case 'left':
        return { x: left, y: top + height / 2 }
      case 'right':
        return { x: left + width, y: top + height / 2 }
    }
  }

  const startDraft = (side: ContactSide) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const anchor = anchorFor(side)
    connectionDraft.active = { boxId, side, ...anchor }
    connectionDraft.cursor = anchor
    notifyConnectionDraftChanged()
  }

  const finishDraft = (side: ContactSide) => (e: React.MouseEvent) => {
    if (!connectionDraft.active) return
    e.preventDefault()
    e.stopPropagation()
    const start = connectionDraft.active
    // Ignore self-connections on the same side.
    if (!(start.boxId === boxId && start.side === side)) {
      const anchor = anchorFor(side)
      useEditorStore.getState().addConnection({
        startBoxId: start.boxId,
        startSide: start.side,
        endBoxId: boxId,
        endSide: side,
        strokeColor: '#007bff',
        strokeWidth: '2',
        lineType: 'solid',
        rotationDegrees: '0',
      })
      void anchor
    }
    connectionDraft.active = null
    connectionDraft.cursor = null
    notifyConnectionDraftChanged()
  }

  const points: Array<{ side: ContactSide; style: React.CSSProperties }> = [
    { side: 'top', style: { left: '50%', top: 0, transform: 'translate(-50%, -50%)' } },
    { side: 'bottom', style: { left: '50%', top: '100%', transform: 'translate(-50%, -50%)' } },
    { side: 'left', style: { left: 0, top: '50%', transform: 'translate(-50%, -50%)' } },
    { side: 'right', style: { left: '100%', top: '50%', transform: 'translate(-50%, -50%)' } },
  ]

  return (
    <>
      {points.map(({ side, style }) => (
        <div
          key={side}
          className={`contact-point ${side}`}
          style={{ position: 'absolute', ...style }}
          onMouseDown={startDraft(side)}
          onMouseUp={finishDraft(side)}
        />
      ))}
    </>
  )
}
