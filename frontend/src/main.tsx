import React from 'react'
import ReactDOM from 'react-dom/client'
import { Buffer } from 'buffer'

// Polyfill Node's Buffer for plotly.js-dist-min (its typed-array helpers import it).
if (typeof (window as unknown as { Buffer?: unknown }).Buffer === 'undefined') {
  ;(window as unknown as { Buffer?: unknown }).Buffer = Buffer
}
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { liveClient } from './api/ws'
import { initNodemanagerHandlers } from './live/nodemanagerHandlers'
import { ingestPlotUpdate, startPlotPolling } from './store/plotStore'
import { useAppStore } from './store/appStore'
import { resumePendingRestartRecovery } from './utils/restartRecovery'
import './styles/system.css'
import './styles/plots.css'
import './styles/app.css'

// Wire the live-update WebSocket into the central store. All device value
// updates and nodemanager.* pushes flow through here.
liveClient.onSnapshot((values) => useAppStore.getState().mergeLatestValues(values))
liveClient.onUpdate((update) => {
  useAppStore.getState().applyUpdate(update)
  // Feed the plot buffers (muted in configure mode inside ingestPlotUpdate).
  ingestPlotUpdate(update.key, update.value, Date.now(), true)
})
liveClient.onConnectionChange((connected) => useAppStore.getState().setWsConnected(connected))
initNodemanagerHandlers()
liveClient.start()
startPlotPolling()

// If a backend restart recovery was armed before a reload, resume it.
resumePendingRestartRecovery()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
