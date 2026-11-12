/**
 * Plot subsystem store + live-update engine — React port of plots.js.
 *
 * Holds plot panels (traces with raw time-series buffers), the staging area
 * for the plot-configuration window, saved plot-config names, and the two
 * periodic loops: /api/plot_updates polling (10 s, paused in configure mode)
 * and the 2 s trace flush (handled by mounted PlotPanel components).
 */

import { create } from 'zustand'
import { api } from '../api/client'
import { useAppStore } from './appStore'
import type { PlotConfig, PlotLineConfig, PlotLineStyle } from '../api/types'
import { getStoredPlotConfigs, saveStoredPlotConfig, deleteStoredPlotConfig } from '../utils/storage'

// Live browser buffers are bounded; complete history is stored by the backend.
export const MAX_STORED_PLOT_HISTORY_POINTS = 50000
export const MAX_RENDERED_PLOT_POINTS = 2000
export const MAX_FUTURE_PLOT_SKEW_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// Trace model (per panel)
// ---------------------------------------------------------------------------

export interface LineTraceMeta {
  key: string
  suffix: string
  name: string
  style: PlotLineStyle
  /** Recent raw samples for the live view. */
  rawX: Date[]
  rawY: unknown[]
  /** Sampled series currently rendered. */
  renderX: Date[]
  renderY: unknown[]
  dirty: boolean
}

export interface XYTraceMeta {
  key: string
  name: string
  style: PlotLineStyle
  xKey: string
  yKey: string
  xSuffix: string
  ySuffix: string
  x: number[]
  y: number[]
  latestXSeries?: number[]
  latestYSeries?: number[]
  lastPushedSignature?: string
  dirty: boolean
}

export interface ArrayTraceMeta {
  key: string
  name: string
  style: PlotLineStyle
  isArrayParent: true
  children: Record<string, { x: Date[]; y: unknown[]; name: string; style: PlotLineStyle; dirty: boolean }>
}

export type TraceMeta = LineTraceMeta | XYTraceMeta | ArrayTraceMeta

export interface PlotPanelState {
  id: string
  /** Owning layout page; absent for standalone plots. */
  pageId?: string
  title: string
  configName: string
  plotType: 'line' | 'xy' | 'array' | string
  xAxisTitle: string
  yAxisTitle: string
  traces: Record<string, TraceMeta>
  left: number
  top: number
  width: number
  height: number
}

interface PlotStore {
  plots: Record<string, PlotPanelState>
  /** Saved plot-config names (merged local + server). */
  savedPlotNames: string[]

  createPlot: (config: PlotConfig, position?: { left: number; top: number }, pageId?: string) => string | null
  removePlot: (id: string) => void
  updateGeometry: (id: string, geo: { left: number; top: number; width?: number; height?: number }) => void
  setTitle: (id: string, title: string) => void
  setSavedPlotNames: (names: string[]) => void
}

let plotCounter = 0

