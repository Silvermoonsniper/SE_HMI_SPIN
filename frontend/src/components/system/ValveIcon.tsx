/**
 * Valve / switch icon — free-floating clickable SVG that toggles one field of
 * a valve-controller device struct. React port of the valve-icon subsystem in
 * system-devices.js (setupValveController, setValveField, updateValveImage,
 * updateSwitchRotation).
 */

import { useCallback, useRef } from 'react'
import { useAppStore, getParamValue } from '../../store/appStore'
import { api } from '../../api/client'
import { appConfirm } from '../../store/dialogStore'
import { useEditorStore } from '../../store/editorStore'
import { getSwitchSvg, getValveSvg } from './valveAssets'
import { toNumeric } from './deviceUtils'
import { useCanvasDrag } from '../editor/useCanvasDrag'
import { ContactPoints } from '../editor/ContactPoints'

interface ValveIconProps {
  device: string
  field: string
  isConfigure: boolean
  left?: number
  top?: number
  width?: number
  height?: number
  rotationDegrees?: string
  layoutChoices?: {
    closedSvg?: string
    openSvg?: string
    switchSvg?: string
    switchClosedSvg?: string
    switchOpenSvg?: string
  }
  onRemove?: (iconId: string) => void
  /** Persist geometry changes (configure mode). */
  onGeometryChange?: (iconId: string, geo: { left: number; top: number; width?: number; height?: number }) => void
}

/** Merge one field into the current struct and send the whole struct as target. */
async function setValveField(device: string, fieldName: string, value: number): Promise<void> {
  const values = useAppStore.getState().latestValues
  let currentStruct: Record<string, unknown> = {}
  const valueEntry = getParamValue(values, device, 'value')
  const targetEntry = getParamValue(values, device, 'target')
  if (valueEntry?.value && typeof valueEntry.value === 'object') {
    currentStruct = { ...(valueEntry.value as Record<string, unknown>) }
  } else if (targetEntry?.value && typeof targetEntry.value === 'object') {
    currentStruct = { ...(targetEntry.value as Record<string, unknown>) }
  }
  currentStruct[fieldName] = value

  // The new frontend always goes through the REST write endpoint (no Spin socket).
  await api.writeDeviceParameter(device, 'target', currentStruct)
}

export function ValveIcon({
  device,
  field,
  isConfigure,
  left,
  top,
  width,
  height,
  rotationDegrees,
  layoutChoices,
  onRemove,
  onGeometryChange,
}: ValveIconProps) {
  const latestValues = useAppStore((s) => s.latestValues)
  const iconRef = useRef<HTMLDivElement>(null)
  const setSelected = useEditorStore((s) => s.setSelected)
  const iconId = `icon-${device}_${field}`

  useCanvasDrag(iconRef, {
    enabled: isConfigure,
    minWidth: 40,
    minHeight: 60,
    onDragEnd: (r) => onGeometryChange?.(iconId, r),
    onResizeEnd: (r) => onGeometryChange?.(iconId, r),
  })

  const isSwitch = field.toLowerCase().includes('switch')

  const valueEntry = getParamValue(latestValues, device, 'value')
  const targetEntry = getParamValue(latestValues, device, 'target')
  let rawValue: unknown
  if (valueEntry?.value && typeof valueEntry.value === 'object' && field in (valueEntry.value as object)) {
    rawValue = (valueEntry.value as Record<string, unknown>)[field]
  } else if (targetEntry?.value && typeof targetEntry.value === 'object' && field in (targetEntry.value as object)) {
    rawValue = (targetEntry.value as Record<string, unknown>)[field]
  }
  const currentValue = toNumeric(rawValue)
  const isOpen = currentValue === 1

  const src = isSwitch ? getSwitchSvg(device, field, isOpen, layoutChoices) : getValveSvg(device, field, isOpen, layoutChoices)

  const iconWidth = width ?? 80
  const iconHeight = height ?? 100
  const imgSize = Math.max(40, Math.min(iconWidth, iconHeight - 20))

  const toggle = useCallback(async () => {
    if (isConfigure) return
    const newValue = currentValue === 1 ? 0 : 1
    const subject = isSwitch ? 'switch' : 'valve'
    const action = newValue === 1 ? 'on' : 'off'
    const confirmed = await appConfirm(
      `Do you want to switch ${subject} ${field} for ${device} ${action}?`,
      'Confirm Valve Change',
    )
    if (!confirmed) return
    try {
      await setValveField(device, field, newValue)
    } catch {
      /* write failures surface via live update absence */
    }
  }, [isConfigure, currentValue, isSwitch, field, device])

  const handleDoubleClick = useCallback(() => {
    if (isConfigure) onRemove?.(`icon-${device}_${field}`)
  }, [isConfigure, onRemove, device, field])

  return (
    <div
      ref={iconRef}
      className={`valve-icon${isConfigure ? ' configure-layout' : ''}`}
      id={iconId}
      data-device={device}
      data-field={field}
      data-open={isOpen ? '1' : '0'}
      style={{
        position: 'absolute',
        width: iconWidth,
        height: iconHeight,
        top: top ?? 20,
        left: left ?? 20,
        cursor: 'pointer',
        userSelect: 'none',
        overflow: 'visible',
        zIndex: 20,
      }}
      onMouseDown={() => {
        if (isConfigure) setSelected(iconId)
      }}
      onClick={() => void toggle()}
      onDoubleClick={handleDoubleClick}
    >
      <div
        id={`img-${device}_${field}`}
        style={{ width: imgSize, height: imgSize, position: 'relative', transform: `rotate(${Number(rotationDegrees || 0)}deg)` }}
      >
        <img
          id={`valve-img-${device}_${field}`}
          src={src}
          alt={field}
          style={{ width: '100%', height: '100%', objectFit: 'contain', transition: 'transform 0.3s ease' }}
          draggable={false}
        />
      </div>
      <div style={{ fontSize: 10, color: '#333', textAlign: 'center', marginTop: 4, fontWeight: 600 }}>{field}</div>
      {isConfigure && (
        <>
          <div
            className="deco-remove"
            style={{ position: 'absolute', top: -8, right: -8, cursor: 'pointer', zIndex: 30 }}
            onClick={(e) => {
              e.stopPropagation()
              onRemove?.(iconId)
            }}
          >
            &times;
          </div>
          <div
            className="resize-handle"
            title="Resize"
            style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, background: '#007bff', cursor: 'nwse-resize', borderRadius: 2, opacity: 0.7, display: 'flex' }}
          />
          <ContactPoints boxId={iconId} geometry={{ left: left ?? 20, top: top ?? 20, width: iconWidth, height: iconHeight }} visible={isConfigure} />
        </>
      )}
    </div>
  )
}

/**
 * Expand a valve-controller device into one icon per valve/switch field of its
 * struct value (legacy setupValveController field heuristics).
 */
export function valveFieldsOf(valueData: unknown): string[] {
  if (!valueData || typeof valueData !== 'object') return []
  return Object.keys(valueData as Record<string, unknown>).filter((fieldName) => {
    const lowerField = fieldName.toLowerCase()
    const isSwitch = lowerField.includes('switch')
    const isValve =
      lowerField.includes('valve') ||
      fieldName.startsWith('V') ||
      fieldName.startsWith('C') ||
      fieldName.startsWith('H')
    return isSwitch || isValve
  })
}
