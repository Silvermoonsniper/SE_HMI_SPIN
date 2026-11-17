/**
 * Plot panel on the canvas — renders a Plotly chart from a PlotPanelState and
 * appends live samples individually on animation frames. Port of the plot-panel lifecycle from
 * plots.js (createPlotPanelFromConfig + flushBufferedPoints + refreshPlot).
 */

import { useEffect, useMemo, useRef } from 'react'
import Plotly from 'plotly.js-dist-min'
import { usePlotStore, sampleTracePoints, MAX_RENDERED_PLOT_POINTS, type PlotPanelState, type LineTraceMeta, type XYTraceMeta, subscribePlotSamples, type PlotSampleEvent, refreshSavedPlotNames, loadPlotConfig } from '../../store/plotStore'
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
  /** Fill a standalone browser window instead of using canvas geometry. */
  standalone?: boolean
  onRemove: (id: string) => void
}

export function PlotPanel({ panel, isConfigure, standalone = false, onRemove }: PlotPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const plotDivRef = useRef<HTMLDivElement>(null)
  const live = usePlotStore((s) => s.plots[panel.id]) ?? panel
  const savedPlotNames = usePlotStore((s) => s.savedPlotNames)
  const createPlot = usePlotStore((s) => s.createPlot)
  const setSelected = useEditorStore((s) => s.setSelected)
  const readyRef = useRef(false)

  // Serialize Plotly work, including teardown during fast page switches.
  const renderQueue = useRef<Promise<void>>(Promise.resolve())

  // Canvas drag/resize (configure mode) — legacy makeDraggable/makeResizable.
  useCanvasDrag(containerRef, {
    enabled: isConfigure && !standalone,
    minWidth: 200,
    minHeight: 120,
    onDragEnd: (r) => usePlotStore.getState().updateGeometry(panel.id, r),
    onResizeEnd: (r) => {
      usePlotStore.getState().updateGeometry(panel.id, r)
      const plotDiv = plotDivRef.current
      renderQueue.current = renderQueue.current.then(async () => {
        if (plotDiv?.isConnected && readyRef.current) await Plotly.Plots.resize(plotDiv)
      }).catch(() => undefined)
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

  // Append one incoming timestamp per animation frame. History recovery and bounded
  // display compaction use a full snapshot; neither can build an unbounded render queue.
  useEffect(() => {
    const plotDiv = plotDivRef.current
    if (!plotDiv) return
    type Point = Extract<PlotSampleEvent, { type: 'point' }>
    const rendered = new Map<string, { index: number; count: number; markers: boolean }>()
    const liveTailReserve = 256
    let pending: Point[] = []
    let cancelled = false
    let rendering = false
    let forceRender = true
    let frame: number | null = null
    let retryTimer: number | null = null
    readyRef.current = false

    const schedule = () => {
      if (!cancelled && !rendering && frame === null && retryTimer === null && !document.hidden) frame = window.requestAnimationFrame(render)
    }
    const render = () => {
      frame = null
      if (cancelled || rendering || document.hidden || !plotDiv.isConnected) return
      const current = usePlotStore.getState().plots[panel.id]
      if (!current || (!forceRender && !pending.length)) return
      rendering = true
      renderQueue.current = renderQueue.current.then(async () => {
        if (cancelled) return
        if (pending.some((point) => {
          const trace = rendered.get(point.key)
          return !trace || trace.count >= MAX_RENDERED_PLOT_POINTS || (trace.markers && trace.count >= 200)
        })) forceRender = true
        if (forceRender) {
          pending = []
          rendered.clear()
          const traceList: Array<Record<string, unknown>> = []
          const add = (key: string, x: unknown[], y: unknown[], name: string, style: LineTraceMeta['style'], xy = false) => {
            const sampled = sampleTracePoints(x, y, MAX_RENDERED_PLOT_POINTS - liveTailReserve)
            const markers = x.length <= 200
            const trace: Record<string, unknown> = { x: sampled.x, y: sampled.y, name, type: 'scatter', mode: markers ? 'lines+markers' : 'lines' }
            applyTraceStyle(trace, style)
            rendered.set(key, { index: traceList.length, count: sampled.x.length, markers: !xy && markers })
            traceList.push(trace)
          }
          Object.entries(current.traces).forEach(([key, meta]) => {
            if ('isArrayParent' in meta) {
              Object.entries(meta.children).forEach(([childKey, child]) => {
                add(childKey, child.x, child.y, child.name, child.style)
                child.dirty = false
              })
            } else if (current.plotType === 'xy') {
              const xy = meta as XYTraceMeta
              add(key, xy.x, xy.y, xy.name, xy.style, true)
              xy.dirty = false
            } else {
              const line = meta as LineTraceMeta
              add(key, line.rawX, line.rawY, line.name, line.style)
              line.dirty = false
            }
          })
          forceRender = false
          await Plotly.react(plotDiv, traceList as never, {
            ...layoutForType,
            xaxis: { ...(layoutForType.xaxis as object) },
            yaxis: { ...(layoutForType.yaxis as object), autorange: true },
          } as never, { responsive: true, scrollZoom: false, doubleClick: false as const, displayModeBar: isConfigure })
        } else {
          pending.sort((a, b) => a.x.getTime() - b.x.getTime())
          const timestamp = pending[0].x.getTime()
          const points: Point[] = []
          while (pending.length && pending[0].x.getTime() === timestamp) points.push(pending.shift()!)
          const indices: number[] = []
          const x: Date[][] = []
          const y: unknown[][] = []
          points.forEach((point) => {
            const trace = rendered.get(point.key)!
            indices.push(trace.index)
            x.push([point.x])
            y.push([point.y])
            trace.count += 1
          })
          await Plotly.extendTraces(plotDiv, { x, y } as never, indices)
        }
        if (!cancelled) readyRef.current = true
      }).catch(() => {
        forceRender = true
        if (!cancelled) retryTimer = window.setTimeout(() => { retryTimer = null; schedule() }, 500)
      }).finally(() => {
        rendering = false
        if (forceRender || pending.length) schedule()
      })
    }
    const unsubscribe = subscribePlotSamples(panel.id, (event) => {
      if (document.hidden) { forceRender = true; pending = []; return }
      if (event.type === 'refresh' || !event.live || !event.appended) forceRender = true
      else {
        pending.push(event)
        if (pending.length > liveTailReserve) { pending = []; forceRender = true }
      }
      schedule()
    })
    const visibility = () => { forceRender = true; pending = []; schedule() }
    document.addEventListener('visibilitychange', visibility)
    schedule()
    return () => {
      cancelled = true
      readyRef.current = false
      unsubscribe()
      if (frame !== null) window.cancelAnimationFrame(frame)
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      document.removeEventListener('visibilitychange', visibility)
      renderQueue.current = renderQueue.current.then(() => { Plotly.purge(plotDiv) }).catch(() => undefined)
    }
  }, [panel.id, isConfigure, layoutForType])

  // A detached plot follows the browser window size rather than canvas handles.
  useEffect(() => {
    const container = containerRef.current
    const plotDiv = plotDivRef.current
    if (!standalone || !container || !plotDiv) return
    let resizeQueued = false
    const resize = () => {
      if (!readyRef.current || resizeQueued) return
      resizeQueued = true
      renderQueue.current = renderQueue.current.then(async () => {
        if (plotDiv.isConnected && readyRef.current) await Plotly.Plots.resize(plotDiv)
      }).catch(() => undefined).finally(() => { resizeQueued = false })
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    return () => observer.disconnect()
  }, [standalone, panel.id])

  // Saved-config switcher (top-right).
  const switchConfig = async (name: string) => {
    if (!name) return
    const config = await loadPlotConfig(name)
    if (!config) return
    const geometry = { left: live.left, top: live.top, width: live.width, height: live.height }
    onRemove(panel.id)
    const newId = createPlot(config, { left: geometry.left, top: geometry.top }, live.pageId)
    if (newId) {
      usePlotStore.getState().updateGeometry(newId, geometry)
    }
  }

  return (
    <div
      ref={containerRef}
      className={`plot-panel device-box${standalone ? ' standalone-plot-panel' : ''}${isConfigure ? ' configure-layout' : ''}`}
      id={`${panel.id}_panel`}
      data-plot-name={live.configName}
      style={{
        position: standalone ? 'relative' : 'absolute',
        left: standalone ? 0 : live.left,
        top: standalone ? 0 : live.top,
        width: standalone ? '100%' : live.width,
        height: standalone ? '100%' : live.height,
        maxWidth: 'none',
        zIndex: 5,
      }}
      onMouseDown={() => {
        if (isConfigure && !standalone) setSelected(`${panel.id}_panel`)
      }}
    >
      <div
        className="plot-title-label"
        contentEditable={isConfigure}
        suppressContentEditableWarning
        title="Click to edit plot title"
        style={{ fontWeight: 'bold', fontSize: 18, textAlign: 'center', margin: '8px 0 4px 0', outline: 'none' }}
        onBlur={(e) => usePlotStore.getState().setTitle(panel.id, e.currentTarget.textContent || live.title)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).blur()
          }
        }}
      >
        {live.title}
      </div>
      <div ref={plotDivRef} id={`${panel.id}_plot`} style={{ width: '100%', height: standalone ? undefined : 'calc(100% - 40px)', flex: standalone ? 1 : undefined, minHeight: standalone ? 0 : undefined }} />
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
      {isConfigure && !standalone && (
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
