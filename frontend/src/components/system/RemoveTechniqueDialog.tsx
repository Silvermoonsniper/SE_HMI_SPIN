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
  onRemoved: () => void
}

export function RemoveTechniqueDialog({ device, technique, onClose, onRemoved }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const info = useAppStore((s) => s.deviceParams?.[device])
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState('')
  const meta = parameterInfo(info, '_remove_technique_target')
  const supported = meta?.readonly !== true && (meta?.readonly === false || info?.params?.includes('_remove_technique_target'))

  useEffect(() => {
    const dialog = ref.current
    const trigger = document.activeElement as HTMLElement | null
    dialog?.showModal()
    dialog?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus()
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus() }
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (removing || !supported) return
    setRemoving(true)
    setError('')
    try {
      const config = useAppStore.getState().latestValues[`${device}._technique_config`]?.value
      const selector = techniqueSelector(info, '_remove_technique_target', technique, config)
      await api.writeDeviceParameter(device, '_remove_technique_target', selector)
      void fetchAndMergeLatestValuesOnce().catch(() => undefined)
      onRemoved()
    } catch (err) {
      setError(`Could not remove technique: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRemoving(false)
    }
  }

  return createPortal(<dialog ref={ref} role="alertdialog" className="wafer-technique-editor" aria-labelledby="remove-technique-title" aria-describedby="remove-technique-description"
    onCancel={(event) => { event.preventDefault(); if (!removing) onClose() }}
    onClick={(event) => { if (event.target === event.currentTarget && !removing) onClose() }}>
    <form onSubmit={(event) => void submit(event)}>
      <header><h3 id="remove-technique-title">Remove technique {technique.number} · {technique.name}</h3>
        <p>{device} · Queue position {technique.queueIndex}</p></header>
      <div className="wafer-technique-editor-fields">
        <p id="remove-technique-description">Remove this technique from the potentiostat queue?</p>
        {!supported && <p role="alert">This potentiostat does not expose a writable technique-removal parameter.</p>}
        {error && <p className="wafer-technique-editor-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" data-cancel disabled={removing} onClick={onClose}>Cancel</button>
        <button type="submit" className="wafer-remove-technique-button" disabled={removing || !supported}>{removing ? 'Removing…' : 'Remove technique'}</button></footer>
    </form>
  </dialog>, document.body)
}
