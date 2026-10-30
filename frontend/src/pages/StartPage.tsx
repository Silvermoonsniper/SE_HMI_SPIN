/**
 * Start / connection page — React port of the #connection-panel from
 * content/system.html and the related logic in system-core.js.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { AvailableDevices } from '../components/start/AvailableDevices'
import { ConnectNodeModal } from '../components/start/ConnectNodeModal'
import { DayNightToggle, useStartPageMode } from '../components/start/DayNightToggle'
import { LayoutSelector } from '../components/start/LayoutSelector'
import { useAppStore } from '../store/appStore'
import { appAlert } from '../store/dialogStore'

export default function StartPage() {
  const navigate = useNavigate()
  const { mode, toggle } = useStartPageMode()
  const [connectModalOpen, setConnectModalOpen] = useState(false)
  const wsConnected = useAppStore((s) => s.wsConnected)
  const selectedLayout = useAppStore((s) => s.selectedLayout)
  const setPendingRenderMode = useAppStore((s) => s.setPendingRenderMode)
  const setDeviceParams = useAppStore((s) => s.setDeviceParams)

  // Load device metadata: static file first, then request the normalized
  // nodemanager.device_params push (delivered over the WebSocket). Merged so a
  // temporarily empty backend file cannot clear already-known devices.
  useEffect(() => {
    api
      .deviceParamsFile()
      .then((params) => useAppStore.getState().mergeDeviceParams(params))
      .catch(() => undefined)
    api.nodemanager('get_device_params').catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const connectToGUI = (isConfigure: boolean) => {
    if (!wsConnected) {
      void appAlert('Connection to server not ready. Please wait a moment and try again.')
      return
    }
    setPendingRenderMode(isConfigure ? 'configure' : 'connect')
    // selectedLayout is already tracked by LayoutSelector; SystemPage loads it.
    void selectedLayout
    navigate('/system')
  }

  return (
    <div id="connection-panel" data-mode={mode}>
      <DayNightToggle mode={mode} onToggle={toggle} />
      <div className="conn-box">
        <div className="conn-box-inner">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 20 }}>
            <h1 style={{ margin: 0, color: '#333', fontSize: 28 }}>SE-HMI-SPIN</h1>
            <span style={{ color: '#64748b', fontSize: 12, fontWeight: 600 }}>V 1.0.13</span>
          </div>

          <div style={{ marginBottom: 16 }}>
            <button
              id="connect-node-btn"
              className="conn-btn"
              style={{ background: '#007bff', fontSize: 14, padding: 10, width: '100%', marginBottom: 8 }}
              onClick={() => setConnectModalOpen(true)}
            >
              Connect to Node
            </button>
          </div>
          <ConnectNodeModal open={connectModalOpen} onClose={() => setConnectModalOpen(false)} />

          <div
            style={{
              background: '#e8f4f8',
              borderLeft: '4px solid #17a2b8',
              padding: 12,
              marginBottom: 20,
              borderRadius: 4,
            }}
          >
            <div style={{ fontSize: 13, color: '#0c5460', lineHeight: 1.6 }}>
              <strong>SE-HMI-SPIN</strong>
              <br />
              This interface provides user the ability to design specific system layout for different experiment
              control system using SECoP devices, Tango device (in development), NICOS devcice (in devleopment) etc,
              and also connect to existing GUI after their design.
            </div>
          </div>

          <AvailableDevices />

          <LayoutSelector />

          <div style={{ display: 'flex', gap: 10, marginBottom: 5 }}>
            <button
              className="conn-btn"
              style={{ background: '#28a745', fontSize: 14, padding: 10, flex: 1 }}
              onClick={() => connectToGUI(true)}
            >
              Configure system layout
            </button>
          </div>
          <div style={{ display: 'flex', gap: 15 }}>
            <button
              className="conn-btn"
              style={{ background: '#3128a7', fontSize: 14, padding: 10, flex: 1 }}
              onClick={() => connectToGUI(false)}
            >
              Connect to system layout
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
