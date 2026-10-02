import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PlotPanel } from '../components/plots/PlotPanel'
import { fetchDeviceParamsSafe } from '../components/editor/layoutPersistence'
import { usePlotStore, loadPlotConfig, ingestPlotUpdate, refreshSavedPlotNames } from '../store/plotStore'
import { useAppStore } from '../store/appStore'

/** A standalone live plot, with its own WebSocket and polling lifecycle. */
export default function PlotPage() {
  const [params] = useSearchParams()
  const configName = params.get('config') || ''
  const plots = usePlotStore((s) => s.plots)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activeTitle = Object.values(plots)[0]?.title || configName || 'Plot'

  useEffect(() => {
    document.title = `${activeTitle} — Live Plot`
  }, [activeTitle])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const clearPlots = () => {
      const store = usePlotStore.getState()
      Object.keys(store.plots).forEach((id) => store.removePlot(id))
    }
    clearPlots()

    const load = async () => {
      if (!configName) throw new Error('No plot configuration was selected.')
      // Canonical device names are needed to match incoming trace keys.
      await fetchDeviceParamsSafe()
      const config = await loadPlotConfig(configName)
      if (cancelled) return
      if (!config) throw new Error(`Plot configuration "${configName}" could not be loaded.`)
      const id = usePlotStore.getState().createPlot(config)
      if (!id) throw new Error('This plot configuration has no traces.')
      // Seed any values received while the configuration was loading.
      Object.entries(useAppStore.getState().latestValues).forEach(([key, value]) => {
        ingestPlotUpdate(key, value.value, Date.now(), true)
      })
      refreshSavedPlotNames()
    }

    void load()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'The plot could not be loaded.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
      clearPlots()
    }
  }, [configName])

  return (
    <main className="standalone-plot-page">
      {loading && <p>Loading plot…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && Object.values(plots).map((panel) => (
        <PlotPanel
          key={panel.id}
          panel={panel}
          isConfigure
          standalone
          onRemove={(id) => usePlotStore.getState().removePlot(id)}
        />
      ))}
    </main>
  )
}
