import { useId, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'
import type { DeviceParamsMap, LayoutDecorationEntry, WaferMeasurementSession } from '../../api/types'
import { useAppStore } from '../../store/appStore'
import { useEditorStore } from '../../store/editorStore'
import { useCanvasDrag } from '../editor/useCanvasDrag'
import { gasFlowReadings, measurementSpots, parseValue, techniqueRows, waferSourceOptions } from './waferMeasurement'
import { TechniqueDetails } from './TechniqueDetails'
import '../../styles/wafer.css'

interface Props {
  decoration: LayoutDecorationEntry
  isConfigure: boolean
  onGeometryChange: (id: string, geo: { left: number; top: number; width?: number; height?: number }) => void
  onSaveSession: () => Promise<string>
}

const EMPTY_DEVICES: DeviceParamsMap = {}
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 })

export function WaferMeasurementTab({ decoration, isConfigure, onGeometryChange, onSaveSession }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const graphicId = `wafer-${useId().replace(/:/g, '')}`
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const devices = useAppStore((s) => s.deviceParams) ?? EMPTY_DEVICES
  const options = useMemo(() => waferSourceOptions(devices), [devices])
  const settings = decoration.waferMeasurement ?? {}
  const spotDevice = settings.spotDevice ?? options.spots[0] ?? ''
  const gasDevice = settings.gasDevice ?? options.gas[0] ?? ''
  const potentiostatDevice = settings.potentiostatDevice ?? options.potentiostat[0] ?? ''
  const spots = useMemo(() => measurementSpots(devices[spotDevice]), [devices, spotDevice])
  const readings = useAppStore((s) => ({
    ...gasFlowReadings(devices, s.latestValues, gasDevice),
    currentSpot: s.latestValues[`${spotDevice}.value`]?.value,
    technique: s.latestValues[`${potentiostatDevice}._technique_config`]?.value,
    activeTechnique: s.latestValues[`${potentiostatDevice}._active_technique`]?.value,
  }), shallow)
  const selectedId = useEditorStore((s) => s.selectedId)
  const setSelected = useEditorStore((s) => s.setSelected)
  const update = useEditorStore((s) => s.updateDecoration)
  const remove = useEditorStore((s) => s.removeDecoration)
  const patchSettings = (patch: Partial<NonNullable<LayoutDecorationEntry['waferMeasurement']>>) =>
    update(decoration.id, { waferMeasurement: { ...settings, ...patch } })
  const current = spots.find((spot) => spot.value === String(readings.currentSpot) || spot.label === readings.currentSpot)
  const selected = spots.find((spot) => spot.wafer && spot.value === settings.selectedSpot) ?? (current?.wafer ? current : undefined) ?? spots.find((spot) => spot.wafer)
  const wafer = selected?.wafer ?? spots.find((spot) => spot.wafer)?.wafer
  const dimensions = wafer ? settings.waferDimensionsMm?.[wafer] : undefined
  const validDimension = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 20
  const lengthMm = validDimension(dimensions?.length)
  const widthMm = validDimension(dimensions?.width)
  const waferSpots = spots.filter((spot) => spot.wafer && spot.wafer === wafer)
  const waferIds = Array.from(new Set(spots.flatMap((spot) => spot.wafer ? [spot.wafer] : [])))
  const config = useMemo(() => parseValue(readings.technique), [readings.technique])
  const sessionKey = selected ? `${spotDevice}:${selected.label}` : ''
  const session = settings.sessions?.[sessionKey]
  const shownConfig = session ? session.techniqueConfig : config
  const techniques = useMemo(() => techniqueRows(shownConfig), [shownConfig])
  const selectSpot = (value: string) => {
    patchSettings({ selectedSpot: value })
    setSaveMessage('')
  }
  const captureSession = async () => {
    if (!selected?.wafer || readings.argon === null || readings.nitrogen === null || config === undefined || config === null || config === '') return
    setSaving(true)
    setSaveMessage('')
    const captured: WaferMeasurementSession = {
      capturedAt: new Date().toISOString(), spotLabel: selected.label,
      argonFlow: readings.argon, nitrogenFlow: readings.nitrogen, flowUnit: readings.unit,
      techniqueConfig: structuredClone(config), activeTechnique: String(readings.activeTechnique || ''),
      sources: { spotDevice, gasDevice, potentiostatDevice },
    }
    patchSettings({ spotDevice, gasDevice, potentiostatDevice, selectedSpot: selected.value, sessions: { ...settings.sessions, [sessionKey]: captured } })
    try { setSaveMessage(await onSaveSession()) }
    catch { setSaveMessage('Session captured. Save the layout to keep this session.') }
    finally { setSaving(false) }
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
  const flow = (value: number | null) => value === null ? 'Unavailable' : `${number.format(value)} ${session?.flowUnit ?? readings.unit}`.trim()
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
            if (first) selectSpot(first.value)
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
          <div className="wafer-section-title"><h4>Measurement session</h4><span className="wafer-live">{session ? 'Saved' : 'Live preview'}</span></div>
          {session ? <p className="wafer-session-caption">Captured {new Date(session.capturedAt).toLocaleString()}</p>
            : <p className="wafer-session-caption">No saved session for this spot. Capture the current settings below.</p>}
          <button type="button" className="wafer-save-session" disabled={saving || !selected?.wafer || readings.argon === null || readings.nitrogen === null || config === undefined || config === null || config === ''}
            title="Capture the current Ar/N₂ flows and potentiostat configuration"
            onClick={() => void captureSession()}>{saving ? 'Saving…' : session ? 'Update saved session' : 'Save session for this spot'}</button>
          {saveMessage && <p className="wafer-save-message" role="status" aria-label="Session save status">{saveMessage}</p>}
          <div className="wafer-flow-grid">
            <div><span>Argon flow</span><output aria-label="Argon flow">{flow(session?.argonFlow ?? readings.argon)}</output></div>
            <div><span>N₂ flow</span><output aria-label="N2 flow">{flow(session?.nitrogenFlow ?? readings.nitrogen)}</output></div>
          </div>
          <h4>Technique configuration</h4>
          {techniques.length ? <div className="wafer-technique"><table aria-label="Technique configuration">
            <thead><tr><th scope="col">Technique number</th><th scope="col">Name</th><th scope="col">Detailed config</th></tr></thead>
            <tbody>{techniques.map((technique, index) => <tr key={index}>
              <td>{technique.number}</td><td>{technique.name}</td>
              <td><TechniqueDetails key={`${sessionKey}:${technique.number}`} technique={technique} /></td>
            </tr>)}</tbody>
          </table></div>
            : <p className="wafer-empty">{potentiostatDevice ? 'Waiting for potentiostat configuration…' : 'No potentiostat connected.'}</p>}
          {!gasDevice && <p className="wafer-empty">No gas flow group connected.</p>}
        </section>
        <section className="wafer-map" aria-label="Wafer map">
          <h4>{wafer?.replace(/_/g, ' ') ?? 'Wafer'}</h4>
          <div className="wafer-dimensions" role="group" aria-label="Wafer dimensions">
            {dimensionInput('length', 'Length', lengthMm)}
            <span aria-hidden="true">×</span>
            {dimensionInput('width', 'Width', widthMm)}
          </div>
          <svg viewBox="0 0 320 320" role="group" aria-label="Wafer measurement spots"
            onPointerMove={(event) => {
              const svg = event.currentTarget
              const matrix = svg.getScreenCTM()
              if (!matrix) return
              const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
              const x = (point.x - 160) / 142, y = (160 - point.y) / 142
              setCursor(x * x + y * y <= 1 ? { x, y } : null)
            }} onPointerLeave={() => setCursor(null)}>
            <defs>
              <radialGradient id={`${graphicId}-fill`} cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#edf6fc" /><stop offset="1" stopColor="#c0d3e2" /></radialGradient>
              <clipPath id={`${graphicId}-clip`}><circle cx="160" cy="160" r="142" /></clipPath>
            </defs>
            <circle cx="160" cy="160" r="142" fill={`url(#${graphicId}-fill)`} stroke="#7e9ab1" strokeWidth="2" />
            <g clipPath={`url(#${graphicId}-clip)`} stroke="#a4bacb" strokeWidth="0.5" opacity="0.45">
              {[40, 80, 120, 160, 200, 240, 280].map((n) => <g key={n}><path d={`M ${n} 0 V 320`} /><path d={`M 0 ${n} H 320`} /></g>)}
            </g>
            <path d="M 148 303 L 160 290 L 172 303 Z" fill="#f5f8fb" stroke="#7e9ab1" />
            {waferSpots.map((spot, index) => {
              const radius = waferSpots.length < 2 ? 0 : 106 * Math.sqrt(index / (waferSpots.length - 1))
              const angle = index * 2.3999632297 - Math.PI / 2
              const x = 160 + radius * Math.cos(angle), y = 160 + radius * Math.sin(angle)
              const active = selected?.value === spot.value
              const atPosition = current?.value === spot.value
              return <g key={spot.value} role="button" tabIndex={0} aria-label={spot.label} aria-pressed={active}
                className={`wafer-spot${active ? ' is-selected' : ''}${atPosition ? ' is-current' : ''}`}
                transform={`translate(${x}, ${y})`} onClick={() => selectSpot(spot.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectSpot(spot.value) } }}>
                <title>{spot.label}{atPosition ? ' · Current position' : ''}</title>
                <circle className="wafer-spot-hit" r="12" />
                <circle className="wafer-spot-dot" r="2" />
              </g>
            })}
          </svg>
          <output className="wafer-coordinates" aria-label="Cursor coordinates">{cursor
              ? `X: ${number.format(Math.abs(cursor.x * lengthMm / 2) < 0.0005 ? 0 : cursor.x * lengthMm / 2)} mm · Y: ${number.format(Math.abs(cursor.y * widthMm / 2) < 0.0005 ? 0 : cursor.y * widthMm / 2)} mm`
              : 'Move the pointer over the wafer'}</output>
          <small>Coordinates: mm · centre (0, 0) · +X right, +Y up</small>
          {!waferSpots.length && <p className="wafer-empty">No measurement spots available.</p>}
          <div className="wafer-legend"><span><i className="wafer-legend-selected" />Selected</span><span><i className="wafer-legend-current" />Live spot</span></div>
          <small>Schematic wafer map · {waferSpots.length} measurement spots</small>
        </section>
      </div>
      {isConfigure && <div className="resize-handle" title="Resize wafer measurement tab" />}
    </div>
  )
}
