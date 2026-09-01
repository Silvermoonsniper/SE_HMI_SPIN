/**
 * Device panel — React port of the three legacy device templates
 * (device-template / drivable_device-template / valve-controller-template)
 * and the rendering behavior of applyCachedDeviceState / renderExtra /
 * toggleDeviceBody from system-runtime.js.
 *
 * Live values come from the appStore latestValues cache (fed by /ws).
 * The expand/collapse reflow (pushing overlapping boxes down) is handled by
 * the layout system in Phase 4; in run mode boxes are static.
 */

import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore, getParamValue } from '../../store/appStore'
import type { DeviceInfo } from '../../api/types'
import { useCanvasDrag } from '../editor/useCanvasDrag'
import { ContactPoints } from '../editor/ContactPoints'
import { useEditorStore } from '../../store/editorStore'
import {
  formatLiveValue,
  getParamInfoMap,
  sendCommand,
  sendSelectedParam,
  fetchAndMergeLatestValuesOnce,
  hydrateDeviceFromNode,
} from './deviceUtils'

export type DeviceTemplateKind = 'device' | 'drivable' | 'valve'

interface DeviceBoxProps {
  device: string
  domId: string
  isConfigure: boolean
  left?: number
  top?: number
  width?: number
  height?: number
  onRemove?: (domId: string) => void
  /** Persist geometry changes (configure mode). */
  onGeometryChange?: (domId: string, geo: { left: number; top: number; width?: number; height?: number }) => void
}

/** Status badge classes used by the legacy CSS (state-State.OK etc.). */
function statusBadgeClass(state: string | undefined): string {
  const normalized = (state || 'State.UNKNOWN').replace(/^State\./, '').toLowerCase()
  return `status-badge state-${normalized}`
}

