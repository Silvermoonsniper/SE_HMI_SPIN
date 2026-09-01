/**
 * Shared API/domain types for the SE HMI frontend.
 *
 * These mirror the JSON contracts of the FastAPI backend in
 * configuration/fastapi_app.py and the persisted JSON schemas used by the
 * legacy frontend (layout files, plot configs, localStorage payloads) so that
 * all existing data stays compatible.
 */

// ---------------------------------------------------------------------------
// Live values
// ---------------------------------------------------------------------------

export type SecopState = 'idle' | 'warn' | 'busy' | 'error' | 'disabled' | 'unknown' | string

export interface LatestValue {
  value: unknown
  unit: string
  state: SecopState
  state_str: string
}

/** Flat map of "<device>.<param>" -> latest value payload. */
export type LatestValues = Record<string, LatestValue>

/** One live update event (identical to the legacy spinupdate event detail). */
export interface UpdateEvent {
  key: string
  unit: string
  state: SecopState
  state_str: string
  value: unknown
}

export type WsServerMessage =
  | { type: 'snapshot'; values: LatestValues }
  | { type: 'update'; data: UpdateEvent }

// ---------------------------------------------------------------------------
// Device metadata (device_params.json)
// ---------------------------------------------------------------------------

export interface ParamDataInfo {
  type?: string
  unit?: string
  members?: Record<string, number> | string[]
  min?: number
  max?: number
  [key: string]: unknown
}

export interface ParamMeta {
  description?: string
  readonly?: boolean
  datainfo?: ParamDataInfo
  [key: string]: unknown
}

export interface DeviceInfo {
  params: string[]
  all_params: string[]
  commands: string[]
  original_name?: string
  module_name?: string
  interface_classes?: string[]
  param_info?: Array<Record<string, ParamMeta>>
  accessibles?: Record<string, ParamMeta>
  [key: string]: unknown
}

export type DeviceParamsMap = Record<string, DeviceInfo>

// ---------------------------------------------------------------------------
// Layout persistence (localStorage "gas_system_layouts" + layout/*.json)
// ---------------------------------------------------------------------------

export interface LayoutDeviceEntry {
  id: string
  device: string
  deviceKey?: string
  logicalName?: string
  left: string
  top: string
  width: string
  height: string
  info?: DeviceInfo
  image?: string | null
}

export interface LayoutValveIconEntry {
  id: string
  device: string
  field: string
  left: string
  top: string
  width: string
  height: string
  rotationDegrees?: string
  closedSvg?: string
  openSvg?: string
  switchSvg?: string
  switchClosedSvg?: string
  switchOpenSvg?: string
}

export interface LayoutDecorationEntry {
  id: string
  type: 'line' | 'switch' | 'label' | string
  left: string
  top: string
  width: string
  height: string
  color?: string
  text?: string
  fontFamily?: string
  fontSize?: string
  lineColor?: string
  lineWidth?: string
  lineType?: string
  rotationDegrees?: string
}

export interface LayoutPlotEntry {
  id: string
  title?: string
  configName?: string
  xAxisTitle?: string
  yAxisTitle?: string
  left: string
  top: string
  width: string
  height: string
  transform?: string
  zIndex?: string
  dataX?: string
  dataY?: string
  traces: string[]
}

export interface LayoutConnectionEntry {
  startBoxId: string
  startSide: 'top' | 'bottom' | 'left' | 'right' | string
  endBoxId: string
  endSide: 'top' | 'bottom' | 'left' | 'right' | string
  strokeColor?: string
  strokeWidth?: string
  lineType?: string
  rotationDegrees?: string
}

export interface LayoutData {
  devices: LayoutDeviceEntry[]
  valveIcons: LayoutValveIconEntry[]
  decorations: LayoutDecorationEntry[]
  plots: LayoutPlotEntry[]
  connections: LayoutConnectionEntry[]
}

