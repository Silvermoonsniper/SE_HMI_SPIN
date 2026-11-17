import { useId, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'
import type { DeviceParamsMap, LayoutDecorationEntry, WaferMeasurementSession } from '../../api/types'
import { useAppStore } from '../../store/appStore'
import { useEditorStore } from '../../store/editorStore'
import { useCanvasDrag } from '../editor/useCanvasDrag'
import { gasFlowReadings, measurementSpots, parseValue, techniqueRows, waferSourceOptions, type GasKind, type TechniqueRow } from './waferMeasurement'
import { TechniqueDetails } from './TechniqueDetails'
import { TechniqueEditor } from './TechniqueEditor'
import { GasFlowEditor } from './GasFlowEditor'
import { RemoveTechniqueDialog } from './RemoveTechniqueDialog'
import { AddSessionSpotDialog } from './AddSessionSpotDialog'
import '../../styles/wafer.css'

interface Props {
  decoration: LayoutDecorationEntry
  isConfigure: boolean
  onGeometryChange: (id: string, geo: { left: number; top: number; width?: number; height?: number }) => void
  onSaveSession: () => Promise<string>
}

const EMPTY_DEVICES: DeviceParamsMap = {}
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 })
const WAFER_LEFT_EDGE = 45
const waferCutHalfHeight = Math.sqrt(142 ** 2 - (160 - WAFER_LEFT_EDGE) ** 2)
const WAFER_OUTLINE = `M ${WAFER_LEFT_EDGE} ${160 - waferCutHalfHeight} A 142 142 0 1 1 ${WAFER_LEFT_EDGE} ${160 + waferCutHalfHeight} Z`

