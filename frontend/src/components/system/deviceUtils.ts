/**
 * Shared device helpers — ports of logic from system-core.js,
 * system-runtime.js, system-devices.js and system-layout.js.
 */

import { api } from '../../api/client'
import { appAlert, appConfirm, appPrompt } from '../../store/dialogStore'
import { useAppStore } from '../../store/appStore'
import type { DeviceInfo, ParamMeta, SecopState } from '../../api/types'
import { getRuntimeNodeAddrs, setRuntimeNodeAddr } from '../../utils/storage'

// ---------------------------------------------------------------------------
// Parameter metadata
// ---------------------------------------------------------------------------

/** Merge the legacy param_info (list of single-entry dicts) into a lookup map. */
export function getParamInfoMap(deviceInfo: DeviceInfo | null | undefined): Record<string, ParamMeta> {
  if (!deviceInfo || !deviceInfo.param_info) return {}
  if (Array.isArray(deviceInfo.param_info)) {
    const merged: Record<string, ParamMeta> = {}
    deviceInfo.param_info.forEach((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        Object.assign(merged, entry)
      }
    })
    return merged
  }
  if (typeof deviceInfo.param_info === 'object') {
    return deviceInfo.param_info as Record<string, ParamMeta>
  }
  return {}
}

/** Typed parsing of a user-entered parameter value (legacy parseTypedParameterValue). */
export function parseTypedParameterValue(rawValue: unknown, datainfo: { type?: string } | null | undefined): unknown {
  const value = typeof rawValue === 'string' ? rawValue.trim() : rawValue
  const type = datainfo && datainfo.type ? datainfo.type : ''

  if (type === 'array' || type === 'tuple' || type === 'struct') {
    return JSON.parse(value as string)
  }
  if (type === 'double' || type === 'scaled' || type === 'int') {
    const numericValue = Number(value)
    if (!Number.isFinite(numericValue)) {
      throw new Error(`Expected a ${type} value`)
    }
    return type === 'int' ? Math.trunc(numericValue) : numericValue
  }
  if (type === 'bool') {
    if (typeof value === 'boolean') return value
    const normalized = String(value).toLowerCase()
    if (normalized === 'true' || normalized === '1') return true
    if (normalized === 'false' || normalized === '0') return false
    throw new Error('Expected a boolean value (true/false)')
  }
  return isNaN(value as number) ? value : parseFloat(value as string)
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

export interface UiStatus {
  state: string
  stateStr: string
}

/** Map a SECoP status tuple [code, text] to a UI state (legacy secopStatusToUi). */
export function secopStatusToUi(statusValue: unknown): UiStatus {
  if (!Array.isArray(statusValue) || statusValue.length < 2) {
    return { state: 'State.UNKNOWN', stateStr: '' }
  }
  const code = Number(statusValue[0])
  const stateStr = String(statusValue[1] || '')
  let state = 'State.UNKNOWN'
  if (code < 0) state = 'State.UNKNOWN'
  else if (code < 100) state = 'State.DISABLED'
  else if (code < 200) state = 'State.OK'
  else if (code < 300) state = 'State.WARN'
  else if (code < 400) state = 'State.BUSY'
  else if (code < 500) state = 'State.ERROR'
  return { state, stateStr }
}

// ---------------------------------------------------------------------------
// SECoP reply parsing / node resolution / hydration
// ---------------------------------------------------------------------------

/** Parse the JSON payload out of a raw SECoP reply line (legacy parseSecopReply). */
export function parseSecopReply(responseText: string | null | undefined): unknown {
  if (!responseText) return null
  const trimmed = String(responseText).trim()
  const match = trimmed.match(/^reply\s+\S+\s+(.+)$/s)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

/** Resolve the node addr for a device: localStorage cache -> /api/node_for_device. */
export async function resolveDeviceAddr(device: string): Promise<string | null> {
  const cached = getRuntimeNodeAddrs()[device]
  if (cached) return cached
  try {
    const payload = await api.nodeForDevice(device)
    if (payload?.addr) {
      setRuntimeNodeAddr(device, payload.addr)
      return payload.addr
    }
  } catch {
    /* unresolved */
  }
  return null
}

/** Resolve the SECoP module name for a device (legacy getModuleName). */
export async function getModuleName(device: string): Promise<string | null> {
  const deviceParams = useAppStore.getState().deviceParams
  const runtimeInfo = deviceParams && deviceParams[device] ? deviceParams[device] : null
  if (runtimeInfo) {
    return runtimeInfo.module_name || runtimeInfo.original_name || null
  }
  try {
    const data = await api.deviceParamsFile()
    const info = data && data[device] ? data[device] : null
    return info ? info.module_name || info.original_name || null : null
  } catch {
    return null
  }
}

const hydrationInFlight = new Map<string, Promise<void>>()

/**
 * Hydrate one device by issuing raw SECoP `read` requests for all of its
 * parameters through /api/send_request (legacy hydrateDeviceFromNode).
 */
export function hydrateDeviceFromNode(device: string): Promise<void> {
  const existing = hydrationInFlight.get(device)
  if (existing) return existing

  const promise = (async () => {
    const deviceParams = useAppStore.getState().deviceParams
    const deviceInfo = deviceParams && deviceParams[device] ? deviceParams[device] : null
    const moduleName = deviceInfo && (deviceInfo.module_name || deviceInfo.original_name)
      ? deviceInfo.module_name || deviceInfo.original_name
      : null
    if (!deviceInfo || !moduleName) return

    const addr = await resolveDeviceAddr(device)
    if (!addr) return

    const commands = new Set(deviceInfo.commands || [])
    const params = Array.from(new Set(['status', 'value', 'target', ...(deviceInfo.all_params || [])])).filter(
      (param) => !commands.has(param),
    )

    const merged: Record<string, { value: unknown; unit: string; state: SecopState; state_str: string }> = {}
    for (const param of params) {
      try {
        const payload = await api.sendRawRequest(addr, `read ${moduleName}:${param}`)
        const parsed = parseSecopReply(payload?.response)
        if (!Array.isArray(parsed) || parsed.length === 0) continue

        const value = parsed[0]
        let state: SecopState = 'State.OK'
        let stateStr = ''
        if (param === 'status') {
          const statusInfo = secopStatusToUi(value)
          state = statusInfo.state
          stateStr = statusInfo.stateStr
        } else {
          const statusEntry = useAppStore.getState().latestValues[`${device}.status`]
          if (statusEntry && Array.isArray(statusEntry.value)) {
            const statusInfo = secopStatusToUi(statusEntry.value)
            state = statusInfo.state
            stateStr = statusInfo.stateStr
          }
        }

        const unit = String(((deviceInfo.accessibles || {})[param] || {})?.datainfo?.unit || '')
        merged[`${device}.${param}`] = { value, unit, state, state_str: stateStr }
      } catch {
        /* per-param failure tolerated */
      }
    }

    if (Object.keys(merged).length) {
      useAppStore.getState().mergeLatestValues(merged)
    }
  })().finally(() => {
    hydrationInFlight.delete(device)
  })

  hydrationInFlight.set(device, promise)
  return promise
}

/** One-shot merge of the backend latest-value cache into the store. */
export async function fetchAndMergeLatestValuesOnce(): Promise<void> {
  const values = await api.latestValues()
  useAppStore.getState().mergeLatestValues(values)
}

// ---------------------------------------------------------------------------
// Writes & commands
// ---------------------------------------------------------------------------

/**
 * Write one device parameter (legacy sendSelectedParam). Uses the backend
 * REST endpoint /api/device_parameter (the new frontend has no Spin socket).
 */
export async function sendSelectedParam(device: string, param: string, rawValue: string): Promise<boolean> {
  if (!param) {
    await appAlert('Please select a parameter first.', 'Set Parameter')
    return false
  }
  if (!rawValue || !rawValue.trim()) {
    await appAlert('Please enter a value.', 'Set Parameter')
    return false
  }

  const deviceParams = useAppStore.getState().deviceParams
  const deviceInfo = deviceParams && deviceParams[device] ? deviceParams[device] : null
  const paramInfo = getParamInfoMap(deviceInfo)
  const found = paramInfo[param] || null

  let finalValue: unknown
  try {
    finalValue = parseTypedParameterValue(rawValue, found && found.datainfo ? found.datainfo : null)
  } catch (parseError) {
    const type = found && found.datainfo ? found.datainfo.type : ''
    const details =
      type === 'array'
        ? 'Use JSON array syntax, for example [1, 2, 3].'
        : type === 'tuple' || type === 'struct'
          ? `Use valid JSON for ${type} values.`
          : parseError instanceof Error
            ? parseError.message
            : String(parseError)
    await appAlert(details, 'Invalid Parameter Value')
    return false
  }

  try {
    await api.writeDeviceParameter(device, param, finalValue)
  } catch (error) {
    await appAlert(
      `Failed to set ${device}.${param}.\n${error instanceof Error ? error.message : String(error)}`,
      'Set Parameter',
    )
    return false
  }

  fetchAndMergeLatestValuesOnce().catch(() => undefined)
  return true
}

/** Execute a SECoP command on a device (legacy sendCommand, with retries). */
export async function sendCommand(device: string, cmd: string): Promise<void> {
  const confirmed = await appConfirm(`Execute command '${cmd}' on ${device}?`, 'Execute Command')
  if (!confirmed) return

  let moduleName: string | null = null
  for (let attempt = 0; attempt < 6 && !moduleName; attempt++) {
    moduleName = await getModuleName(device)
    if (!moduleName) await new Promise((r) => setTimeout(r, 500))
  }
  const commandToSend = `do ${moduleName || device}:${cmd}`

  let addr = await resolveDeviceAddr(device)
  if (!addr) {
    const manual = await appPrompt(
      `Could not auto-resolve node for device "${device}". Enter host:port to send command:`,
      '127.0.0.1:10803',
      'Manual Node Address',
    )
    if (!manual) return
    addr = manual.trim()
    if (!addr) return
  }

  const maxRetries = 5
  let lastResp: unknown = null
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const sr = await api.sendRawRequest(addr, commandToSend)
      lastResp = sr
      if (sr && sr.status === 'sent') {
        await appAlert(`Command sent via proxy. Response: ${sr.response || ''}`, 'Command Sent')
        return
      }
      const textBody = JSON.stringify(sr || '')
      const isProtocolError =
        textBody.includes('ProtocolError') || textBody.includes('error__scan')
      if (!isProtocolError) {
        await appAlert(`Proxy response: ${textBody}`, 'Command Response')
        return
      }
      await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 10000)))
    } catch (e) {
      lastResp = e
      await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 10000)))
    }
  }

  await appAlert(
    `Failed to send command after ${maxRetries} attempts. Last response: ${JSON.stringify(lastResp)}`,
    'Command Failed',
  )
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Format a live value for display (legacy formatting rules). */
export function formatLiveValue(value: unknown, unit = ''): string {
  let displayValue: string
  if (value === null || value === undefined || value === 'None') {
    displayValue = '—'
  } else if (Array.isArray(value)) {
    displayValue = `[${value.join(', ')}]`
  } else if (typeof value === 'object') {
    displayValue = JSON.stringify(value)
  } else {
    displayValue = String(value)
  }
  return unit ? `${displayValue} ${unit}` : displayValue
}

export function toNumeric(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
