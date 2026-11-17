import type { DeviceInfo, DeviceParamsMap, LatestValues, ParamDataInfo } from '../../api/types'
import { getParamInfoMap } from './deviceUtils'

export interface MeasurementSpot {
  label: string
  value: string
  wafer: string | null
  spot: string
}

export function parameterInfo(info: DeviceInfo | undefined, param: string) {
  return getParamInfoMap(info)[param] ?? info?.accessibles?.[param]
}

export function measurementSpots(info: DeviceInfo | undefined, livePositions: unknown[] = []): MeasurementSpot[] {
  const data = parameterInfo(info, 'target')?.datainfo ?? parameterInfo(info, 'value')?.datainfo
  const entries: Array<readonly [string, string | number]> = data?.type !== 'enum' || !data.members ? [] : Array.isArray(data.members)
    ? data.members.map((label, index) => [label, index] as const)
    : Object.entries(data.members)
  if (data?.type === 'string') {
    for (const label of livePositions) {
      if (typeof label === 'string' && /_measurement_(position|spot)_/i.test(label) && !entries.some(([name]) => name === label)) {
        entries.push([label, label])
      }
    }
  }
  return entries.map(([label, value]) => {
    const match = label.match(/^(.*?)_measurement_(?:position|spot)_(.+)$/i)
    return { label, value: String(value), wafer: match?.[1] || null, spot: match?.[2] || label }
  })
}

export function waferSourceOptions(devices: DeviceParamsMap) {
  const entries = Object.entries(devices)
  return {
    spots: entries.filter(([name, info]) => measurementSpots(info).some((spot) =>
      /measurement_(position|spot)/i.test(spot.label),
    ) || (/measurement.*(position|spot)|wafer/i.test(`${name} ${info.module_name ?? ''} ${info.original_name ?? ''}`)
      && (parameterInfo(info, 'target')?.datainfo?.type === 'string' || measurementSpots(info).length > 0))).map(([name]) => name),
    gas: entries.filter(([, info]) => {
      const members = parameterInfo(info, 'value')?.datainfo?.members
      return members && !Array.isArray(members) && 'gas_list' in members && 'composition' in members && 'total_flow' in members
    }).map(([name]) => name),
    potentiostat: entries.filter(([, info]) => !!parameterInfo(info, '_technique_config') || info.all_params?.includes('_technique_config')).map(([name]) => name),
  }
}

export function parseValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

export type GasKind = 'argon' | 'nitrogen'
const gasAliases: Record<GasKind, string[]> = { argon: ['ar', 'argon'], nitrogen: ['n2', 'nitrogen', 'nitrogen gas'] }

