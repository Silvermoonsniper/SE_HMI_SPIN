import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../api/client'
import { useAppStore } from '../../store/appStore'
import { fetchAndMergeLatestValuesOnce } from './deviceUtils'
import { gasFlowTarget, gasTargetState, parameterInfo, type GasKind } from './waferMeasurement'
import type { ParamDataInfo } from '../../api/types'

interface Props {
  device: string
  gas: GasKind
  onClose: () => void
  onSaved: () => void
}

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 })

export function GasFlowEditor({ device, gas, onClose, onSaved }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const info = useAppStore((s) => s.deviceParams?.[device])
  const payload = useAppStore((s) => s.latestValues[`${device}.target`])
  const target = useMemo(() => {
    try { return { value: gasTargetState(payload?.value, gas), error: '' } }
    catch (err) { return { value: null, error: err instanceof Error ? err.message : String(err) } }
  }, [payload?.value, gas])
  const [initialFlow, setInitialFlow] = useState<number | null>(() => target.value?.flows[target.value.index] ?? null)
  const [draft, setDraft] = useState(() => initialFlow === null ? '' : String(initialFlow))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const name = gas === 'argon' ? 'Argon' : 'N₂'
  const meta = parameterInfo(info, 'target')
  const members = meta?.datainfo?.members as Record<string, unknown> | undefined
  const totalInfo = members?.total_flow as ParamDataInfo | undefined
  const unit = totalInfo?.unit || payload?.unit || ''
  const supported = meta?.readonly !== true && (meta?.readonly === false || info?.params?.includes('target'))
  const modified = initialFlow !== null && draft.trim() !== '' && Number(draft) !== initialFlow

  useEffect(() => {
    const dialog = ref.current
    const trigger = document.activeElement as HTMLElement | null
    dialog?.showModal()
    dialog?.querySelector<HTMLInputElement>('input')?.focus()
    void fetchAndMergeLatestValuesOnce().catch(() => undefined)
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus() }
  }, [])

  useEffect(() => {
    if (initialFlow !== null || !target.value) return
    const flow = target.value.flows[target.value.index]
    setInitialFlow(flow)
    setDraft(String(flow))
  }, [target.value, initialFlow])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!supported || saving || !modified || !target.value) return
    setError('')
    setSaving(true)
    try {
      if (!draft.trim()) throw new Error('Enter a flow rate.')
      // Use current targets at submission, preserving other gases even if they changed during editing.
      const current = useAppStore.getState().latestValues[`${device}.target`]?.value
      const updated = gasFlowTarget(current, gas, Number(draft), info)
      await api.writeDeviceParameter(device, 'target', updated)
      void fetchAndMergeLatestValuesOnce().catch(() => undefined)
      onSaved()
    } catch (err) {
      setError(`Could not change flow: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  return createPortal(<dialog ref={ref} className="wafer-technique-editor" aria-labelledby="gas-flow-editor-title"
    onCancel={(event) => { event.preventDefault(); if (!saving) onClose() }}
    onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}>
    <form onSubmit={(event) => void submit(event)}>
      <header><h3 id="gas-flow-editor-title">Edit {name} flow</h3><p>{device}</p></header>
      <div className="wafer-technique-editor-fields">
        {!supported && <p role="alert">This gas group does not expose a writable flow target.</p>}
        {target.error && <p role="alert">{target.error}</p>}
        <label><span>Target flow{unit ? ` (${unit})` : ''}</span>
          <input aria-label={`${name} target flow`} type="number" min="0" step="any" required
            disabled={saving || !supported || !target.value} value={draft} onChange={(event) => setDraft(event.target.value)} />
        </label>
        {target.value && <div className="wafer-other-gas-targets"><p>Other gas targets</p><dl>
          {target.value.names.map((label, index) => index === target.value!.index ? null : <div key={label}>
            <dt>{label}</dt><dd>{number.format(target.value!.flows[index])} {unit}</dd>
          </div>)}
        </dl><small>Saving preserves these targets.</small></div>}
        {error && <p className="wafer-technique-editor-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button type="submit" disabled={saving || !supported || !target.value || !modified}>{saving ? 'Saving…' : 'Save flow'}</button></footer>
    </form>
  </dialog>, document.body)
}
