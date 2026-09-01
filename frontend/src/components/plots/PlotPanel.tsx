/**
 * Plot panel on the canvas — renders a Plotly chart from a PlotPanelState and
 * flushes buffered trace data every 2 s. Port of the plot-panel lifecycle from
 * plots.js (createPlotPanelFromConfig + flushBufferedPoints + refreshPlot).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Plotly from 'plotly.js-dist-min'
import { usePlotStore, sampleTracePoints, MAX_RENDERED_PLOT_POINTS, type PlotPanelState, type LineTraceMeta, type XYTraceMeta, type ArrayTraceMeta, refreshSavedPlotNames, loadPlotConfig } from '../../store/plotStore'
import { useAppStore } from '../../store/appStore'
import { useCanvasDrag } from '../editor/useCanvasDrag'
import { ContactPoints } from '../editor/ContactPoints'
import { useEditorStore } from '../../store/editorStore'
import type { LayoutPlotEntry } from '../../api/types'

function dashForLineType(lineType?: string): string {
  if (lineType === 'dashed') return 'dash'
  if (lineType === 'dotted') return 'dot'
  return 'solid'
}

function applyTraceStyle(trace: Record<string, unknown>, style: { lineType?: string; lineWidth?: number; lineColor?: string; xyChartType?: string } | undefined): void {
  if (!trace) return
  const s = style || {}
  const xyChartType = s.xyChartType
  if (xyChartType === 'bar') {
    trace.type = 'bar'
    trace.orientation = 'v'
    delete trace.mode
    delete trace.fill
    trace.marker = { color: s.lineColor || '#007bff', line: { width: s.lineWidth || 1, color: s.lineColor || '#007bff' } }
    return
  }
  if (xyChartType === 'area') {
    trace.type = 'scatter'
    trace.mode = 'lines'
    trace.fill = 'tozeroy'
  }
  trace.line = { width: s.lineWidth || 2, color: s.lineColor || '#007bff', dash: dashForLineType(s.lineType || 'solid') }
  trace.marker = { color: s.lineColor || '#007bff' }
}

interface PlotPanelProps {
  panel: PlotPanelState
  isConfigure: boolean
  onRemove: (id: string) => void
}

export function PlotPanel({ panel, isConfigure, onRemove }: PlotPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotDivRef = useRef<HTMLDivElement>(null)
  const plots = usePlotStore((s) => s.plots)
  const savedPlotNames = usePlotStore((s) => s.savedPlotNames)
  const createPlot = usePlotStore((s) => s.createPlot)
  const setSelected = useEditorStore((s) => s.setSelected)
  const [title, setTitle] = useState(panel.title)
  const readyRef = useRef(false)

  // Read the freshest panel state from the store each render.
  const live = plots[panel.id] ?? panel

  // Canvas drag/resize (configure mode) — legacy makeDraggable/makeResizable.
  useCanvasDrag(containerRef, {
    enabled: isConfigure,
    minWidth: 200,
    minHeight: 120,
    onDragEnd: (r) => usePlotStore.getState().updateGeometry(panel.id, r),
    onResizeEnd: (r) => {
      usePlotStore.getState().updateGeometry(panel.id, r)
      if (plotDivRef.current) {
        try {
          Plotly.Plots.resize(plotDivRef.current)
        } catch {
          /* noop */
        }
      }
    },
  })

  const layoutForType = useMemo(() => {
    const isXY = live.plotType === 'xy'
    const base: Record<string, unknown> = {
      title: '',
      margin: { t: 30 },
      uirevision: `${live.id}:yaxis`,
      xaxis: isXY
        ? { title: live.xAxisTitle || 'X', type: 'linear', autorange: true }
        : { type: 'date', autorange: true },
      yaxis: { title: isXY ? live.yAxisTitle || 'Y' : live.yAxisTitle || '', type: 'linear', autorange: true },
    }
    // Time-series plots get range selector + slider.
    if (!isXY) {
      ;(base.xaxis as Record<string, unknown>).rangeselector = {
        buttons: [
          { count: 1, step: 'hour', stepmode: 'backward', label: '1h' },
          { count: 3, step: 'hour', stepmode: 'backward', label: '3h' },
          { count: 12, step: 'hour', stepmode: 'backward', label: '12h' },
          { count: 1, step: 'day', stepmode: 'backward', label: '1d' },
          { step: 'all', label: 'All' },
        ],
      }
      ;(base.xaxis as Record<string, unknown>).rangeslider = { visible: true }
    }
    if (!isConfigure) {
      base.dragmode = false
      ;(base.xaxis as Record<string, unknown>).fixedrange = true
      ;(base.yaxis as Record<string, unknown>).fixedrange = true
    }
    return base
  }, [live.plotType, live.xAxisTitle, live.yAxisTitle, live.id, isConfigure])

  // Initial Plotly render.
  useEffect(() => {
    if (!plotDivRef.current) return
    readyRef.current = false
    const config = { responsive: true, scrollZoom: false, doubleClick: false as const, displayModeBar: isConfigure }
    Plotly.react(plotDivRef.current, [], layoutForType as never, config)
      .then(() => {
        readyRef.current = true
      })
      .catch(() => undefined)
    return () => {
      if (plotDivRef.current) {
        try {
          Plotly.purge(plotDivRef.current)
        } catch {
          /* noop */
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.id, isConfigure])

  // Flush buffered data into the plot on a 2 s cadence (legacy flushBufferedPoints).
  // The flush reads the latest panel state from the store at call time. We also
  // subscribe to the store so any dataVersion bump triggers an immediate flush
  // with fresh state (avoids the stale-closure problem where the effect closure
  // captured an empty traces snapshot).
  const flush = useRef<() => void>(() => {})
  flush.current = () => {
    if (!readyRef.current || !plotDivRef.current) return
    const current = usePlotStore.getState().plots[panel.id]
    if (!current) return

    const traceList: Array<Record<string, unknown>> = []
    Object.values(current.traces).forEach((meta) => {
      if (current.plotType === 'array') {
        const parent = meta as ArrayTraceMeta
        Object.values(parent.children).forEach((child) => {
          const trace: Record<string, unknown> = { x: child.x, y: child.y, mode: 'lines+markers', name: child.name, type: 'scatter' }
          applyTraceStyle(trace, child.style)
          traceList.push(trace)
        })
        return
      }
      if (current.plotType === 'xy') {
        const xy = meta as XYTraceMeta
        const trace: Record<string, unknown> = { x: xy.x, y: xy.y, name: xy.name }
        applyTraceStyle(trace, xy.style)
        if (!xy.style?.xyChartType) {
          trace.type = 'scatter'
          trace.mode = 'lines+markers'
        }
        traceList.push(trace)
        return
      }
      const line = meta as LineTraceMeta
      const sampled = sampleTracePoints(line.rawX, line.rawY, MAX_RENDERED_PLOT_POINTS)
      const trace: Record<string, unknown> = { x: sampled.x, y: sampled.y, mode: 'lines+markers', name: line.name, type: 'scatter' }
      applyTraceStyle(trace, line.style)
      traceList.push(trace)
    })

    const plotDiv = plotDivRef.current
    if (!plotDiv) return
    Plotly.react(plotDiv, traceList as never, layoutForType as never, { responsive: true, scrollZoom: false, doubleClick: false as const, displayModeBar: isConfigure })
      .then(() => Plotly.relayout(plotDiv, { 'yaxis.autorange': true }).catch(() => undefined))
      .catch(() => undefined)
  }

  // Periodic flush (matches the legacy 2 s loop).
  useEffect(() => {
    const interval = window.setInterval(() => flush.current(), 2000)
    return () => window.clearInterval(interval)
  }, [])

  // Subscribe to the plot store: flush whenever this panel's data changes.
  useEffect(() => {
    const unsubscribe = usePlotStore.subscribe((state, prev) => {
      if (state.dataVersion !== prev.dataVersion || state.plots[panel.id] !== prev.plots[panel.id]) {
        flush.current()
      }
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.id])

  // Flush immediately when the layout/config inputs change.
  useEffect(() => {
    flush.current()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutForType])

  // Saved-config switcher (top-right).
  const switchConfig = async (name: string) => {
    if (!name) return
    const config = await loadPlotConfig(name)
    if (!config) return
    const geometry = { left: live.left, top: live.top, width: live.width, height: live.height }
    onRemove(panel.id)
    const newId = createPlot(config, { left: geometry.left, top: geometry.top })
    if (newId) {
      usePlotStore.getState().updateGeometry(newId, geometry)
    }
  }

  return (
    <div
      ref={containerRef}
      className={`plot-panel device-box${isConfigure ? ' configure-layout' : ''}`}
      id={`${panel.id}_panel`}
      data-plot-name={live.configName}
      style={{
        position: 'absolute',
        left: live.left,
        top: live.top,
        width: live.width,
        height: live.height,
        maxWidth: 'none',
        zIndex: 5,
      }}
      onMouseDown={() => {
        if (isConfigure) setSelected(`${panel.id}_panel`)
      }}
    >
      <div
        className="plot-title-label"
        contentEditable={isConfigure}
        suppressContentEditableWarning
        title="Click to edit plot title"
        style={{ fontWeight: 'bold', fontSize: 18, textAlign: 'center', margin: '8px 0 4px 0', outline: 'none' }}
        onBlur={(e) => setTitle(e.currentTarget.textContent || live.title)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).blur()
          }
        }}
      >
        {live.title}
      </div>
      <div ref={plotDivRef} id={`${panel.id}_plot`} style={{ width: '100%', height: `calc(100% - 40px)` }} />
      <div className="plot-saved-control" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <select
          className="plot-saved-select"
          value={live.configName}
          onChange={(e) => void switchConfig(e.target.value)}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <option value={live.configName}>{live.configName}</option>
          {savedPlotNames.filter((n) => n !== live.configName).map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>
      {isConfigure && (
        <>
          <div className="resize-handle" />
          <button
            type="button"
            className="close-btn"
            style={{ position: 'absolute', top: 4, right: 4, zIndex: 10 }}
            onClick={(e) => {
              e.stopPropagation()
              onRemove(panel.id)
            }}
          >
            &times;
          </button>
          <ContactPoints boxId={`${panel.id}_panel`} geometry={{ left: live.left, top: live.top, width: live.width, height: live.height }} visible={isConfigure} />
        </>
      )}
    </div>
  )
}

/** Register saved plot names on mount (legacy updatePlotConfigList). */
export function usePlotConfigNames(): void {
  useEffect(() => {
    refreshSavedPlotNames()
  }, [])
}

/** Convert a saved layout plot entry to geometry for the store.
 *  Legacy panels carry an interact.js offset (data-x/data-y + transform)
 *  on top of left/top; we fold that into left/top so the panel lands exactly
 *  where it was saved. */
export function layoutPlotGeometry(p: LayoutPlotEntry): { left: number; top: number; width?: number; height?: number } {
  const parse = (v: string | undefined | null): number | undefined => {
    const n = parseFloat(v || '')
    return Number.isFinite(n) ? n : undefined
  }
  const baseLeft = parse(p.left) ?? 200
  const baseTop = parse(p.top) ?? 80
  const dataX = parse(p.dataX) ?? 0
  const dataY = parse(p.dataY) ?? 0
  // interact.js stores the drag offset in data-x/data-y and applies it via a
  // translate() transform. Fold it into absolute left/top.
  return {
    left: Math.round(baseLeft + dataX),
    top: Math.round(baseTop + dataY),
    width: parse(p.width),
    height: parse(p.height),
  }
}
