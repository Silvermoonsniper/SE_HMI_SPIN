import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { WaferMeasurementSession } from '../../api/types'
import { techniqueRows } from './waferMeasurement'
import { TechniqueDetails } from './TechniqueDetails'

interface Props {
  preview: WaferMeasurementSession
  existing?: WaferMeasurementSession
  names: string[]
  onClose: () => void
  onAdd: (session: WaferMeasurementSession) => Promise<void>
}

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 })

export function AddSessionSpotDialog({ preview, existing, names, onClose, onAdd }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [name, setName] = useState(existing?.spotLabel ?? preview.spotLabel)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const techniques = techniqueRows(preview.techniqueConfig)
  const flow = (value: number | null) => value === null ? 'Unavailable' : `${number.format(value)} ${preview.flowUnit}`.trim()

  useEffect(() => {
    const dialog = ref.current
    const trigger = document.activeElement as HTMLElement | null
    dialog?.showModal()
    dialog?.querySelector<HTMLInputElement>('input')?.select()
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus() }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (adding || existing) return
    const label = name.trim()
    if (!label) { setError('Enter a spot name.'); return }
    if (names.some((current) => current.toLowerCase() === label.toLowerCase())) {
      setError('This wafer already has a session spot with that name. Choose another name.')
      return
    }
    setAdding(true)
    setError('')
    try { await onAdd({ ...preview, spotLabel: label }) }
    catch (err) { setError(err instanceof Error ? err.message : String(err)) }
    finally { setAdding(false) }
  }

  return createPortal(<dialog ref={ref} className="wafer-technique-editor wafer-add-spot-dialog" aria-labelledby="add-session-spot-title"
    onCancel={(event) => { event.preventDefault(); if (!adding) onClose() }}
    onClick={(event) => { if (event.target === event.currentTarget && !adding) onClose() }}>
    <form onSubmit={(event) => void submit(event)}>
      <header><h3 id="add-session-spot-title">Add spot to measurement session</h3><p>{preview.waferId}</p></header>
      <div className="wafer-technique-editor-fields">
        <label><span>Spot name</span><input aria-label="Spot name" value={name} required maxLength={100} disabled={adding || !!existing} onChange={(event) => setName(event.target.value)} /></label>
        <dl className="wafer-spot-preview">
          <div><dt>X (mm)</dt><dd><output aria-label="Spot X (mm)">{number.format(preview.coordinatesMm?.x ?? 0)}</output></dd></div>
          <div><dt>Y (mm)</dt><dd><output aria-label="Spot Y (mm)">{number.format(preview.coordinatesMm?.y ?? 0)}</output></dd></div>
          <div><dt>{preview.flowSource === 'target' ? 'Argon target flow' : 'Argon measured flow'}</dt><dd>{flow(preview.argonFlow)}</dd></div>
          <div><dt>{preview.flowSource === 'target' ? 'N₂ target flow' : 'N₂ measured flow'}</dt><dd>{flow(preview.nitrogenFlow)}</dd></div>
        </dl>
        <h4>Technique settings</h4>
        {techniques.length ? <ul className="wafer-preview-techniques">{techniques.map((technique) => <li key={technique.queueIndex}>
          <span>{technique.number} · {technique.name}</span><TechniqueDetails technique={technique} />
        </li>)}</ul> : <p>No technique configuration is available.</p>}
        <p className="wafer-session-caption">Coordinates are relative to the wafer centre on the schematic map.</p>
        {existing && <p role="status">This spot is already in the measurement session.</p>}
        {error && <p className="wafer-technique-editor-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" disabled={adding} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={adding || !!existing}>{adding ? 'Adding…' : 'Add to measurement session'}</button></footer>
    </form>
  </dialog>, document.body)
}
