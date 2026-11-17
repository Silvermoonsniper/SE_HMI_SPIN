import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api/client'
import { getParamValue, useAppStore } from '../../store/appStore'
import { fetchAndMergeLatestValuesOnce, getParamInfoMap, hydrateDeviceFromNode } from './deviceUtils'

interface FieldInfo {
  type?: string
  members?: Record<string, FieldInfo | number> | FieldInfo[] | string[]
  min?: number
  max?: number
  minlen?: number
  maxlen?: number
  unit?: string
  [key: string]: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Render compound settings recursively, so users never need to enter a JSON object. */
function SettingField({ name, info = {}, value, onChange, flowRateUnit }: {
  name: string; info?: FieldInfo; value: unknown; onChange: (value: unknown) => void; flowRateUnit?: string
}) {
  const type = info.type || (Array.isArray(value) ? 'array' : typeof value === 'object' && value !== null ? 'struct'
    : typeof value === 'number' ? 'double' : typeof value === 'boolean' ? 'bool' : 'string')
  if (type === 'struct') {
    const fields = record(info.members) as Record<string, FieldInfo>
    const current = record(value)
    const keys = Array.from(new Set([...Object.keys(fields), ...Object.keys(current)]))
    return <fieldset><legend>{name}</legend>
      {keys.length === 0 && <p>No fields are available for this setting.</p>}
      {keys.map((key) => <SettingField key={key} name={key} info={fields[key]} value={current[key]} flowRateUnit={flowRateUnit}
        onChange={(next) => onChange({ ...current, [key]: next })} />)}
    </fieldset>
  }
  if (type === 'array' || type === 'tuple') {
    const current = Array.isArray(value) ? value : []
    const tupleFields = type === 'tuple' && Array.isArray(info.members) ? info.members as FieldInfo[] : []
    const length = Math.max(current.length, tupleFields.length, info.minlen || 0)
    const isFlowRate = /^(?:calibration[:_])?target_array$/i.test(name)
    const arrayName = isFlowRate ? 'calibration_flow_rate' : name
    const unit = info.unit || (isFlowRate ? flowRateUnit : undefined)
    return <fieldset><legend>{arrayName}{unit ? ` (${unit})` : ''}</legend>
      {Array.from({ length }, (_, index) => <div className="calibration-array-item" key={index}>
        <SettingField name={`${arrayName} ${index + 1}`} value={current[index]} flowRateUnit={flowRateUnit}
          info={type === 'tuple' ? tupleFields[index] : { unit, ...info.members as FieldInfo | undefined }}
          onChange={(next) => { const updated = Array.from({ length }, (_, i) => current[i]); updated[index] = next; onChange(updated) }} />
        {type === 'array' && length > (info.minlen || 0) && <button type="button" aria-label={`Remove ${arrayName} ${index + 1}`}
          onClick={() => onChange(current.filter((_, i) => i !== index))}>Remove</button>}
      </div>)}
      {type === 'array' && length < (info.maxlen ?? Infinity) && <button type="button"
        onClick={() => onChange([...Array.from({ length }, (_, i) => current[i]), ''])}>Add item</button>}
    </fieldset>
  }
  const label = `${name}${info.unit ? ` (${info.unit})` : ''}`
  if (type === 'bool') return <label className="calibration-setting-input"><span>{label}</span>
    <select required value={typeof value === 'boolean' ? String(value) : ''} onChange={(event) => onChange(event.target.value === 'true')}>
      <option value="" disabled>Select…</option><option value="true">True</option><option value="false">False</option>
    </select></label>
  if (type === 'enum') {
    const members = info.members || {}
    const options = Array.isArray(members) ? members.map((member) => [String(member), member] as const) : Object.entries(members)
    return <label className="calibration-setting-input"><span>{label}</span>
      <select required value={value === undefined ? '' : String(value)} onChange={(event) => {
        const selected = options.find(([key, val]) => String(typeof value === 'string' ? key : val) === event.target.value)
        onChange(selected ? typeof value === 'string' ? selected[0] : selected[1] : event.target.value)
      }}>
        <option value="" disabled>Select…</option>
        {options.map(([key, val]) => <option key={key} value={String(typeof value === 'string' ? key : val)}>{key}</option>)}
      </select></label>
  }
  const numeric = ['double', 'scaled', 'int'].includes(type)
  return <label className="calibration-setting-input"><span>{label}</span>
    <input type={numeric ? 'number' : 'text'} required={numeric} min={info.min} max={info.max}
      step={type === 'int' ? 1 : 'any'} value={value === undefined || value === null ? '' : String(value)}
      onChange={(event) => onChange(numeric && event.target.value !== '' ? Number(event.target.value) : event.target.value)} />
  </label>
}

export function CalibrationSettingsDialog({ device, displayName, params, onClose }: {
  device: string; displayName: string; params: string[]; onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dirty = useRef(false)
  const deviceParams = useAppStore((state) => state.deviceParams)
  const info = deviceParams?.[device]
  const metadata = { ...info?.accessibles, ...getParamInfoMap(info) }
  const [param, setParam] = useState(() => params.find((key) => /settings?|config/i.test(key)) || params[0] || '')
  const readCurrent = (key: string) => getParamValue(useAppStore.getState().latestValues, device, key)?.value
  const [draft, setDraft] = useState(() => readCurrent(param))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const writable = !!param && !!info?.params?.includes(param) && metadata[param]?.readonly !== true
  // Older calibration schemas omit units on target_array. Use the selected
  // calibration device's advertised target unit instead of assuming a flow unit.
  const fields = record(metadata[param]?.datainfo?.members)
  const deviceMembers = record(record(fields.calibrate_device).members)
  const selectedDevice = record(draft).calibrate_device
  const selectedName = typeof selectedDevice === 'string' ? selectedDevice
    : Object.keys(deviceMembers).find((key) => deviceMembers[key] === selectedDevice)
  const source = selectedName ? Object.entries(deviceParams || {}).find(([key, entry]) =>
    key === selectedName || entry.module_name === selectedName || entry.original_name === selectedName)?.[1] : undefined
  const sourceMetadata = { ...source?.accessibles, ...getParamInfoMap(source) }
  const flowRateUnit = sourceMetadata.target?.datainfo?.unit || sourceMetadata.value?.datainfo?.unit

  useEffect(() => {
    const dialog = dialogRef.current
    const trigger = document.activeElement as HTMLElement | null
    dialog?.showModal()
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus() }
  }, [])

  useEffect(() => {
    let active = true
    void fetchAndMergeLatestValuesOnce().then(() => hydrateDeviceFromNode(device)).then(() => {
      if (active && !dirty.current) setDraft(readCurrent(param))
    }).catch(() => undefined)
    return () => { active = false }
  }, [device, param])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!writable || saving || draft === undefined) return
    setSaving(true)
    setError('')
    try {
      await api.writeDeviceParameter(device, param, draft)
      void fetchAndMergeLatestValuesOnce().catch(() => undefined)
      onClose()
    } catch (err) {
      setError(`Could not save calibration settings: ${err instanceof Error ? err.message : String(err)}`)
    } finally { setSaving(false) }
  }

  return createPortal(<dialog ref={dialogRef} className="calibration-settings-dialog" aria-label={`${displayName} — Calibration settings`}
    onCancel={(event) => { event.preventDefault(); if (!saving) onClose() }}>
    <form onSubmit={(event) => void submit(event)}>
      <h3>Calibration settings</h3><p>{displayName}</p>
      {params.length > 1 && <label className="calibration-setting-input"><span>Setting</span>
        <select disabled={saving} value={param} onChange={(event) => {
          dirty.current = false; setParam(event.target.value); setDraft(readCurrent(event.target.value)); setError('')
        }}>{params.map((key) => <option key={key} value={key}>{key}</option>)}</select>
      </label>}
      <fieldset disabled={saving || !writable} className="calibration-settings-fields">
        {param ? <SettingField name={param} info={metadata[param]?.datainfo as FieldInfo | undefined} value={draft} flowRateUnit={flowRateUnit}
          onChange={(value) => { dirty.current = true; setDraft(value) }} /> : <p>No calibration settings available.</p>}
      </fieldset>
      {param && !writable && <p>This setting is read-only.</p>}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={saving || !writable || draft === undefined}>{saving ? 'Saving…' : 'Save settings'}</button></footer>
    </form>
  </dialog>, document.body)
}