export function DeviceBox({ device, domId, isConfigure, left, top, width, height, onRemove, onGeometryChange }: DeviceBoxProps) {
  const deviceParams = useAppStore((s) => s.deviceParams)
  const latestValues = useAppStore((s) => s.latestValues)
  const boxRef = useRef<HTMLDivElement>(null)
  const setSelected = useEditorStore((s) => s.setSelected)

  useCanvasDrag(boxRef, {
    enabled: isConfigure,
    minWidth: 150,
    minHeight: 80,
    onDragEnd: (r) => onGeometryChange?.(domId, r),
    onResizeEnd: (r) => onGeometryChange?.(domId, r),
  })

  const info: DeviceInfo | null = deviceParams?.[device] ?? null
  const displayName = info?.original_name || info?.module_name || device

  const lowerDev = device.toLowerCase()
  const lowerDisplay = displayName.toLowerCase()
  const isValveController = lowerDisplay.includes('valve_controller') || lowerDev.includes('valve_controller')
  const isSampleMagazine = lowerDisplay.includes('storage') || lowerDev.includes('storage')
  const isSamplePosition = lowerDisplay.includes('sample_at_measurement') || lowerDev.includes('sample_at_measurement')

  const interfaceClasses = Array.isArray(info?.interface_classes) ? info.interface_classes : []
  const isDrivable = interfaceClasses.includes('Drivable')

  const [modalOpen, setModalOpen] = useState(false)
  const [selectedParam, setSelectedParam] = useState('')
  const [paramInput, setParamInput] = useState('')

  // Label + which value segments to show (legacy createDeviceDisplay heuristics)
  let labelText = 'Val'
  let showTarget = false
  let showGas = false
  if (isSamplePosition) {
    labelText = 'current sample'
  }
  if (isDrivable && lowerDev.includes('massflow')) {
    labelText = 'Val / Target / Gas'
    showTarget = true
    showGas = true
  } else if (isDrivable && (lowerDev.includes('backpress') || lowerDev.includes('temp'))) {
    labelText = 'Val / Target'
    showTarget = true
  }

  const statusPayload = getParamValue(latestValues, device, 'status')
  const valPayload = getParamValue(latestValues, device, 'value')
  const targetPayload = getParamValue(latestValues, device, 'target')
  const gasPayload = getParamValue(latestValues, device, '_gastype')

  const paramInfo = getParamInfoMap(info)
  const selectedParamMeta = selectedParam ? paramInfo[selectedParam] : null
  const selectedDatainfo = selectedParamMeta?.datainfo
  const enumMembers = useMemo(() => {
    if (selectedDatainfo?.type !== 'enum') return null
    const members = selectedDatainfo.members
    if (Array.isArray(members)) return members.map(String)
    if (members && typeof members === 'object') return Object.keys(members)
    return null
  }, [selectedDatainfo])

  const selectedCurrent = selectedParam ? getParamValue(latestValues, device, selectedParam) : undefined

  const writableParams = (info?.params ?? []).filter((p) => p !== 'value').sort()
  const commands = (info?.commands ?? []).slice().sort()

  // Extra panel keys: live ∪ all_params, minus value/target (legacy renderExtra)
  const liveKeys = useMemo(
    () =>
      Object.keys(latestValues)
        .filter((k) => k.startsWith(`${device}.`))
        .map((k) => k.slice(device.length + 1)),
    [latestValues, device],
  )
  const extraKeys = useMemo(() => {
    const metadataKeys = Array.isArray(info?.all_params) ? info.all_params : []
    const keys = Array.from(new Set([...liveKeys, ...metadataKeys])).sort()
    return keys.filter((k) => k !== 'value' && k !== 'target')
  }, [liveKeys, info])

  const openModal = () => {
    setModalOpen(true)
    // Refresh values when opening so the read-only list is current.
    fetchAndMergeLatestValuesOnce()
      .then(() => hydrateDeviceFromNode(device))
      .catch(() => undefined)
  }

  const submitParam = async () => {
    const ok = await sendSelectedParam(device, selectedParam, paramInput)
    if (ok) setParamInput('')
  }

  const boxStyle: React.CSSProperties = {
    position: 'absolute',
    left: left ?? 20,
    top: top ?? 20,
    width: width,
    height: height,
    zIndex: 10,
  }

  return (
    <div
      ref={boxRef}
      className={`device-box${isConfigure ? ' configure-layout' : ''}`}
      id={`box-${domId}`}
      data-device={device}
      style={boxStyle}
      onMouseDown={() => {
        if (isConfigure) setSelected(`box-${domId}`)
      }}
    >
      <div className="device-header">
        <div className="device-title">{displayName}</div>
        <div id={`status-${domId}`} className={statusBadgeClass(statusPayload?.state)}>
          <span>{statusPayload ? statusPayload.state_str || String(statusPayload.state || '') : '--'}</span>
        </div>
        <button
          className="close-btn"
          type="button"
          style={{ display: isConfigure ? undefined : 'none' }}
          onClick={() => onRemove?.(domId)}
        >
          &times;
        </button>
      </div>

      {isValveController ? (
        <div id={`valves-container-${domId}`} className="valves-grid" />
      ) : (
        <div className="device-field">
          <div>{labelText}</div>
          <div className="device-value">
            <span id={`val-${domId}`} className="inline-small">
              {formatLiveValue(valPayload?.value, valPayload?.unit)}
            </span>
            <span className="sep-1" style={{ display: showTarget || showGas ? 'inline' : 'none' }}>
              {' '}
              /
            </span>
            <span
              id={`target-${domId}`}
              className="inline-small"
              style={{ display: showTarget || showGas ? 'inline' : 'none' }}
            >
              {formatLiveValue(targetPayload?.value, targetPayload?.unit)}
            </span>
            <span className="sep-2" style={{ display: showGas ? 'inline' : 'none' }}>
              {' '}
              /
            </span>
            <span id={`gas-${domId}`} className="inline-small" style={{ display: showGas ? 'inline' : 'none' }}>
              {formatLiveValue(gasPayload?.value, gasPayload?.unit)}
            </span>
          </div>
        </div>
      )}

      <button
        type="button"
        className="expand-btn set-btn"
        id={`set-btn-${domId}`}
        onClick={openModal}
        title="Set parameters"
      >
        Set
      </button>

      <DeviceParamModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        device={device}
        domId={domId}
        displayName={displayName}
        isValveController={isValveController}
        writableParams={writableParams}
        commands={commands}
        extraKeys={extraKeys}
        latestValues={latestValues}
        paramInfo={paramInfo}
        selectedParam={selectedParam}
        setSelectedParam={setSelectedParam}
        paramInput={paramInput}
        setParamInput={setParamInput}
        enumMembers={enumMembers}
        selectedDatainfo={selectedDatainfo}
        selectedCurrent={selectedCurrent}
        onSubmitParam={submitParam}
        onSendCommand={(cmd) => void sendCommand(device, cmd)}
      />
      {isConfigure && <div className="resize-handle" />}
      <ContactPoints
        boxId={`box-${domId}`}
        geometry={{ left: left ?? 20, top: top ?? 20, width: width ?? 240, height: height ?? 120 }}
        visible={isConfigure}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Parameter modal — popped out by the "Set" button. Contains the writable
// parameter setter, command buttons, and a read-only list of all other
// parameters (the former collapsible device-body / extra panel).
// ---------------------------------------------------------------------------

interface DeviceParamModalProps {
  open: boolean
  onClose: () => void
  device: string
  domId: string
  displayName: string
  isValveController: boolean
  writableParams: string[]
  commands: string[]
  extraKeys: string[]
  latestValues: ReturnType<typeof useAppStore.getState>['latestValues']
  paramInfo: Record<string, ReturnType<typeof getParamInfoMap>[string]>
  selectedParam: string
  setSelectedParam: (p: string) => void
  paramInput: string
  setParamInput: (v: string) => void
  enumMembers: string[] | null
  selectedDatainfo: { type?: string } | null | undefined
  selectedCurrent: { value: unknown; unit: string } | undefined
  onSubmitParam: () => void
  onSendCommand: (cmd: string) => void
}

function DeviceParamModal({
  open,
  onClose,
  device,
  domId,
  displayName,
  isValveController,
  writableParams,
  commands,
  extraKeys,
  latestValues,
  selectedParam,
  setSelectedParam,
  paramInput,
  setParamInput,
  enumMembers,
  selectedDatainfo,
  selectedCurrent,
  onSubmitParam,
  onSendCommand,
}: DeviceParamModalProps) {
  // Refresh live values while the modal is open so the read-only list stays current.
  const latest = useAppStore((s) => s.latestValues)

  if (!open) return null

  // Portal to document.body so the modal renders above the fullscreen GUI layer
  // (requestFullscreen creates a new top layer; in-tree fixed overlays sit behind it).
  return createPortal(
    <div
      className="device-param-modal-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.42)',
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="device-param-modal"
        style={{
          background: '#fff',
          borderRadius: 10,
          boxShadow: '0 18px 40px rgba(15,23,42,0.28)',
          padding: 18,
          minWidth: 460,
          maxWidth: 'min(560px, 92vw)',
          maxHeight: '82vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: '#0f172a' }}>{displayName}</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>

        <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
          {!isValveController && (
            <div className="control-section">
              <div className="control-field">
                <select
                  id={`param-select-${domId}`}
                  className="control-input"
                  aria-label="Parameter"
                  value={selectedParam}
                  onChange={(e) => setSelectedParam(e.target.value)}
                >
                  <option value="">--</option>
                  {writableParams.map((param) => (
                    <option key={param} value={param}>
                      {param}
                    </option>
                  ))}
                </select>
                <div id={`param-input-container-${domId}`} className="param-input-row">
                  {enumMembers ? (
                    <select
                      id={`param-value-${domId}`}
                      className="control-input auto-width-input"
                      value={paramInput}
                      onChange={(e) => setParamInput(e.target.value)}
                    >
                      <option value="">-- select --</option>
                      {enumMembers.map((member) => (
                        <option key={member} value={member}>
                          {member}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      id={`param-value-${domId}`}
                      className="control-input auto-width-input"
                      placeholder={
                        selectedDatainfo?.type === 'array'
                          ? '[1, 2, 3]'
                          : selectedDatainfo?.type === 'tuple' || selectedDatainfo?.type === 'struct'
                            ? '{...}'
                            : 'val'
                      }
                      value={paramInput}
                      onChange={(e) => setParamInput(e.target.value)}
                    />
                  )}
                </div>
                <button className="control-button" type="button" onClick={() => void onSubmitParam()}>
                  Set
                </button>
              </div>
              <div id={`param-current-value-${domId}`} className="param-current">
                {selectedParam ? (
                  selectedCurrent ? (
                    <>
                      Current: <strong>{formatLiveValue(selectedCurrent.value, selectedCurrent.unit)}</strong>
                    </>
                  ) : (
                    <em>Current: (no data)</em>
                  )
                ) : null}
              </div>
            </div>
          )}

          <div
            id={`commands-${domId}`}
            className="commands-section"
            style={{ display: commands.length === 0 ? 'none' : 'flex' }}
          >
            {commands.map((cmd) => (
              <button key={cmd} className="cmd-btn" type="button" title={`Execute ${cmd}`} onClick={() => onSendCommand(cmd)}>
                {cmd}
              </button>
            ))}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', margin: '12px 0 6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Read-only parameters
          </div>
          <div id={`extra-${domId}`} className="extra-panel open" aria-hidden={false}>
            {extraKeys.length === 0 ? (
              <div className="extra-row">
                <em>No additional parameters</em>
              </div>
            ) : (
              extraKeys.map((k) => {
                const entry = getParamValue(latest, device, k)
                return (
                  <div className="extra-row" key={k}>
                    <div>{k}</div>
                    <div>{formatLiveValue(entry?.value, entry?.unit)}</div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