// ---------------------------------------------------------------------------
// Plot configurations (localStorage "plot_configurations" + plot_config/*.json)
// ---------------------------------------------------------------------------

export interface PlotLineStyle {
  lineType?: string
  lineWidth?: number
  lineColor?: string
  xyChartType?: 'area' | 'bar' | string
  arrayElementStyles?: Array<{
    name?: string
    lineType?: string
    lineWidth?: number
    lineColor?: string
  }>
}

export interface PlotLineConfig {
  key: string
  suffix?: string
  xKey?: string
  yKey?: string
  xSuffix?: string
  ySuffix?: string
  label?: string
  style?: PlotLineStyle
}

export interface PlotConfig {
  name: string
  plotType: 'line' | 'xy' | 'array' | string
  xAxisTitle?: string
  yAxisTitle?: string
  lines: PlotLineConfig[]
  savedAt?: string
}

// ---------------------------------------------------------------------------
// API response payloads
// ---------------------------------------------------------------------------

export interface ApiOk {
  status: 'ok'
  [key: string]: unknown
}

export interface ApiErrorBody {
  status: 'error'
  error: string
}

export interface PlotSample {
  timestamp_ms: number
  value: unknown
  unit?: string
  state?: string
  state_str?: string
}

export type PlotUpdatesResponse =
  | { status: 'ok'; mode: 'snapshot'; server_time_ms: number; values: Record<string, PlotSample> }
  | { status: 'ok'; mode: 'history'; server_time_ms: number; samples: Record<string, PlotSample[]> }

export interface HistorySample {
  id: number
  timestamp_ms: number
  value: unknown
  unit: string
  state: string
  state_str: string
}

export interface DeviceHistoryResponse {
  status: 'ok'
  backend: string
  host: string
  port: string
  database: string
  samples: Record<string, HistorySample[]>
  returned_rows: number
  limit: number
  offset: number
  has_more: boolean
  next_cursor: { timestamp_ms: number; id: number } | null
  paging_mode: 'cursor' | 'offset'
}

export interface DeviceHistoryStats {
  status: 'ok'
  backend: string
  host: string
  port: string
  database: string
  total_rows: number
  oldest_timestamp_ms: number | null
  newest_timestamp_ms: number | null
}

export interface DeviceHistoryKeys {
  status: 'ok'
  backend: string
  host: string
  port: string
  database: string
  keys: Array<{ key: string; newest_timestamp_ms: number | null }>
  returned_keys: number
  limit: number
}

export interface NexusExportStatus {
  running: boolean
  file_path: string | null
  run_name: string | null
  start_time: string | null
  [key: string]: unknown
}

export interface DataSavingStatus {
  running: boolean
  file_path: string | null
  directory: string | null
  file_name: string | null
  interval_seconds: number
  start_time_ms: number | null
  last_write_ms: number | null
  write_cycles: number
  default_directory: string
  nexus?: NexusExportStatus
}

export interface StorageStatus {
  monitor_path: string
  filesystem_total_bytes: number
  filesystem_used_bytes: number
  filesystem_free_bytes: number
  filesystem_used_percent: number
  warning_percent: number
  critical_percent: number
  level: 'normal' | 'warning' | 'critical'
  database_bytes: number | null
}

export interface NexusFileEntry {
  name: string
  size: number
  modified_time: string
  directory: string
}

export interface NexusNodeInfo {
  file_name: string
  path: string
  kind: 'group' | 'dataset'
  attrs: Record<string, unknown>
  children?: Array<{ name: string; path: string; kind: 'group' | 'dataset' }>
  shape?: number[]
  dtype?: string
  preview?: unknown
  size?: number
}

export interface NodeForDeviceResponse {
  status: 'ok'
  addr: string
}

export interface SendRequestResponse {
  status: 'sent'
  response: string
}

export interface NodemanagerResponse {
  status: 'ok'
  action: string | null
  data: unknown
}