export const usePlotStore = create<PlotStore>((set, get) => ({
  plots: {},
  savedPlotNames: [],

  createPlot: (config, position, pageId) => {
    if (!config || !Array.isArray(config.lines) || config.lines.length === 0) return null
    const name = config.name && config.name.trim() ? config.name.trim() : `Plot ${plotCounter + 1}`
    // A configuration can appear independently on multiple layout pages.
    const existing = Object.values(get().plots).find((p) => p.configName === name && p.pageId === pageId)
    if (existing) get().removePlot(existing.id)

    const id = `plot_${++plotCounter}`
    const traces: Record<string, TraceMeta> = {}
    config.lines.forEach((line) => {
      const style: PlotLineStyle = {
        lineType: 'solid',
        lineWidth: 2,
        lineColor: '#007bff',
        ...(line.style || {}),
      }
      if (config.plotType === 'array') {
        traces[line.key] = { key: line.key, name: line.key, style, isArrayParent: true, children: {} }
      } else if (config.plotType === 'xy') {
        const xKey = line.xKey || ''
        const yKey = line.yKey || ''
        traces[line.key] = {
          key: line.key,
          name: line.label || `${yKey} vs ${xKey}`,
          style,
          xKey,
          yKey,
          xSuffix: line.xSuffix || xKey,
          ySuffix: line.ySuffix || yKey,
          x: [],
          y: [],
          dirty: false,
        }
      } else {
        traces[line.key] = {
          key: line.key,
          suffix: line.suffix || line.key,
          name: line.label || line.key,
          style,
          rawX: [],
          rawY: [],
          renderX: [],
          renderY: [],
          dirty: false,
        }
      }
    })

    const panel: PlotPanelState = {
      id,
      pageId,
      title: name,
      configName: name,
      plotType: config.plotType || 'line',
      xAxisTitle: config.xAxisTitle || '',
      yAxisTitle: config.yAxisTitle || '',
      traces,
      left: position?.left ?? 200,
      top: position?.top ?? 80,
      width: 700,
      height: 420,
    }
    set((s) => ({ plots: { ...s.plots, [id]: panel } }))
    return id
  },

  removePlot: (id) =>
    set((s) => {
      const next = { ...s.plots }
      delete next[id]
      return { plots: next }
    }),

  updateGeometry: (id, geo) =>
    set((s) => {
      const p = s.plots[id]
      if (!p) return s
      return {
        plots: {
          ...s.plots,
          [id]: {
            ...p,
            left: geo.left,
            top: geo.top,
            width: geo.width ?? p.width,
            height: geo.height ?? p.height,
          },
        },
      }
    }),

  setTitle: (id, title) =>
    set((s) => {
      const p = s.plots[id]
      if (!p) return s
      return { plots: { ...s.plots, [id]: { ...p, title } } }
    }),

  setSavedPlotNames: (names) => set({ savedPlotNames: Array.from(new Set(names)).sort() }),
}))

// ---------------------------------------------------------------------------
// Key matching / timestamp / sampling helpers (ported from plots.js)
// ---------------------------------------------------------------------------

export function splitPlotKey(key: string): { device: string; param: string } {
  const raw = String(key || '').trim()
  const dotIndex = raw.lastIndexOf('.')
  if (dotIndex === -1) return { device: raw, param: '' }
  return { device: raw.slice(0, dotIndex), param: raw.slice(dotIndex + 1) }
}

function getCanonicalPlotKey(key: string): string {
  const parts = splitPlotKey(key)
  if (!parts.device || !parts.param) return key
  const deviceParams = useAppStore.getState().deviceParams ?? {}
  const info = deviceParams[parts.device]
  const moduleName = info?.module_name || info?.original_name || parts.device
  return `${moduleName}.${parts.param}`
}

export function plotKeyMatches(emittedKey: string, candidateKey: string): boolean {
  const rawEmitted = String(emittedKey || '').trim()
  const rawCandidate = String(candidateKey || '').trim()
  if (!rawEmitted || !rawCandidate) return false
  if (rawEmitted === rawCandidate || rawEmitted.endsWith(rawCandidate)) return true
  const canonEmitted = getCanonicalPlotKey(rawEmitted)
  const canonCandidate = getCanonicalPlotKey(rawCandidate)
  return !!canonEmitted && canonEmitted === canonCandidate
}

export function normalizePlotEventTimestamp(timestampMs: unknown, isLive: boolean): number {
  const numeric = Number(timestampMs)
  const nowMs = Date.now()
  const minAllowed = nowMs - 30 * 24 * 60 * 60 * 1000
  const maxAllowed = nowMs + MAX_FUTURE_PLOT_SKEW_MS
  if (isLive) return nowMs
  if (!Number.isFinite(numeric)) return nowMs
  if (numeric < minAllowed || numeric > maxAllowed) return nowMs
  return numeric
}

