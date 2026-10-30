import { useEffect, useMemo, useRef, useState } from 'react'
import type { DeviceBoxProps } from './DeviceBox'
import { api } from '../../api/client'
import { useAppStore, getParamValue } from '../../store/appStore'
import { useEditorStore } from '../../store/editorStore'
import { useCanvasDrag } from '../editor/useCanvasDrag'
import { fetchAndMergeLatestValuesOnce, resolveDeviceAddr } from './deviceUtils'
import { automatorState, parseAutomatorQueue, queueStepState } from './automatorQueue'

export function AutomatorTable({ device, domId, isConfigure, left = 20, top = 20, width, height, onRemove, onGeometryChange }: DeviceBoxProps) {
  const info = useAppStore((s) => s.deviceParams?.[device])
  const latest = useAppStore((s) => s.latestValues)
  const ref = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [fileInput, setFileInput] = useState<string | null>(null)
  const paramName = (param: string) => info?.all_params?.find((p) => p.replace(/^_/, '') === param) ?? param
  const value = (param: string) => (getParamValue(latest, device, paramName(param))
    ?? getParamValue(latest, device, `_${param}`))?.value
  const state = automatorState(value('value'))
  const running = ['executing', 'dwelling', 'paused'].includes(state)
  const current = Number(value('current_step') ?? 0)
  const queueJson = value('queue_json')
  const file = String(value('queue_file') ?? '')
  const status = getParamValue(latest, device, 'status')
  const commands = info?.commands ?? []
  const findCommand = (...names: string[]) => commands.find((cmd) => names.includes(cmd.replace(/^_/, '')))
  const queue = useMemo(() => {
    try { return { steps: parseAutomatorQueue(queueJson), error: '' } }
    catch (e) { return { steps: [], error: e instanceof Error ? e.message : String(e) } }
  }, [queueJson])
  const showTimeout = queue.steps.some((step) => step.timeout_s !== undefined)

  useCanvasDrag(ref, {
    enabled: isConfigure, minWidth: 480, minHeight: 240,
    onDragEnd: (geo) => onGeometryChange?.(domId, geo),
    onResizeEnd: (geo) => onGeometryChange?.(domId, geo),
  })

  useEffect(() => {
    let disposed = false
    let refreshing = false
    let checkedInitialQueue = false
    const refresh = async () => {
      if (disposed || refreshing) return
      refreshing = true
      try {
        await fetchAndMergeLatestValuesOnce()
        if (!disposed) setRefreshError('')
        if (!disposed && !checkedInitialQueue) {
          checkedInitialQueue = true
          const store = useAppStore.getState()
          const snapshot = (getParamValue(store.latestValues, device, 'queue_json')
            ?? getParamValue(store.latestValues, device, '_queue_json'))?.value
          const execution = automatorState(getParamValue(store.latestValues, device, 'value')?.value)
          const load = store.deviceParams?.[device]?.commands.find((cmd) => ['load', 'submit'].includes(cmd.replace(/^_/, '')))
          if (!snapshot && execution === 'idle' && load) await execute(load)
        }
      }
      catch (e) {
        if (!disposed) setRefreshError(`Unable to refresh queue values: ${e instanceof Error ? e.message : String(e)}`)
      }
      finally { refreshing = false }
    }
    void refresh()
    // Use the backend's existing connection/cache, alongside WebSocket updates.
    const timer = window.setInterval(() => void refresh(), 2500)
    return () => { disposed = true; window.clearInterval(timer) }
  }, [device])

  const execute = async (command: string, submit = false) => {
    setBusy(true)
    setError('')
    try {
      const addr = await resolveDeviceAddr(device)
      if (!addr) throw new Error('Cannot resolve the Automator node address.')
      if (submit && fileInput !== null && fileInput.trim() !== file) {
        if (!fileInput.trim()) throw new Error('Enter a queue file path.')
        await api.writeDeviceParameter(device, paramName('queue_file'), fileInput.trim())
      }
      const module = info?.module_name || info?.original_name || device
      const result = await api.sendRawRequest(addr, `do ${module}:${command}`)
      const response = String(result.response ?? '').trim()
      if (result.status !== 'sent' || !response.startsWith(`done ${module}:${command}`)) {
        throw new Error(response || 'The node did not confirm the command. Refresh before trying again.')
      }
      if (submit) setFileInput(null)
      await fetchAndMergeLatestValuesOnce()
    } catch (e) { setError(`Queue command failed: ${e instanceof Error ? e.message : String(e)}`) }
    finally { setBusy(false) }
  }

  const controls = [
    { label: 'Submit', icon: '↥', command: findCommand('load', 'submit'), blocked: running, submit: true },
    { label: state === 'paused' ? 'Resume' : 'Start', icon: '▶', command: state === 'paused' ? findCommand('resume', 'start') : findCommand('start'), blocked: running && state !== 'paused' },
    { label: 'Stop', icon: '■', command: findCommand('stop'), blocked: false },
    { label: 'Pause', icon: 'Ⅱ', command: findCommand('pause'), blocked: !running || state === 'paused' },
    { label: 'Empty queue', icon: '⌫', command: findCommand('empty_queue', 'clear_queue', 'clear', 'empty'), blocked: running },
  ]

  return (
    <div ref={ref} id={`box-${domId}`} data-device={device}
      className={`device-box automator-table${isConfigure ? ' configure-layout' : ''}`}
      style={{ left, top, width: width ?? 680, height: height ?? 340 }}
      onMouseDown={() => { if (isConfigure) useEditorStore.getState().setSelected(`box-${domId}`) }}>
      <div className="device-header">
        <div className="device-title">{info?.original_name || info?.module_name || device}</div>
        <span className="automator-state">{state}</span>
        {isConfigure && <button className="close-btn" aria-label="Remove Automator" onClick={() => onRemove?.(domId)}>×</button>}
      </div>
      <div className="automator-controls" onMouseDown={(e) => e.stopPropagation()}>
        <label className="automator-file">Queue file
          <input aria-label="Queue file" value={fileInput ?? file} disabled={busy || running}
            onChange={(e) => setFileInput(e.target.value)} placeholder="Path on the Automator node" />
        </label>
        <div className="automator-toolbar" role="group" aria-label="Queue controls">
          {controls.map((control) => <button key={control.label} type="button"
            disabled={busy || !control.command || control.blocked}
            title={control.command ? control.label : `${control.label} is not supported by this Automator module`}
            aria-label={control.label}
            onClick={() => { if (control.command) void execute(control.command, control.submit) }}>
            <span aria-hidden="true">{control.icon}</span> {control.label}
          </button>)}
        </div>
      </div>
      {(error || queue.error || refreshError) && <div className="automator-error" role="alert">{error || queue.error || refreshError}</div>}
      <div className="automator-scroll" onMouseDown={(e) => e.stopPropagation()}>
        <table aria-label="Automation queue">
          <thead><tr><th>Step</th><th>Module</th><th>Command</th><th>Arguments</th><th>Dwell (min)</th>{showTimeout && <th>Timeout (s)</th>}<th>Status</th></tr></thead>
          <tbody>{queue.steps.map((step) => {
            const stepState = queueStepState(step.step_number, current, state)
            return <tr key={step.step_number} className={`queue-step-${stepState}`} aria-current={step.step_number === current && running ? 'step' : undefined}>
              <td>{step.step_number}</td><td>{step.module}</td>
              <td>{Array.isArray(step.command) ? step.command.join(' → ') : step.command}</td>
              <td className="automator-details">{JSON.stringify(step.arguments, null, 2)}</td>
              <td>{step.dwell_time_min}</td>{showTimeout && <td>{step.timeout_s ?? 600}</td>}
              <td>{stepState === 'completed' ? '✓ Completed' : stepState}</td>
            </tr>
          })}</tbody>
        </table>
        {!queue.steps.length && <p className="automator-empty">Submit to load and validate the JSON from the queue file.</p>}
      </div>
      <div className="automator-summary" role="status">
        {busy ? 'Working…' : status?.state_str || `${queue.steps.length} steps`}
        {state === 'dwelling' && ` · ${Number(value('dwell_remaining') ?? 0).toFixed(2)} min remaining`}
      </div>
      {isConfigure && <div className="resize-handle" />}
    </div>
  )
}
