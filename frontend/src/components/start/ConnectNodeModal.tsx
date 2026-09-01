/**
 * Connect-to-Node modal — React port of the legacy modal in system.html /
 * addNodeConnection() in system-core.js.
 *
 * Submits host/port to the nodemanager (add_node) and arms the backend
 * restart-recovery watcher; feedback arrives via nodemanager.status pushes.
 */

import { useState } from 'react'
import { api } from '../../api/client'
import { appAlert } from '../../store/dialogStore'
import { scheduleBackendRestartReload } from '../../utils/restartRecovery'

export function ConnectNodeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  const submit = async () => {
    if (!ip.trim() || !port.trim()) {
      await appAlert('Please enter both IP and Port.', 'Add Node')
      return
    }
    const addr = `${ip.trim()}:${port.trim()}`
    setSubmitting(true)
    try {
      // Arm restart recovery first; the backend re-execs after a successful add.
      scheduleBackendRestartReload(undefined, addr)
      await api.nodemanager('add_node', { host: ip.trim(), port: port.trim() })
      // Feedback is delivered via nodemanager.status pushes.
      setIp('')
      setPort('')
      onClose()
    } catch (error) {
      await appAlert(
        error instanceof Error ? error.message : 'Not connected to Spin server.',
        'Add Node',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div id="connect-node-modal" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          padding: '24px 32px',
          minWidth: 320,
          maxWidth: '90vw',
          margin: 'auto',
        }}
      >
        <h3 style={{ marginTop: 0 }}>Connect to Node</h3>
        <div style={{ marginBottom: 12 }}>
          <label htmlFor="conn-ip" style={{ fontSize: 13 }}>
            IP Address:
          </label>
          <input
            id="conn-ip"
            type="text"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            style={{ marginLeft: 8, padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', width: 140 }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="conn-port" style={{ fontSize: 13 }}>
            Port:
          </label>
          <input
            id="conn-port"
            type="text"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            style={{ marginLeft: 8, padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', width: 90 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            id="conn-node-submit"
            disabled={submitting}
            onClick={() => void submit()}
            style={{
              background: '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              padding: '6px 18px',
              fontSize: 14,
            }}
          >
            Connect
          </button>
          <button
            id="conn-node-cancel"
            onClick={onClose}
            style={{
              background: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: 4,
              padding: '6px 18px',
              fontSize: 14,
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
