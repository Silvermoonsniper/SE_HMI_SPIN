/**
 * Plot configuration window — React port of the #plots-panel floating modal
 * from content/plots.html + plots.js (staged lines, plot type, styles, XY axis
 * titles, saved plot configs). Opened from the canvas create menu.
 */

import { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { usePlotStore, savePlotConfig, deletePlotConfig, getSavedPlotNames, refreshSavedPlotNames } from '../../store/plotStore'
import { getStoredPlotConfigs } from '../../utils/storage'
import { appAlert, appConfirm, appPrompt } from '../../store/dialogStore'
import type { PlotConfig, PlotLineConfig, PlotLineStyle } from '../../api/types'

interface PlotConfigWindowProps {
  open: boolean
  onClose: () => void
  /** Returns whether the standalone plot window opened successfully. */
  onCreatePlot: (config: PlotConfig) => boolean
}

interface StagedLine extends PlotLineConfig {
  key: string
  style: PlotLineStyle
}

export function PlotConfigWindow({ open, onClose, onCreatePlot }: PlotConfigWindowProps) {
  const deviceParams = useAppStore((s) => s.deviceParams)
  const savedPlotNames = usePlotStore((s) => s.savedPlotNames)

  const [plotType, setPlotType] = useState<'line' | 'xy' | 'array'>('line')
  const [xyChartType, setXyChartType] = useState<'area' | 'bar'>('area')
  const [lineType, setLineType] = useState('solid')
  const [lineWidth, setLineWidth] = useState('2')
  const [lineColor, setLineColor] = useState('#007bff')
  const [singleKey, setSingleKey] = useState('')
  const [xKey, setXKey] = useState('')
  const [yKey, setYKey] = useState('')
  const [xAxisTitle, setXAxisTitle] = useState('')
  const [yAxisTitle, setYAxisTitle] = useState('')
  const [staged, setStaged] = useState<Record<string, StagedLine>>({})
  const [selectedStaged, setSelectedStaged] = useState('')
  const [selectedSaved, setSelectedSaved] = useState('')

  useEffect(() => {
    if (open) {
      refreshSavedPlotNames()
      setSelectedSaved('')
    }
  }, [open])

  // Flat device.param options from device metadata (legacy populateParamSelect).
  const paramOptions = useMemo(() => {
    const out: string[] = []
    Object.entries(deviceParams ?? {}).forEach(([device, info]) => {
      const params = Array.isArray(info?.all_params) ? info.all_params : []
      params.forEach((param) => out.push(`${device}.${param}`))
    })
    return out.sort()
  }, [deviceParams])

  if (!open) return null

  const isXY = plotType === 'xy'
  const isArray = plotType === 'array'

  const addLine = async () => {
    const style: PlotLineStyle = { lineType, lineWidth: Number(lineWidth) || 2, lineColor }
    let key = ''
    let prepared: StagedLine | null = null
    if (isXY) {
      if (!xKey || !yKey) {
        await appAlert('Select both X and Y device parameters to add an XY curve')
        return
      }
      key = `${xKey}::${yKey}`
      prepared = { key, suffix: key, xKey, yKey, xSuffix: xKey, ySuffix: yKey, label: `${yKey} vs ${xKey}`, style }
    } else {
      key = singleKey.trim()
      if (!key) {
        await appAlert('Select a device parameter to add')
        return
      }
      prepared = { key, suffix: key, style }
    }
    if (staged[key]) {
      await appAlert('Parameter already staged')
      return
    }
    setStaged((prev) => ({ ...prev, [key]: prepared! }))
    setSelectedStaged(key)
  }

  const deleteLine = async () => {
    if (!selectedStaged || !staged[selectedStaged]) {
      await appAlert('Select a staged line to delete')
      return
    }
    setStaged((prev) => {
      const next = { ...prev }
      delete next[selectedStaged]
      return next
    })
    setSelectedStaged('')
  }

  const buildConfig = (name: string): PlotConfig => {
    const lines: PlotLineConfig[] = Object.values(staged).map((meta) => ({
      key: meta.key,
      suffix: meta.suffix,
      xKey: meta.xKey || '',
      yKey: meta.yKey || '',
      xSuffix: meta.xSuffix || '',
      ySuffix: meta.ySuffix || '',
      label: meta.label || '',
      style: isXY ? { ...meta.style, xyChartType } : meta.style,
    }))
    const first = lines[0]
    return {
      name,
      plotType,
      xAxisTitle: isXY ? xAxisTitle || first?.xKey || 'X' : '',
      yAxisTitle: isXY ? yAxisTitle || first?.yKey || 'Y' : '',
      lines,
      savedAt: new Date().toISOString(),
    }
  }

  const createPlot = async () => {
    const lines = Object.values(staged)
    if (!lines.length) {
      await appAlert('No lines staged. Use Add Line to stage parameters before creating a plot.')
      return
    }
    const enteredName = await appPrompt('Enter a name for this plot:', selectedSaved || `Plot ${Object.keys(usePlotStore.getState().plots).length + 1}`, 'Create Plot')
    if (!enteredName || !enteredName.trim()) return
    const config = buildConfig(enteredName.trim())
    savePlotConfig(config)
    if (onCreatePlot(config)) onClose()
  }

  const loadSaved = async (name: string) => {
    if (!name) return
    setSelectedSaved(name)
    const configs = getStoredPlotConfigs()
    let config = configs[name]
    if (!config || !Array.isArray(config.lines) || !config.lines.length) {
      try {
        const { api } = await import('../../api/client')
        const payload = await api.getPlotConfig(name)
        config = payload.config
      } catch {
        return
      }
    }
    if (!config) return
    setPlotType((config.plotType as 'line' | 'xy' | 'array') || 'line')
    const nextStaged: Record<string, StagedLine> = {}
    ;(config.lines || []).forEach((line) => {
      nextStaged[line.key] = {
        key: line.key,
        suffix: line.suffix || line.key,
        xKey: line.xKey || '',
        yKey: line.yKey || '',
        xSuffix: line.xSuffix || '',
        ySuffix: line.ySuffix || '',
        label: line.label || '',
        style: { lineType: 'solid', lineWidth: 2, lineColor: '#007bff', ...(line.style || {}) },
      }
    })
    setStaged(nextStaged)
    const first = (config.lines || [])[0]
    if (first) {
      if (config.plotType === 'xy') {
        setXKey(first.xKey || '')
        setYKey(first.yKey || '')
        setXAxisTitle(config.xAxisTitle || first.xKey || '')
        setYAxisTitle(config.yAxisTitle || first.yKey || '')
        setXyChartType((first.style?.xyChartType as 'area' | 'bar') || 'area')
      } else {
        setSingleKey(first.key)
      }
    }
  }

  const deleteSaved = async () => {
    if (!selectedSaved) {
      await appAlert('Select a saved plot to delete')
      return
    }
    const confirmed = await appConfirm(`Delete plot config "${selectedSaved}"?`, 'Delete Plot')
    if (!confirmed) return
    deletePlotConfig(selectedSaved)
    setSelectedSaved('')
  }

  const stagedKeys = Object.keys(staged)

  return (
    <>
      <div className="plot-config-window-backdrop is-open" onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.35)', zIndex: 4000 }} />
      <div
        id="plots-panel"
        className="plot-config-window-shell plot-config-window-open"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 4001,
          background: '#f6fff6',
          border: '1px solid #c7f0c7',
          borderRadius: 6,
          padding: 12,
          minWidth: 620,
          maxWidth: '92vw',
          boxShadow: '0 18px 40px rgba(15,23,42,0.28)',
        }}
      >
        <div className="plot-config-window-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="plot-config-window-title" style={{ fontWeight: 700 }}>Plot configuration</div>
          <button type="button" className="plot-config-window-close" onClick={onClose}>Close</button>
        </div>

        <div className="plots-container">
          <div className="plots-top">
            <div className="plots-steps" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div className="plot-step" style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 360 }}>
                <label htmlFor="plot-type" style={{ fontWeight: 600 }}>Configure Plot</label>
                <div className="plot-config-row" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select id="plot-type" className="ctrl" title="Plot type" value={plotType} onChange={(e) => { setPlotType(e.target.value as 'line' | 'xy' | 'array'); setStaged({}); setSelectedStaged('') }}>
                    <option value="line">Time series</option>
                    <option value="xy">XY plot</option>
                    <option value="array">Array plot</option>
                  </select>
                  {isXY && (
                    <select id="xy-chart-type" className="ctrl" title="XY chart type" value={xyChartType} onChange={(e) => setXyChartType(e.target.value as 'area' | 'bar')}>
                      <option value="area">Area chart</option>
                      <option value="bar">Bar chart</option>
                    </select>
                  )}
                  <select id="curve-line-type" className="ctrl" title="Line type" value={lineType} onChange={(e) => setLineType(e.target.value)}>
                    <option value="solid">Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                  </select>
                  <select id="curve-line-width" className="ctrl" title="Line width" value={lineWidth} onChange={(e) => setLineWidth(e.target.value)}>
                    <option value="1">1 px</option>
                    <option value="2">2 px</option>
                    <option value="4">4 px</option>
                    <option value="6">6 px</option>
                  </select>
                  <input id="curve-line-color" className="ctrl" type="color" value={lineColor} title="Line color" onChange={(e) => setLineColor(e.target.value)} />
                  <button id="add-curve" className="ctrl" onClick={() => void addLine()}>Add Line</button>
                </div>

                <div className="plot-parameter-row" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {!isXY && (
                    <select id="curve-key" className="ctrl" value={singleKey} onChange={(e) => setSingleKey(e.target.value)} style={{ minWidth: 280 }}>
                      <option value="">-- select device.param --</option>
                      {paramOptions.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  )}
                  {isXY && (
                    <div id="xy-curve-key-group" className="xy-curve-key-group" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <span className="xy-axis-tag">X</span>
                      <select id="curve-key-x" className="ctrl" value={xKey} onChange={(e) => setXKey(e.target.value)}>
                        <option value="">-- select x device.param --</option>
                        {paramOptions.map((k) => (
                          <option key={`x-${k}`} value={k}>{k}</option>
                        ))}
                      </select>
                      <span className="xy-axis-tag">Y</span>
                      <select id="curve-key-y" className="ctrl" value={yKey} onChange={(e) => setYKey(e.target.value)}>
                        <option value="">-- select y device.param --</option>
                        {paramOptions.map((k) => (
                          <option key={`y-${k}`} value={k}>{k}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {isXY && (
                  <div id="xy-axis-title-group" className="xy-axis-title-group" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="xy-axis-tag">X</span>
                    <input id="xy-axis-title-x" className="ctrl xy-axis-title-input" type="text" placeholder="X axis name" value={xAxisTitle} onChange={(e) => setXAxisTitle(e.target.value)} />
                    <span className="xy-axis-tag">Y</span>
                    <input id="xy-axis-title-y" className="ctrl xy-axis-title-input" type="text" placeholder="Y axis name" value={yAxisTitle} onChange={(e) => setYAxisTitle(e.target.value)} />
                  </div>
                )}

                <label htmlFor="added-lines" style={{ fontWeight: 600 }}>Staged lines</label>
                <div className="staged-lines-row" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <div id="added-lines-list" className="staged-lines-list" role="listbox" style={{ minWidth: 320, minHeight: 60, border: '1px solid #cbd5e1', borderRadius: 6, padding: 4, background: '#fff', flex: 1 }}>
                    {stagedKeys.length === 0 ? (
                      <div className="staged-lines-empty">-- added lines --</div>
                    ) : (
                      stagedKeys.map((key) => {
                        const meta = staged[key]
                        const style = meta.style || {}
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`staged-line-item${key === selectedStaged ? ' is-selected' : ''}`}
                            role="option"
                            aria-selected={key === selectedStaged}
                            onClick={() => setSelectedStaged(key)}
                            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: key === selectedStaged ? '#e0f2fe' : 'transparent', padding: '4px 6px', cursor: 'pointer', textAlign: 'left' }}
                          >
                            <span className="staged-line-swatch" style={{ backgroundColor: style.lineColor || '#007bff', display: 'inline-block', width: 12, height: 12, borderRadius: 2 }} />
                            <span className="staged-line-label">
                              {meta.xKey && meta.yKey ? `${meta.yKey} vs ${meta.xKey}` : key} ({style.lineType || 'solid'}, {style.lineWidth || 2}px)
                            </span>
                          </button>
                        )
                      })
                    )}
                  </div>
                  <button id="delete-line" className="ctrl" onClick={() => void deleteLine()}>Delete Line</button>
                </div>
                <button id="create-plot" className="ctrl" onClick={() => void createPlot()}>Create Plot</button>
              </div>

              <div className="plot-step" style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'flex-end' }}>
                <label htmlFor="plot-config-select" style={{ fontWeight: 600 }}>Saved plot</label>
                <select id="plot-config-select" className="ctrl" value={selectedSaved} onChange={(e) => void loadSaved(e.target.value)}>
                  <option value="">Plot selection</option>
                  {savedPlotNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <button id="delete-plot-config" className="ctrl" onClick={() => void deleteSaved()}>Delete Plot</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
