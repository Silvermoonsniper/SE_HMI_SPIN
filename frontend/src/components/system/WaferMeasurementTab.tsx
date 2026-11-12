import { useId, useMemo, useRef, useState } from 'react'
import { shallow } from 'zustand/shallow'
import type { DeviceParamsMap, LayoutDecorationEntry, WaferMeasurementSession } from '../../api/types'
import { useAppStore } from '../../store/appStore'
import { useEditorStore } from '../../store/editorStore'
import { useCanvasDrag } from '../editor/useCanvasDrag'
import { gasFlowReadings, measurementSpots, parseValue, waferSourceOptions } from './waferMeasurement'
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
  const selected = spots.find((spot) => spot.value === settings.selectedSpot) ?? current ?? spots.find((spot) => spot.wafer)
  const wafer = selected?.wafer ?? spots.find((spot) => spot.wafer)?.wafer
  const waferSpots = spots.filter((spot) => spot.wafer && spot.wafer === wafer)
  const config = useMemo(() => parseValue(readings.technique), [readings.technique])
  const sessionKey = selected ? `${spotDevice}:${selected.label}` : ''
  const session = settings.sessions?.[sessionKey]
  const shownConfig = session ? session.techniqueConfig : config
  const configText = useMemo(() => shownConfig === undefined || shownConfig === null || shownConfig === '' ? ''
    : typeof shownConfig === 'string' ? shownConfig : JSON.stringify(shownConfig, null, 2), [shownConfig])
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
  const sourceSelect = (label: string, key: 'spotDevice' | 'gasDevice' | 'potentiostatDevice', value: string, names: string[]) => (
    <label>{label}<select aria-label={label} value={value} onChange={(e) => patchSettings({ [key]: e.target.value, ...(key === 'spotDevice' ? { selectedSpot: undefined } : {}) })}>
      <option value="">Not connected</option>
      {value && !names.includes(value) && <option value={value}>{value} (unavailable)</option>}
      {names.map((name) => <option key={name} value={name}>{name}</option>)}
    </select></label>
  )

  return (
    <div ref={ref} id={decoration.id} data-type="wafer_measurement_tab" aria-label="Wafer measurement tab"
      className={`deco-box wafer-measurement-tab${isConfigure ? ' configure-layout' : ''}${selectedId === decoration.id ? ' selected' : ''}`}
      style={{ position: 'absolute', ...geometry }}
      onMouseDown={() => { if (isConfigure) setSelected(decoration.id) }}>
      <header className="wafer-header">
        <div><span className="wafer-eyebrow">MEASUREMENT</span><h3>Wafer measurement</h3></div>
        <label className="wafer-spot-select control-section">Measurement spot
          <select aria-label="Measurement spot" value={selected?.value ?? ''} disabled={!spots.length} onChange={(e) => selectSpot(e.target.value)}>
            {!spots.length && <option value="">No measurement spot enums available</option>}
            {spots.map((spot) => <option key={spot.value} value={spot.value}>{spot.label}</option>)}
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
          <dl className="wafer-session-info">
            <div><dt>Selected spot</dt><dd>{selected?.label ?? 'No spot selected'}</dd></div>
            <div><dt>Current position</dt><dd>{current?.label ?? 'Not reported'}</dd></div>
            <div><dt>Active technique</dt><dd>{String((session ? session.activeTechnique : readings.activeTechnique) || 'Not reported')}</dd></div>
          </dl>
          <h4>Technique configuration</h4>
          {configText ? <pre className="wafer-technique" aria-label="Technique configuration">{configText}</pre>
            : <p className="wafer-empty">{potentiostatDevice ? 'Waiting for potentiostat configuration…' : 'No potentiostat connected.'}</p>}
          {!gasDevice && <p className="wafer-empty">No gas flow group connected.</p>}
        </section>
        <section className="wafer-map" aria-label="Wafer map">
          <h4>{wafer?.replace(/_/g, ' ') ?? 'Wafer'}</h4>
          <svg viewBox="0 0 320 320" role="group" aria-label="Wafer measurement spots">
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
                <circle r="19" /><text textAnchor="middle" dominantBaseline="central">{spot.spot}</text>
              </g>
            })}
          </svg>
          {!waferSpots.length && <p className="wafer-empty">No measurement spots available.</p>}
          <div className="wafer-legend"><span><i className="wafer-legend-selected" />Selected</span><span><i className="wafer-legend-current" />Current position</span></div>
          <small>Schematic wafer map · {waferSpots.length} measurement spots</small>
        </section>
      </div>
      {isConfigure && <details className="wafer-sources control-section"><summary>Data sources</summary><div>
        {sourceSelect('Measurement spots source', 'spotDevice', spotDevice, options.spots)}
        {sourceSelect('Gas flow group', 'gasDevice', gasDevice, options.gas)}
        {sourceSelect('Potentiostat', 'potentiostatDevice', potentiostatDevice, options.potentiostat)}
      </div></details>}
      {isConfigure && <div className="resize-handle" title="Resize wafer measurement tab" />}
    </div>
  )
}