/** Preserve extrema and gaps instead of moving an evenly-spaced sample grid on every update. */
export function sampleTracePoints(xValues: unknown[], yValues: unknown[], maxPoints = MAX_RENDERED_PLOT_POINTS): { x: unknown[]; y: unknown[] } {
  const xSource = Array.isArray(xValues) ? xValues : []
  const ySource = Array.isArray(yValues) ? yValues : []
  const total = Math.min(xSource.length, ySource.length)
  const limit = Math.max(2, Math.floor(Number(maxPoints) || MAX_RENDERED_PLOT_POINTS))
  if (total <= limit) return { x: xSource.slice(0, total), y: ySource.slice(0, total) }
  if (limit < 7) return { x: [xSource[0], xSource[total - 1]], y: [ySource[0], ySource[total - 1]] }

  // Each bucket contributes at most first/min/max/last/gap, plus global endpoints.
  const capacity = Math.floor((limit - 2) / 5)
  const firstTime = Number(xSource[0])
  const duration = Number(xSource[total - 1]) - firstTime
  const timeSeries = capacity > 1 && xSource[0] instanceof Date && duration > 0 && Number.isFinite(duration)
  // Power-of-two bucket sizes keep completed buckets stable as the live tail grows.
  // Time buckets are anchored to the clock, so replayed points don't shift the grid.
  const width = timeSeries
    ? 2 ** Math.max(0, Math.ceil(Math.log2(duration / Math.max(1, capacity - 1))))
    : 2 ** Math.ceil(Math.log2(total / capacity))
  const indices = new Set<number>([0, total - 1])
  let bucket: number | undefined
  let first = 0
  let last = 0
  let min = -1
  let max = -1
  let gap = -1
  const flush = () => {
    indices.add(first)
    indices.add(last)
    if (min >= 0) indices.add(min)
    if (max >= 0) indices.add(max)
    if (gap >= 0) indices.add(gap)
  }
  for (let i = 0; i < total; i += 1) {
    const key = Math.floor((timeSeries ? Number(xSource[i]) : i) / width)
    if (key !== bucket) {
      if (bucket !== undefined) flush()
      bucket = key
      first = i
      min = max = gap = -1
    }
    last = i
    const value = ySource[i]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      if (gap < 0) gap = i
    } else {
      if (min < 0 || value < (ySource[min] as number)) min = i
      if (max < 0 || value > (ySource[max] as number)) max = i
    }
  }
  flush()
  const ordered = [...indices].sort((a, b) => a - b)
  return { x: ordered.map((i) => xSource[i]), y: ordered.map((i) => ySource[i]) }
}

// ---------------------------------------------------------------------------
// Live-update ingestion (spinupdate + plot polling) -> trace buffers
// ---------------------------------------------------------------------------

function normalizeScalar(value: unknown): unknown {
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === 'number') return value
  const n = parseFloat(String(value))
  return Number.isFinite(n) ? n : null
}

function normalizeXYSeries(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'number' ? item : parseFloat(String(item))))
  }
  const n = typeof value === 'number' ? value : parseFloat(String(value))
  return Number.isFinite(n) ? [n] : []
}

/** Trim in chunks so a full buffer doesn't shift 50,000 entries on every sample. */
function trimTraceHistory(x: unknown[], y: unknown[]): void {
  if (x.length <= MAX_STORED_PLOT_HISTORY_POINTS) return
  const remove = x.length - Math.floor(MAX_STORED_PLOT_HISTORY_POINTS * 0.9)
  x.splice(0, remove)
  y.splice(0, remove)
}

/** Merge live and delayed poll samples into one chronological trace, ignoring exact replays. */
function appendTimeSample(x: Date[], y: unknown[], time: Date, value: unknown): boolean {
  const timestamp = time.getTime()
  if (!x.length || timestamp > x[x.length - 1].getTime()) {
    x.push(time)
    y.push(value)
  } else {
    // Upper bound keeps distinct measurements with the same millisecond in arrival order.
    let low = 0
    let high = x.length
    while (low < high) {
      const mid = Math.floor((low + high) / 2)
      if (x[mid].getTime() <= timestamp) low = mid + 1
      else high = mid
    }
    for (let i = low - 1; i >= 0 && x[i].getTime() === timestamp; i -= 1) {
      if (Object.is(y[i], value)) return false
    }
    x.splice(low, 0, time)
    y.splice(low, 0, value)
  }
  trimTraceHistory(x, y)
  return true
}

