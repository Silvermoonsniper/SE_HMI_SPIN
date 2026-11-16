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

export function measurementSpots(info: DeviceInfo | undefined): MeasurementSpot[] {
  const data = parameterInfo(info, 'target')?.datainfo ?? parameterInfo(info, 'value')?.datainfo
  if (data?.type !== 'enum' || !data.members) return []
  const entries = Array.isArray(data.members)
    ? data.members.map((label, index) => [label, index] as const)
    : Object.entries(data.members)
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
    ) || (/measurement.*(position|spot)|wafer/i.test(name) && measurementSpots(info).length > 0)).map(([name]) => name),
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

export interface TechniqueRow {
  number: string
  name: string
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
  return entries.map(([index, entry]) => {
    const technique = record(parseValue(entry))
    if (!technique) return { number: index, name: 'Technique', details: flatten(entry) }
    const { technique_number, number, technique_name, name, technique: kind, ...details } = technique
    return {
      number: String(technique_number ?? number ?? index),
      name: String(technique_name ?? name ?? kind ?? 'Technique'),
      details: flatten(details),
    }
  })
}

/** Resolve the individual gas flows from the group's measured composition and total flow. */
export function gasFlowReadings(devices: DeviceParamsMap, values: LatestValues, device: string) {
  const reading = parseValue(values[`${device}.value`]?.value)
  const group = reading && typeof reading === 'object' && !Array.isArray(reading)
    ? reading as { gas_list?: unknown; composition?: unknown; total_flow?: unknown } : {}
  const gases = Array.isArray(group.gas_list) ? group.gas_list : []
  const composition = Array.isArray(group.composition) ? group.composition : []
  const members = parameterInfo(devices[device], 'value')?.datainfo?.members as Record<string, unknown> | undefined
  const totalFlowInfo = members?.total_flow as ParamDataInfo | undefined
  const unit = totalFlowInfo?.unit || values[`${device}.value`]?.unit || ''
  const flow = (aliases: string[]) => {
    const index = gases.findIndex((gas) => aliases.includes(String(gas).trim().toLowerCase()))
    const percent = composition[index]
    if (index < 0 || typeof percent !== 'number' || !Number.isFinite(percent)
      || typeof group.total_flow !== 'number' || !Number.isFinite(group.total_flow)) return null
    return group.total_flow * percent / 100
  }
  return { argon: flow(['ar', 'argon']), nitrogen: flow(['n2', 'nitrogen', 'nitrogen gas']), unit }
}
