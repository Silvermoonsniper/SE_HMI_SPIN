/**
 * Sample magazine slots and sample-presence block — React port of
 * setupSampleMagazine / make_slot / updateSampleSlotImages /
 * setupSample_presence / updateSamplepresence from system-devices.js.
 *
 * Each array element of a storage device's value becomes a free-floating slot
 * box; per-slot image overrides live in localStorage "magimg:<device>:<idx>".
 */

import { useAppStore, getParamValue } from '../../store/appStore'
import { appPrompt } from '../../store/dialogStore'
import { useEditorStore } from '../../store/editorStore'
import { useRef } from 'react'
import { useCanvasDrag } from '../editor/useCanvasDrag'

const PLACEHOLDER = '/c/assets/sample_holder.svg'

interface SampleSlotProps {
  device: string
  index: number
  label: unknown
  isConfigure: boolean
  left?: number
  top?: number
  onRemove?: (slotId: string) => void
  onGeometryChange?: (slotId: string, geo: { left: number; top: number; width?: number; height?: number }) => void
}

function magImageKey(device: string, idx: number): string {
  return `magimg:${device}:${idx}`
}

export function SampleSlot({ device, index, label, isConfigure, left, top, onRemove, onGeometryChange }: SampleSlotProps) {
  const slotId = `mag-${device}-slot-${index}`
  const slotRef = useRef<HTMLDivElement>(null)
  const setSelected = useEditorStore((s) => s.setSelected)
  useCanvasDrag(slotRef, {
    enabled: isConfigure,
    minWidth: 60,
    minHeight: 60,
    onDragEnd: (r) => onGeometryChange?.(slotId, r),
    onResizeEnd: (r) => onGeometryChange?.(slotId, r),
  })

  let override: string | null = null
  try {
    override = localStorage.getItem(magImageKey(device, index))
  } catch {
    override = null
  }

  // Occupancy: non-empty array entry -> show placeholder; empty -> hidden.
  const occupied = label !== null && label !== undefined && label !== ''
  const src = override || (occupied ? PLACEHOLDER : '')
  const hidden = !override && !occupied

  const setImageUrl = async () => {
    const current = override || ''
    const url = await appPrompt('Enter image URL for this slot (or leave empty to clear):', current)
    if (url === null) return
    try {
      if (url) {
        localStorage.setItem(magImageKey(device, index), url)
      } else {
        localStorage.removeItem(magImageKey(device, index))
      }
    } catch {
      /* storage unavailable */
    }
    // Force re-render by nudging the store (image reads localStorage directly).
    useAppStore.setState((s) => ({ latestValues: { ...s.latestValues } }))
  }

  return (
    <div
      ref={slotRef}
      className="sample-slot device-box"
      id={slotId}
      onMouseDown={() => {
        if (isConfigure) setSelected(slotId)
      }}
      style={{
        position: 'absolute',
        left: left ?? 200 + index * 130,
        top: top ?? 50,
        width: 120,
        height: 120,
        padding: 6,
        boxSizing: 'border-box',
        cursor: isConfigure ? 'move' : 'default',
        zIndex: 5,
      }}
    >
      <div className="device-header" style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="device-title" style={{ fontSize: 12, paddingRight: 6 }}>
          {String(label ?? `Slot ${index + 1}`)}
        </div>
        {isConfigure && (
          <div
            className="deco-remove"
            style={{ position: 'absolute', top: 10, right: 10, cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation()
              onRemove?.(slotId)
            }}
          >
            &times;
          </div>
        )}
      </div>
      <div
        style={{
          width: '100%',
          height: 86,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <img
          src={src || undefined}
          alt=""
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            cursor: 'pointer',
            display: hidden ? 'none' : undefined,
          }}
          title="Click to set image URL (saved locally)"
          onClick={(e) => {
            e.stopPropagation()
            void setImageUrl()
          }}
        />
      </div>
      {isConfigure && <div className="resize-handle" />}
    </div>
  )
}

/**
 * Sample-presence block — one slot showing whether a sample is at the
 * measurement location (value of a sample_at_measurement device).
 */
export function SamplePresence({ device, isConfigure, left, top, onRemove, onGeometryChange }: { device: string; isConfigure: boolean; left?: number; top?: number; onRemove?: (id: string) => void; onGeometryChange?: (id: string, geo: { left: number; top: number }) => void }) {
  const latestValues = useAppStore((s) => s.latestValues)
  const presenceRef = useRef<HTMLDivElement>(null)
  const setSelected = useEditorStore((s) => s.setSelected)
  useCanvasDrag(presenceRef, {
    enabled: isConfigure,
    minWidth: 60,
    minHeight: 60,
    onDragEnd: (r) => onGeometryChange?.('sample_presence', r),
  })
  const valueEntry = getParamValue(latestValues, device, 'value')
  const presenceVal = valueEntry?.value

  let override: string | null = null
  try {
    override = localStorage.getItem('sample_presence')
  } catch {
    override = null
  }

  const present = presenceVal !== null && presenceVal !== undefined && presenceVal !== ''
  const src = override || (present ? PLACEHOLDER : '')
  const hidden = !override && !present

  const setImageUrl = async () => {
    const url = await appPrompt('Enter image URL for the sample (or leave empty to clear):', override || '')
    if (url === null) return
    try {
      if (url) {
        localStorage.setItem('sample_presence', url)
      } else {
        localStorage.removeItem('sample_presence')
      }
    } catch {
      /* storage unavailable */
    }
    useAppStore.setState((s) => ({ latestValues: { ...s.latestValues } }))
  }

  return (
    <div
      ref={presenceRef}
      className="sample-slot device-box"
      id="sample_presence"
      onMouseDown={() => {
        if (isConfigure) setSelected('sample_presence')
      }}
      style={{
        position: 'absolute',
        left: left ?? 200,
        top: top ?? 50,
        width: 120,
        height: 120,
        padding: 6,
        boxSizing: 'border-box',
        cursor: isConfigure ? 'move' : 'default',
        zIndex: 5,
      }}
    >
      <div className="device-header" style={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="device-title" style={{ fontSize: 12, paddingRight: 6 }}>
          {present ? String(presenceVal) : 'sample'}
        </div>
        {isConfigure && (
          <div
            className="deco-remove"
            style={{ position: 'absolute', top: 10, right: 10, cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation()
              onRemove?.('sample_presence')
            }}
          >
            &times;
          </div>
        )}
      </div>
      <div
        style={{
          width: '100%',
          height: 86,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <img
          src={src || undefined}
          alt=""
          style={{
            maxWidth: '100%',
            maxHeight: '100%',
            objectFit: 'contain',
            cursor: 'pointer',
            display: hidden ? 'none' : undefined,
          }}
          title="Click to set image URL (saved locally)"
          onClick={(e) => {
            e.stopPropagation()
            void setImageUrl()
          }}
        />
      </div>
      {isConfigure && <div className="resize-handle" />}
    </div>
  )
}