export function gasTargetState(value: unknown, gas: GasKind) {
  const parsed = parseValue(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Waiting for the gas group target settings.')
  const group = parsed as { gas_list: unknown; composition: unknown; total_flow: unknown }
  if (!Array.isArray(group.gas_list) || !group.gas_list.length || group.gas_list.some((name) => typeof name !== 'string')
    || !Array.isArray(group.composition) || group.composition.length !== group.gas_list.length
    || group.composition.some((part) => typeof part !== 'number' || !Number.isFinite(part) || part < 0 || part > 100)
    || typeof group.total_flow !== 'number' || !Number.isFinite(group.total_flow) || group.total_flow < 0) {
    throw new Error('The gas group target settings are incomplete or invalid.')
  }
  const names = group.gas_list as string[]
  const composition = group.composition as number[]
  const totalFlow = group.total_flow
  if (new Set(names.map((name) => name.trim().toLowerCase())).size !== names.length) throw new Error('The gas group contains duplicate gas names.')
  const matches = names.flatMap((name, index) => gasAliases[gas].includes(name.trim().toLowerCase()) ? [index] : [])
  if (matches.length !== 1) throw new Error(`The gas group must contain exactly one ${gas === 'argon' ? 'Argon' : 'N₂'} entry.`)
  if (group.total_flow > 0 && Math.abs(composition.reduce((sum, part) => sum + part, 0) - 100) > 0.01) {
    throw new Error('The gas group target composition must total 100%.')
  }
  const flows = composition.map((part) => part * totalFlow / 100)
  return { names, composition, flows, index: matches[0] }
}

/** Change one absolute flow while preserving every other gas's current target. */
export function gasFlowTarget(value: unknown, gas: GasKind, flow: number, info: DeviceInfo | undefined) {
  if (!Number.isFinite(flow) || flow < 0) throw new Error('Flow must be a finite, non-negative number.')
  const target = gasTargetState(value, gas)
  const flows = [...target.flows]
  flows[target.index] = flow
  const total = flows.reduce((sum, part) => sum + part, 0)
  const members = parameterInfo(info, 'target')?.datainfo?.members as Record<string, unknown> | undefined
  const limits = members?.total_flow as ParamDataInfo | undefined
  if (!Number.isFinite(total) || total < (limits?.min ?? 0) || (limits?.max !== undefined && total > limits.max)) {
    throw new Error(`Combined gas flow must be within ${limits?.min ?? 0}–${limits?.max ?? 'the device limit'} ${limits?.unit ?? ''}.`)
  }
  // A zero total still needs a valid 100% composition for the device's validator.
  const composition = total > 0 ? flows.map((part) => part / total * 100)
    : target.names.map((_, index) => index === 0 ? 100 : 0)
  return { gas_list: [...target.names], composition, total_flow: total }
}

export interface TechniqueRow {
  number: string
  name: string
  queueIndex: number
  id?: string
  parameters: Record<string, unknown> | null
  details: Array<[string, string]>
}

/** Accept a single technique, a queue, or a queue keyed by technique number. */
export function techniqueRows(value: unknown): TechniqueRow[] {
  const parsed = parseValue(value)
  if (parsed === undefined || parsed === null || parsed === '') return []
  const record = (entry: unknown): Record<string, unknown> | null =>
    entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : null
  const root = record(parsed)
  const queue = parseValue(root?.techniques ?? root?.queue ?? parsed)
  const object = record(queue)
  const entries: Array<[string, unknown]> = Array.isArray(queue) ? queue.map((entry, index) => [String(index + 1), entry])
    : object && !('technique' in object || 'name' in object || 'technique_name' in object) && Object.keys(object).every((key) => /^\d+$/.test(key))
      ? Object.entries(object) : [['1', queue]]
  const flatten = (entry: unknown, path = ''): Array<[string, string]> => {
    if (entry !== null && typeof entry === 'object') {
      const fields = Object.entries(entry)
      if (fields.length) return fields.flatMap(([key, child]) => flatten(child, path ? `${path}.${key}` : key))
    }
    return [[path || 'Value', entry === null ? '—' : String(entry)]]
  }
  return entries.map(([index, entry], position) => {
    const technique = record(parseValue(entry))
    const queueIndex = Array.isArray(queue) ? position + 1 : Number(index)
    if (!technique) return { number: index, name: 'Technique', queueIndex, parameters: null, details: flatten(entry) }
    const { technique_number, number, technique_name, name, technique: kind, id, ...details } = technique
    return {
      number: String(technique_number ?? number ?? index),
      name: String(technique_name ?? name ?? kind ?? 'Technique'),
      queueIndex,
      id: typeof id === 'string' ? id : undefined,
      parameters: record(details.parameters) ?? record(details.config) ?? record(details),
      details: flatten(details),
    }
  })
}

/** Resolve the device enum and validate that this is still the selected queue entry. */
export function techniqueSelector(info: DeviceInfo | undefined, parameter: string, technique: TechniqueRow, configuration: unknown) {
  const current = techniqueRows(configuration).find((entry) => entry.queueIndex === technique.queueIndex)
  if (!current || current.name !== technique.name || current.id !== technique.id
    || JSON.stringify(current.parameters) !== JSON.stringify(technique.parameters)) {
    throw new Error('This queue entry changed while the window was open. Close and reopen the action to use the latest queue.')
  }
  const fields = parameterInfo(info, parameter)?.datainfo?.members as Record<string, unknown> | undefined
  const nameInfo = fields?.name as { members?: Record<string, number> | string[] } | undefined
  let name: string | number = technique.name
  if (nameInfo?.members) {
    const members = nameInfo.members
    const entries = Array.isArray(members) ? members.map((label, index) => [label, index] as const) : Object.entries(members)
    const match = entries.find(([label]) => label.toLowerCase() === technique.name.toLowerCase())
    if (!match) throw new Error(`Technique ${technique.name} is not supported by this potentiostat's selector.`)
    name = match[1]
  }
  if (!Number.isSafeInteger(technique.queueIndex) || technique.queueIndex < 1) throw new Error('The technique has no valid queue position.')
  return { name, index: technique.queueIndex }
}

/** Resolve the individual gas flows from the group's measured composition and total flow. */
export function gasFlowReadings(devices: DeviceParamsMap, values: LatestValues, device: string, parameter: 'value' | 'target' = 'value') {
  const reading = parseValue(values[`${device}.${parameter}`]?.value)
  const group = reading && typeof reading === 'object' && !Array.isArray(reading)
    ? reading as { gas_list?: unknown; composition?: unknown; total_flow?: unknown } : {}
  const gases = Array.isArray(group.gas_list) ? group.gas_list : []
  const composition = Array.isArray(group.composition) ? group.composition : []
  const members = parameterInfo(devices[device], parameter)?.datainfo?.members as Record<string, unknown> | undefined
  const totalFlowInfo = members?.total_flow as ParamDataInfo | undefined
  const unit = totalFlowInfo?.unit || values[`${device}.${parameter}`]?.unit || ''
  const flow = (aliases: string[]) => {
    const index = gases.findIndex((gas) => aliases.includes(String(gas).trim().toLowerCase()))
    const percent = composition[index]
    if (index < 0 || typeof percent !== 'number' || !Number.isFinite(percent)
      || typeof group.total_flow !== 'number' || !Number.isFinite(group.total_flow)) return null
    return group.total_flow * percent / 100
  }
  return { argon: flow(gasAliases.argon), nitrogen: flow(gasAliases.nitrogen), unit }
}