export function WaferMeasurementTab({ decoration, isConfigure, onGeometryChange, onSaveSession }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const graphicId = `wafer-${useId().replace(/:/g, '')}`
  const [editing, setEditing] = useState<TechniqueRow | null>(null)
  const [removing, setRemoving] = useState<{ device: string; technique: TechniqueRow } | null>(null)
  const [editingGas, setEditingGas] = useState<{ gas: GasKind; device: string } | null>(null)
  const [flowMessage, setFlowMessage] = useState('')
  const [editMessage, setEditMessage] = useState('')
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [addingSpot, setAddingSpot] = useState<{ preview: WaferMeasurementSession; existingKey?: string } | null>(null)
  const [sessionMessage, setSessionMessage] = useState('')
  const devices = useAppStore((s) => s.deviceParams) ?? EMPTY_DEVICES
  const options = useMemo(() => waferSourceOptions(devices), [devices])
  const settings = decoration.waferMeasurement ?? {}
  const spotDevice = settings.spotDevice ?? options.spots[0] ?? ''
  const gasDevice = settings.gasDevice ?? options.gas[0] ?? ''
  const potentiostatDevice = settings.potentiostatDevice ?? options.potentiostat[0] ?? ''
  const readings = useAppStore((s) => ({
    ...gasFlowReadings(devices, s.latestValues, gasDevice),
    currentSpot: s.latestValues[`${spotDevice}.value`]?.value,
    targetSpot: s.latestValues[`${spotDevice}.target`]?.value,
    technique: s.latestValues[`${potentiostatDevice}._technique_config`]?.value,
    techniqueState: s.latestValues[`${potentiostatDevice}._technique_config`]?.state,
    techniqueError: s.latestValues[`${potentiostatDevice}._technique_config`]?.state_str,
    activeTechnique: s.latestValues[`${potentiostatDevice}._active_technique`]?.value,
  }), shallow)
  const spots = useMemo(() => measurementSpots(devices[spotDevice], [readings.currentSpot, readings.targetSpot]),
    [devices, spotDevice, readings.currentSpot, readings.targetSpot])
  const selectedId = useEditorStore((s) => s.selectedId)
  const setSelected = useEditorStore((s) => s.setSelected)
  const update = useEditorStore((s) => s.updateDecoration)
  const remove = useEditorStore((s) => s.removeDecoration)
  const patchSettings = (patch: Partial<NonNullable<LayoutDecorationEntry['waferMeasurement']>>) =>
    update(decoration.id, { waferMeasurement: { ...settings, ...patch } })
  const current = spots.find((spot) => spot.value === String(readings.currentSpot) || spot.label === readings.currentSpot)
  const selected = spots.find((spot) => spot.wafer && spot.value === settings.selectedSpot) ?? (current?.wafer ? current : undefined) ?? spots.find((spot) => spot.wafer)
  const sessionSpots = Object.entries(settings.sessions ?? {})
  const selectedSession = settings.selectedSessionSpot ? settings.sessions?.[settings.selectedSessionSpot] : undefined
  const wafer = selectedSession?.waferId ?? settings.selectedWaferId ?? selected?.wafer
    ?? sessionSpots.find(([, session]) => session.waferId)?.[1].waferId
  const dimensions = wafer ? settings.waferDimensionsMm?.[wafer] : undefined
  const validDimension = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 20
  const lengthMm = validDimension(dimensions?.length)
  const widthMm = validDimension(dimensions?.width)
  const waferSpots = spots.filter((spot) => spot.wafer && spot.wafer === wafer)
    .sort((a, b) => a.spot.localeCompare(b.spot, undefined, { numeric: true }))
  const waferIds = Array.from(new Set([...spots.flatMap((spot) => spot.wafer ? [spot.wafer] : []),
    ...sessionSpots.flatMap(([, session]) => session.waferId ? [session.waferId] : [])]))
  const config = useMemo(() => parseValue(readings.technique), [readings.technique])
  const sessionKey = selected ? `${spotDevice}:${selected.label}` : ''
  const techniques = useMemo(() => techniqueRows(config), [config])
  const techniqueFailed = String(readings.techniqueState ?? '').replace(/^State\./i, '').toLowerCase() === 'error'
  const techniqueMessage = !potentiostatDevice ? 'No potentiostat connected.'
    : techniqueFailed ? `Cannot read potentiostat configuration${readings.techniqueError ? `: ${readings.techniqueError}` : '.'}`
    : readings.technique === undefined || readings.technique === null ? 'Waiting for potentiostat configuration…'
    : 'No techniques configured.'
  const selectSpot = (value: string) => {
    patchSettings({ selectedSpot: value, selectedSessionSpot: undefined })
    setEditMessage('')
  }
  const waferPoint = (svg: SVGSVGElement, clientX: number, clientY: number) => {
    const matrix = svg.getScreenCTM()
    if (!matrix) return null
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
    const x = (point.x - 160) / 142, y = (160 - point.y) / 142
    return point.x >= WAFER_LEFT_EDGE && x * x + y * y <= 1 ? { x, y } : null
  }
  const openSpotWindow = (x: number, y: number) => {
    if (!wafer) return
    const coordinatesMm = { x: Math.round(x * lengthMm / 2 * 1000) / 1000 || 0, y: Math.round(y * widthMm / 2 * 1000) / 1000 || 0 }
    const existing = sessionSpots.find(([, entry]) => entry.waferId === wafer && entry.coordinatesMm
      && Math.abs(entry.coordinatesMm.x - coordinatesMm.x) < 0.001 && Math.abs(entry.coordinatesMm.y - coordinatesMm.y) < 0.001)
    setSessionMessage('')
    if (existing) {
      patchSettings({ selectedSessionSpot: existing[0] })
      setAddingSpot({ preview: structuredClone(existing[1]), existingKey: existing[0] })
      return
    }
    const latest = useAppStore.getState().latestValues
    const targets = gasFlowReadings(devices, latest, gasDevice, 'target')
    const targetAvailable = targets.argon !== null && targets.nitrogen !== null
    const flows = targetAvailable ? targets : gasFlowReadings(devices, latest, gasDevice)
    const names = sessionSpots.filter(([, entry]) => entry.waferId === wafer).map(([, entry]) => entry.spotLabel.toLowerCase())
    let index = waferSpots.length + names.length + 1
    while (names.includes(`spot ${index}`)) index += 1
    setAddingSpot({ preview: {
      capturedAt: new Date().toISOString(), spotLabel: `Spot ${index}`, waferId: wafer, coordinatesMm,
      positionSource: 'clicked', flowSource: targetAvailable ? 'target' : 'measured',
      argonFlow: flows.argon, nitrogenFlow: flows.nitrogen, flowUnit: flows.unit,
      techniqueConfig: structuredClone(parseValue(latest[`${potentiostatDevice}._technique_config`]?.value) ?? null),
      activeTechnique: String(latest[`${potentiostatDevice}._active_technique`]?.value ?? ''),
      sources: { spotDevice, gasDevice, potentiostatDevice },
    } })
  }
  const addSessionSpot = async (session: WaferMeasurementSession) => {
    const editor = useEditorStore.getState()
    const currentSettings = editor.decorations.find((entry) => entry.id === decoration.id)?.waferMeasurement ?? {}
    const sessions = currentSettings.sessions ?? {}
    if (Object.values(sessions).some((entry) => entry.waferId === session.waferId && entry.coordinatesMm
      && entry.coordinatesMm.x === session.coordinatesMm?.x && entry.coordinatesMm.y === session.coordinatesMm?.y)) {
      throw new Error('This spot is already in the measurement session.')
    }
    const id = `custom:${crypto.randomUUID()}`
    editor.updateDecoration(decoration.id, { waferMeasurement: { ...currentSettings, selectedSessionSpot: id, sessions: { ...sessions, [id]: session } } })
    const message = await onSaveSession()
    setAddingSpot(null)
    setSessionMessage(message)
  }
  const geometry = {
    left: parseFloat(decoration.left) || 0, top: parseFloat(decoration.top) || 0,
    width: parseFloat(decoration.width) || 780, height: parseFloat(decoration.height) || 640,
  }
  useCanvasDrag(ref, {
    enabled: isConfigure, minWidth: 620, minHeight: 430,
    onDragEnd: (geo) => {
      update(decoration.id, { left: `${geo.left}px`, top: `${geo.top}px` })
      onGeometryChange(decoration.id, geo)
    },
    onResizeEnd: (geo) => {
      update(decoration.id, { width: `${geo.width}px`, height: `${geo.height}px` })
      onGeometryChange(decoration.id, geo)
    },
  })
  const flow = (value: number | null) => value === null ? 'Unavailable' : `${number.format(value)} ${readings.unit}`.trim()
  const dimensionInput = (key: 'length' | 'width', label: string, value: number) => (
    <label>{label} (mm)<input type="number" aria-label={`Wafer ${key} (mm)`} min="0.001" step="any" disabled={!wafer}
      value={value} onChange={(event) => {
        const next = event.currentTarget.valueAsNumber
        if (!wafer || !Number.isFinite(next) || next <= 0) return
        patchSettings({ waferDimensionsMm: {
          ...settings.waferDimensionsMm,
          [wafer]: { length: lengthMm, width: widthMm, [key]: next },
        } })
      }} /></label>
  )

  return (
    <div ref={ref} id={decoration.id} data-type="wafer_measurement_tab" aria-label="Wafer measurement tab"
      className={`deco-box wafer-measurement-tab${isConfigure ? ' configure-layout' : ''}${selectedId === decoration.id ? ' selected' : ''}`}
      style={{ position: 'absolute', ...geometry }}
      onMouseDown={() => { if (isConfigure) setSelected(decoration.id) }}>
      <header className="wafer-header">
        <div><span className="wafer-eyebrow">MEASUREMENT</span><h3>Wafer measurement</h3></div>
        <label className="wafer-spot-select control-section">Wafer ID
          <select aria-label="Wafer ID" value={wafer ?? ''} disabled={!waferIds.length} onChange={(e) => {
            const first = spots.find((spot) => spot.wafer === e.target.value)
            patchSettings({ selectedWaferId: e.target.value, selectedSpot: first?.value, selectedSessionSpot: undefined })
            setCursor(null)
          }}>
            {!waferIds.length && <option value="">No wafer IDs available</option>}
            {waferIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        {isConfigure && <button type="button" className="wafer-remove" aria-label="Remove wafer measurement tab" onClick={() => remove(decoration.id)}>×</button>}
      </header>
      <div className="wafer-body control-section">
        <section className="wafer-session" aria-label="Measurement session">
          <div className="wafer-section-title"><h4>Measurement session</h4><span className="wafer-live">Live</span></div>
          <div className="wafer-flow-grid">
            <div><div className="wafer-flow-heading"><span>Argon flow</span>
              <button type="button" className="wafer-details-button" aria-label="Edit Argon flow" disabled={!gasDevice}
                onClick={() => { setFlowMessage(''); setEditingGas({ gas: 'argon', device: gasDevice }) }}>Edit</button></div>
              <output aria-label="Argon flow">{flow(readings.argon)}</output></div>
            <div><div className="wafer-flow-heading"><span>N₂ flow</span>
              <button type="button" className="wafer-details-button" aria-label="Edit N2 flow" disabled={!gasDevice}
                onClick={() => { setFlowMessage(''); setEditingGas({ gas: 'nitrogen', device: gasDevice }) }}>Edit</button></div>
              <output aria-label="N2 flow">{flow(readings.nitrogen)}</output></div>
          </div>
          {flowMessage && <p className="wafer-save-message" role="status" aria-label="Gas flow edit status">{flowMessage}</p>}
          <h4>Technique configuration</h4>
          {!techniqueFailed && techniques.length ? <div className="wafer-technique"><table aria-label="Technique configuration">
            <thead><tr><th scope="col">Technique number</th><th scope="col">Name</th><th scope="col">Detailed config</th></tr></thead>
            <tbody>{techniques.map((technique, index) => <tr key={index}>
              <td>{technique.number}</td><td>{technique.name}</td>
              <td><div className="wafer-technique-actions"><TechniqueDetails key={`${sessionKey}:${technique.number}`} technique={technique} />
                <button type="button" className="wafer-details-button" aria-label={`Edit technique ${technique.number} ${technique.name}`}
                  onClick={() => { setEditMessage(''); setEditing(technique) }}>Edit</button>
                <button type="button" className="wafer-details-button wafer-remove-technique-button" aria-label={`Remove technique ${technique.number} ${technique.name}`}
                  onClick={() => { setEditMessage(''); setRemoving({ device: potentiostatDevice, technique }) }}>Remove</button>
              </div></td>
            </tr>)}</tbody>
          </table></div>
            : <p className="wafer-empty" role={techniqueFailed ? 'alert' : 'status'}>{techniqueMessage}</p>}
          {!gasDevice && <p className="wafer-empty">No gas flow group connected.</p>}
          {editMessage && <p className="wafer-save-message" role="status" aria-label="Technique edit status">{editMessage}</p>}
          <section className="wafer-session-spots" aria-label="Measurement session spots">
            <h4>Session spots ({sessionSpots.length})</h4>
            {!sessionSpots.length && <p className="wafer-empty">Click the wafer to add a measurement spot.</p>}
            <ol>{sessionSpots.map(([id, session]) => <li key={id}>
              <button type="button" className="wafer-session-spot-name" onClick={() => {
                if (session.waferId) patchSettings({ selectedSessionSpot: id })
                else { const named = spots.find((spot) => spot.label === session.spotLabel); if (named) selectSpot(named.value) }
              }}>{session.spotLabel}</button>
              <span>{session.waferId ?? session.spotLabel.match(/^(.*?)_measurement_/)?.[1] ?? 'Wafer'}</span>
              {session.coordinatesMm && <small>X: {number.format(session.coordinatesMm.x)} mm · Y: {number.format(session.coordinatesMm.y)} mm</small>}
              <small>Ar: {session.argonFlow === null ? 'Unavailable' : number.format(session.argonFlow)} · N₂: {session.nitrogenFlow === null ? 'Unavailable' : number.format(session.nitrogenFlow)} {session.flowUnit}</small>
              <details><summary>Saved technique settings</summary><pre>{JSON.stringify(session.techniqueConfig, null, 2)}</pre></details>
            </li>)}</ol>
            {sessionMessage && <p role="status" aria-label="Session spot status" className="wafer-save-message">{sessionMessage}</p>}
          </section>
        </section>
        <section className="wafer-map control-section" aria-label="Wafer map">
          <h4>{wafer?.replace(/_/g, ' ') ?? 'Wafer'}</h4>
          <div className="wafer-dimensions" role="group" aria-label="Wafer dimensions">
            {dimensionInput('length', 'Length', lengthMm)}
            <span aria-hidden="true">×</span>
            {dimensionInput('width', 'Width', widthMm)}
          </div>
          <svg viewBox="0 0 320 320" role="group" aria-label="Wafer measurement spots"
            onClick={(event) => { const point = waferPoint(event.currentTarget, event.clientX, event.clientY); if (point) openSpotWindow(point.x, point.y) }}
            onPointerMove={(event) => {
              setCursor(waferPoint(event.currentTarget, event.clientX, event.clientY))
            }} onPointerLeave={() => setCursor(null)}>
            <defs>
              <radialGradient id={`${graphicId}-fill`} cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#edf6fc" /><stop offset="1" stopColor="#c0d3e2" /></radialGradient>
              <clipPath id={`${graphicId}-clip`}><path d={WAFER_OUTLINE} /></clipPath>
            </defs>
            <path d={WAFER_OUTLINE} fill={`url(#${graphicId}-fill)`} stroke="#7e9ab1" strokeWidth="2" />
            <g clipPath={`url(#${graphicId}-clip)`} stroke="#a4bacb" strokeWidth="0.5" opacity="0.45">
              {[40, 80, 120, 160, 200, 240, 280].map((n) => <g key={n}><path d={`M ${n} 0 V 320`} /><path d={`M 0 ${n} H 320`} /></g>)}
            </g>
            {waferSpots.map((spot, index) => {
              const x = waferSpots.length < 2 ? 160 : 70 + 180 * index / (waferSpots.length - 1)
              const y = 160
              const active = !settings.selectedSessionSpot && selected?.value === spot.value
              const atPosition = current?.value === spot.value
              return <g key={spot.value} role="button" tabIndex={0} aria-label={spot.label} aria-pressed={active}
                className={`wafer-spot${active ? ' is-selected' : ''}${atPosition ? ' is-current' : ''}`}
                transform={`translate(${x}, ${y})`} onClick={() => selectSpot(spot.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSpot(spot.value); openSpotWindow((x - 160) / 142, 0) } }}>
                <title>{spot.label}{atPosition ? ' · Current position' : ''}</title>
                <circle className="wafer-spot-hit" r="12" />
                <circle className="wafer-spot-dot" r="2" />
              </g>
            })}
            {sessionSpots.map(([id, session]) => {
              if (session.waferId !== wafer || !session.coordinatesMm) return null
              const point = { x: session.coordinatesMm.x / (lengthMm / 2), y: session.coordinatesMm.y / (widthMm / 2) }
              const x = 160 + point.x * 142, y = 160 - point.y * 142
              if (x < WAFER_LEFT_EDGE || point.x * point.x + point.y * point.y > 1) return null
              return <g key={id} role="button" tabIndex={0} aria-label={`Session spot ${session.spotLabel}`} aria-pressed={settings.selectedSessionSpot === id}
                className={`wafer-spot wafer-session-spot${settings.selectedSessionSpot === id ? ' is-selected' : ''}`} transform={`translate(${x}, ${y})`}
                onClick={(event) => { event.stopPropagation(); openSpotWindow(point.x, point.y) }}
                onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openSpotWindow(point.x, point.y) } }}>
                <title>{session.spotLabel}</title><circle className="wafer-spot-hit" r="12" /><circle className="wafer-spot-dot" r="3" />
              </g>
            })}
          </svg>
          <output className="wafer-coordinates" aria-label="Cursor coordinates">{cursor
              ? `X: ${number.format(Math.abs(cursor.x * lengthMm / 2) < 0.0005 ? 0 : cursor.x * lengthMm / 2)} mm · Y: ${number.format(Math.abs(cursor.y * widthMm / 2) < 0.0005 ? 0 : cursor.y * widthMm / 2)} mm`
              : 'Move the pointer over the wafer'}</output>
          <small>Coordinates: mm · centre (0, 0) · +X right, +Y up</small>
          {!waferSpots.length && <p className="wafer-empty">No measurement spots available.</p>}
          <div className="wafer-legend"><span><i className="wafer-legend-selected" />Selected</span><span><i className="wafer-legend-current" />Live spot</span><span><i className="wafer-legend-session" />In session</span></div>
          <small>Schematic wafer map · {waferSpots.length} default spots · {sessionSpots.filter(([, session]) => session.waferId === wafer && session.coordinatesMm).length} session spots</small>
        </section>
      </div>
      {isConfigure && <div className="resize-handle" title="Resize wafer measurement tab" />}
      {editing && <TechniqueEditor device={potentiostatDevice} technique={editing} onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); setEditMessage('Parameters saved to the potentiostat queue. The device publishes the configuration when it applies the queue changes.') }} />}
      {editingGas && <GasFlowEditor device={editingGas.device} gas={editingGas.gas} onClose={() => setEditingGas(null)}
        onSaved={() => { setFlowMessage(`${editingGas.gas === 'argon' ? 'Argon' : 'N₂'} target flow updated. Measured flow updates as the gas controller responds.`); setEditingGas(null) }} />}
      {removing && <RemoveTechniqueDialog device={removing.device} technique={removing.technique} onClose={() => setRemoving(null)}
        onRemoved={() => { setRemoving(null); setEditMessage('Technique removed from the saved potentiostat queue. The device publishes the configuration when it applies the queue changes.') }} />}
      {addingSpot && <AddSessionSpotDialog preview={addingSpot.preview} existing={addingSpot.existingKey ? settings.sessions?.[addingSpot.existingKey] : undefined}
        names={sessionSpots.filter(([, session]) => session.waferId === addingSpot.preview.waferId).map(([, session]) => session.spotLabel)}
        onClose={() => setAddingSpot(null)} onAdd={addSessionSpot} />}
    </div>
  )
}