/** Route one live update into matching plot traces. */
export function ingestPlotUpdate(key: string, value: unknown, timestampMs: number, isLive: boolean): void {
  // Live updates are muted in configure mode (legacy isConfigurationModeActive gate).
  if (useAppStore.getState().configurationMode) return

  const store = usePlotStore.getState()
  const now = new Date(normalizePlotEventTimestamp(timestampMs, isLive))

  Object.values(store.plots).forEach((panel) => {
    Object.keys(panel.traces).forEach((traceKey) => {
      const meta = panel.traces[traceKey]

      if ((meta as ArrayTraceMeta).isArrayParent) {
        const parent = meta as ArrayTraceMeta
        if (plotKeyMatches(key, traceKey) && Array.isArray(value)) {
          value.forEach((elem, idx) => {
            const childKey = `${traceKey}::${idx}`
            if (!parent.children[childKey]) {
              parent.children[childKey] = { x: [], y: [], name: `${traceKey}[${idx}]`, style: parent.style, dirty: true }
            }
            const child = parent.children[childKey]
            if (appendTimeSample(child.x, child.y, now, normalizeScalar(elem))) child.dirty = true
          })
        }
        return
      }

      const xy = meta as XYTraceMeta
      const isXY = panel.plotType === 'xy'
      const xyMatchX = isXY && xy.xSuffix && (plotKeyMatches(key, xy.xKey) || plotKeyMatches(key, xy.xSuffix))
      const xyMatchY = isXY && xy.ySuffix && (plotKeyMatches(key, xy.yKey) || plotKeyMatches(key, xy.ySuffix))

      if (isXY && (xyMatchX || xyMatchY)) {
        const series = normalizeXYSeries(value)
        if (series.length) {
          if (xyMatchX) xy.latestXSeries = series
          if (xyMatchY) xy.latestYSeries = series
          // Append deduplicated batch.
          const xVals = xy.latestXSeries ?? []
          const yVals = xy.latestYSeries ?? []
          const pairCount = Math.min(xVals.length, yVals.length)
          if (pairCount) {
            const batch = { x: xVals.slice(0, pairCount), y: yVals.slice(0, pairCount) }
            const signature = JSON.stringify(batch)
            if (xy.lastPushedSignature !== signature) {
              // Avoid argument-limit failures for large instrument array batches.
              const start = Math.max(0, pairCount - MAX_STORED_PLOT_HISTORY_POINTS)
              for (let i = start; i < pairCount; i += 1) {
                xy.x.push(batch.x[i])
                xy.y.push(batch.y[i])
              }
              trimTraceHistory(xy.x, xy.y)
              xy.lastPushedSignature = signature
              xy.dirty = true
            }
          }
        }
        return
      }

      // Line plot scalar.
      const line = meta as LineTraceMeta
      if (plotKeyMatches(key, traceKey) || plotKeyMatches(key, line.suffix)) {
        if (appendTimeSample(line.rawX, line.rawY, now, normalizeScalar(value))) line.dirty = true
      }
    })
  })
}

// ---------------------------------------------------------------------------
// Polling loop (/api/plot_updates) — replays samples missed while asleep
// ---------------------------------------------------------------------------

let pollCursorMs = 0
let pollInFlight = false
let pollStarted = false

