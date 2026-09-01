/**
 * Typed REST client for the FastAPI backend.
 *
 * All requests use same-origin relative URLs. In development the Vite dev
 * server proxies /api, /c and /ws to the FastAPI backend on port 8001; in
 * production the FastAPI server serves the built app itself. This replaces the
 * legacy hardcoded http://127.0.0.1:8001 base URL.
 */

import type {
  DataSavingStatus,
  DeviceHistoryKeys,
  DeviceHistoryResponse,
  DeviceHistoryStats,
  DeviceParamsMap,
  LayoutData,
  LatestValues,
  NexusExportStatus,
  NexusFileEntry,
  NexusNodeInfo,
  NodeForDeviceResponse,
  NodemanagerResponse,
  PlotConfig,
  PlotUpdatesResponse,
  SendRequestResponse,
  StorageStatus,
} from './types'

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function parseResponse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${res.status}`
    throw new ApiError(message, res.status, body)
  }
  return body as T
}

async function getJson<T>(path: string): Promise<T> {
  return parseResponse<T>(await fetch(path))
}

async function postJson<T>(path: string, payload?: unknown): Promise<T> {
  return parseResponse<T>(
    await fetch(path, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    }),
  )
}

export const api = {
  // -- Live values / plots -------------------------------------------------
  latestValues: () => getJson<LatestValues>('/api/latest_values'),
  plotUpdates: (sinceMs?: number) =>
    getJson<PlotUpdatesResponse>(`/api/plot_updates${sinceMs ? `?since=${sinceMs}` : ''}`),
  runtimeNodeReady: (addr: string) =>
    getJson<{ status: string; ready: boolean; matched_devices: string[]; devices_with_latest_values: string[] }>(
      `/api/runtime_node_ready?addr=${encodeURIComponent(addr)}`,
    ),

  // -- Device metadata / node management ------------------------------------
  deviceParamsFile: () => getJson<DeviceParamsMap>('/c/device_params.json'),
  nodesFile: () => getJson<Array<{ host: string; port: number }>>('/c/nodes.json'),
  nodeForDevice: (device: string) => postJson<NodeForDeviceResponse>('/api/node_for_device', { device }),
  sendRawRequest: (addr: string, command: string) =>
    postJson<SendRequestResponse>('/api/send_request', { addr, command }),
  writeDeviceParameter: (device: string, param: string, value: unknown) =>
    postJson<{ status: string }>('/api/device_parameter', { device, param, value }),
  nodemanager: (command: string, payload?: Record<string, unknown>) =>
    postJson<NodemanagerResponse>(`/api/nodemanager/${encodeURIComponent(command)}`, payload ?? {}),

  // -- Layouts ---------------------------------------------------------------
  listLayouts: () => getJson<{ status: 'ok'; names: string[] }>('/api/layouts'),
  getLayout: (name: string) =>
    getJson<{ status: 'ok'; layout: LayoutData }>(`/api/layouts/${encodeURIComponent(name)}`),

  // -- Plot configs ----------------------------------------------------------
  listPlotConfigs: () => getJson<{ status: 'ok'; names: string[] }>('/api/plot_configs'),
  getPlotConfig: (name: string) =>
    getJson<{ status: 'ok'; config: PlotConfig }>(`/api/plot_configs/${encodeURIComponent(name)}`),

  // -- History ---------------------------------------------------------------
  deviceHistory: (params: {
    keys?: string[]
    startMs?: number
    endMs?: number
    limit?: number
    offset?: number
    cursorTimestampMs?: number
    cursorId?: number
  }) => {
    const search = new URLSearchParams()
    if (params.keys?.length) search.set('keys', params.keys.join(','))
    if (params.startMs != null) search.set('start_ms', String(params.startMs))
    if (params.endMs != null) search.set('end_ms', String(params.endMs))
    if (params.limit != null) search.set('limit', String(params.limit))
    if (params.offset != null) search.set('offset', String(params.offset))
    if (params.cursorTimestampMs != null) search.set('cursor_timestamp_ms', String(params.cursorTimestampMs))
    if (params.cursorId != null) search.set('cursor_id', String(params.cursorId))
    return getJson<DeviceHistoryResponse>(`/api/device_history?${search.toString()}`)
  },
  deviceHistoryStats: () => getJson<DeviceHistoryStats>('/api/device_history/stats'),
  deviceHistoryKeys: (limit = 2000) => getJson<DeviceHistoryKeys>(`/api/device_history/keys?limit=${limit}`),

  // -- NeXus export ------------------------------------------------------------
  nexusStatus: () => getJson<{ status: 'ok'; export: NexusExportStatus }>('/api/nexus_export/status'),
  nexusFiles: () => getJson<{ status: 'ok'; files: NexusFileEntry[] }>('/api/nexus_export/files'),
  nexusInspect: (file: string, path = '/') =>
    getJson<{ status: 'ok'; node: NexusNodeInfo }>(
      `/api/nexus_export/inspect?file=${encodeURIComponent(file)}&path=${encodeURIComponent(path)}`,
    ),
  nexusStart: (runName?: string) =>
    postJson<{ status: 'ok'; file_path: string; export: NexusExportStatus }>('/api/nexus_export/start', {
      run_name: runName,
    }),
  nexusStop: () =>
    postJson<{ status: 'ok'; file_path: string | null; export: NexusExportStatus }>('/api/nexus_export/stop', {}),
  nexusDownloadUrl: (file: string) => `/api/nexus_export/download?file=${encodeURIComponent(file)}`,

  // -- CSV data saving ---------------------------------------------------------
  dataSavingStatus: () => getJson<{ status: 'ok'; export: DataSavingStatus }>('/api/data_saving/status'),
  dataSavingStart: (payload: {
    directory?: string | null
    file_name?: string | null
    interval_seconds?: number
    save_nexus?: boolean
  }) =>
    postJson<{ status: 'ok'; file_path: string; nexus_file_path: string | null; export: DataSavingStatus }>(
      '/api/data_saving/start',
      payload,
    ),
  dataSavingStop: () =>
    postJson<{ status: 'ok'; file_path: string | null; nexus_file_path: string | null; export: DataSavingStatus }>(
      '/api/data_saving/stop',
      {},
    ),
  dataSavingDownloadUrl: (file: string) => `/api/data_saving/download?file=${encodeURIComponent(file)}`,

  // -- Storage monitor ---------------------------------------------------------
  storageStatus: () => getJson<{ status: 'ok'; storage: StorageStatus }>('/api/storage/status'),

  // -- Assets ------------------------------------------------------------------
  svgAssets: () => getJson<{ status: 'ok'; files: Array<{ name: string; url: string }> }>('/api/assets/svg'),

  // -- Restart -----------------------------------------------------------------
  restart: () => postJson<{ status: 'ok'; method: string }>('/api/restart', {}),
}
