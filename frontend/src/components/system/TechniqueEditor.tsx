import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api/client'
import { useAppStore } from '../../store/appStore'
import { fetchAndMergeLatestValuesOnce } from './deviceUtils'
import { parameterInfo, techniqueSelector, type TechniqueRow } from './waferMeasurement'

interface Props {
  device: string
  technique: TechniqueRow
  onClose: () => void
  onSaved: () => void
}

function fieldValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

export function TechniqueEditor({ device, technique, onClose, onSaved }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const info = useAppStore((s) => s.deviceParams?.[device])
  const parameters = technique.parameters ?? {}
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, fieldValue(value)])))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const writable = (param: string) => parameterInfo(info, param)?.readonly !== true
    && (info?.params?.includes(param) || parameterInfo(info, param)?.readonly === false)
  const supported = writable('_edit_technique_config') && writable('_edit_technique_target')
  const modified = Object.entries(parameters).some(([key, value]) => draft[key] !== fieldValue(value))

  useEffect(() => {
    const dialog = ref.current
    const trigger = document.activeElement as HTMLElement | null
    dialog?.showModal()
    dialog?.querySelector<HTMLElement>('input, textarea, select')?.focus()
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus() }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!supported || saving || !modified) return
    setError('')
    let patch: Record<string, unknown>
    let selector: { name: string | number; index: number }
    try {
      patch = {}
      for (const [key, original] of Object.entries(parameters)) {
        if (draft[key] === fieldValue(original)) continue
        const raw = draft[key]
        let value: unknown = raw
        if (typeof original === 'number') {
          if (!raw.trim() || !Number.isFinite(Number(raw))) throw new Error(`${key} must be a finite number.`)
          value = Number(raw)
        } else if (typeof original === 'boolean') {
          value = raw === 'true'
        } else if (typeof original !== 'string') {
          try { value = JSON.parse(raw) } catch { throw new Error(`${key} must contain valid JSON.`) }
          if (Array.isArray(original) && !Array.isArray(value)) throw new Error(`${key} must be a JSON array.`)
          if (original && !Array.isArray(original) && (!value || typeof value !== 'object' || Array.isArray(value))) {
            throw new Error(`${key} must be a JSON object.`)
          }
        }
        patch[key] = value
      }
      selector = techniqueSelector(info, '_edit_technique_target', technique,
        useAppStore.getState().latestValues[`${device}._technique_config`]?.value)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return
    }
    setSaving(true)
    try {
      // The device requires staging the JSON parameter patch before selecting the queue entry.
      await api.writeDeviceParameter(device, '_edit_technique_config', JSON.stringify(patch))
      await api.writeDeviceParameter(device, '_edit_technique_target', selector)
      void fetchAndMergeLatestValuesOnce().catch(() => undefined)
      onSaved()
    } catch (err) {
      setError(`Could not apply technique parameters: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(<dialog ref={ref} className="wafer-technique-editor" aria-labelledby="technique-editor-title"
    onCancel={(event) => { event.preventDefault(); if (!saving) onClose() }}
    onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
    <form onSubmit={(event) => void submit(event)}>
      <header><h3 id="technique-editor-title">Edit technique {technique.number} · {technique.name}</h3>
        <p>{device} · Queue position {technique.queueIndex}</p></header>
      <div className="wafer-technique-editor-fields">
        {!supported && <p role="alert">This potentiostat does not expose writable technique-edit parameters.</p>}
        {!Object.keys(parameters).length && <p>No editable parameters are available for this technique.</p>}
        {Object.entries(parameters).map(([key, value]) => <label key={key}>
          <span>{key.replace(/_/g, ' ')}</span>
          {typeof value === 'boolean'
            ? <select aria-label={key} disabled={saving || !supported} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}>
              <option value="true">true</option><option value="false">false</option></select>
            : typeof value === 'object'
              ? <textarea aria-label={key} disabled={saving || !supported} rows={4} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />
              : <input aria-label={key} disabled={saving || !supported} type={typeof value === 'number' ? 'number' : 'text'} step="any"
                required={typeof value === 'number'} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />}
        </label>)}
        {error && <p className="wafer-technique-editor-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={saving || !supported || !modified}>{saving ? 'Saving…' : 'Save parameters'}</button></footer>
    </form>
  </dialog>, document.body)
}