export function startPlotPolling(): void {
  if (pollStarted) return
  pollStarted = true

  const pollOnce = async () => {
    if (pollInFlight) return
    if (useAppStore.getState().configurationMode) return
    // Keep the initial history cursor until a plot is ready to receive it.
    if (!Object.keys(usePlotStore.getState().plots).length) return
    pollInFlight = true
    try {
      const payload = await api.plotUpdates(pollCursorMs > 0 ? pollCursorMs : undefined)
      let maxTs = 0
      if (payload.mode === 'history') {
        const pending: Array<{ key: string; ts: number; value: unknown }> = []
        Object.entries(payload.samples || {}).forEach(([key, samples]) => {
          ;(samples || []).forEach((sample) => {
            pending.push({ key, ts: Number(sample?.timestamp_ms) || 0, value: sample?.value })
            maxTs = Math.max(maxTs, Number(sample?.timestamp_ms) || 0)
          })
        })
        pending.sort((a, b) => a.ts - b.ts).forEach((e) => ingestPlotUpdate(e.key, e.value, e.ts, false))
      } else {
        Object.entries(payload.values || {}).forEach(([key, meta]) => {
          maxTs = Math.max(maxTs, Number(meta?.timestamp_ms) || 0)
          ingestPlotUpdate(key, meta?.value, meta?.timestamp_ms ?? Date.now(), false)
        })
      }
      pollCursorMs = Math.max(pollCursorMs, maxTs, Number(payload.server_time_ms || Date.now()))
    } catch {
      /* polling is best-effort */
    } finally {
      pollInFlight = false
    }
  }

  void pollOnce()
  window.setInterval(() => void pollOnce(), 10000)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void pollOnce()
  })
  window.addEventListener('focus', () => void pollOnce())
}

// ---------------------------------------------------------------------------
// Saved plot configs (localStorage + server)
// ---------------------------------------------------------------------------

export function getSavedPlotNames(): string[] {
  return usePlotStore.getState().savedPlotNames
}

export function refreshSavedPlotNames(): void {
  const local = Object.keys(getStoredPlotConfigs())
  usePlotStore.getState().setSavedPlotNames(local)
  api
    .listPlotConfigs()
    .then((payload) => {
      const merged = Array.from(new Set([...local, ...(payload.names ?? [])])).sort()
      usePlotStore.getState().setSavedPlotNames(merged)
    })
    .catch(() => undefined)
}

export function loadPlotConfig(name: string): Promise<PlotConfig | null> {
  const cached = getStoredPlotConfigs()[name]
  if (cached && Array.isArray(cached.lines) && cached.lines.length) {
    return Promise.resolve(cached)
  }
  return api
    .getPlotConfig(name)
    .then((payload) => {
      const config = payload.config
      if (config) saveStoredPlotConfig(name, config)
      return config ?? null
    })
    .catch(() => null)
}

export function savePlotConfig(config: PlotConfig): void {
  if (!config?.name) return
  saveStoredPlotConfig(config.name, config)
  api.nodemanager('save_plot_config', { name: config.name, config }).catch(() => undefined)
  refreshSavedPlotNames()
}

export function deletePlotConfig(name: string): void {
  deleteStoredPlotConfig(name)
  api.nodemanager('delete_plot_config', { name }).catch(() => undefined)
  refreshSavedPlotNames()
}

/** Convert a saved layout plot entry into a PlotConfig (legacy restorePlotPanelFromLayout). */
export function layoutPlotToConfig(plot: {
  id?: string
  title?: string
  configName?: string
  plotType?: string
  xAxisTitle?: string
  yAxisTitle?: string
  traces?: string[]
}): PlotConfig {
  return {
    name: plot.configName || plot.title || `Plot ${plotCounter + 1}`,
    plotType: plot.plotType || 'line',
    xAxisTitle: plot.xAxisTitle || '',
    yAxisTitle: plot.yAxisTitle || '',
    lines: Array.isArray(plot.traces)
      ? plot.traces.map((key): PlotLineConfig => ({ key, suffix: key, style: { lineType: 'solid', lineWidth: 2, lineColor: '#007bff' } }))
      : [],
  }
}
