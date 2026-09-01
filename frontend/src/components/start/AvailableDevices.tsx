/**
 * Available-devices box on the start page — React port of
 * buildAvailableDevicesRows / renderAvailableDevicesTable from system-core.js.
 *
 * Shows a table (IP address, name, type, status badge), a filter dropdown,
 * and a full metadata view for the selected device. Node addresses are
 * resolved asynchronously through /api/node_for_device and cached in
 * localStorage "runtime_node_addrs".
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { DeviceInfo, DeviceParamsMap, LatestValues } from '../../api/types'
import { useAppStore } from '../../store/appStore'
import { getRuntimeNodeAddrs, setRuntimeNodeAddr } from '../../utils/storage'

interface DeviceRow {
  key: string
  address: string
  name: string
  type: string
  statusLabel: string
  statusClassName: string
}

function getStartPageDeviceType(deviceInfo: DeviceInfo): string {
  const typeHints = [
    deviceInfo?.device_type,
    ...(Array.isArray(deviceInfo?.interface_classes) ? deviceInfo.interface_classes : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  if (typeHints.includes('nicos')) return 'NICOS device'
  if (typeHints.includes('tango')) return 'Tango device'
  return 'SECoP device'
}

function getStartPageStatusInfo(statusEntry: unknown): { label: string; className: string } {
  const fallback = { label: 'UNKNOWN', className: 'state-unknown' }
  if (!statusEntry || typeof statusEntry !== 'object') {
    return fallback
  }

  const entry = statusEntry as { state?: unknown; state_str?: unknown; value?: unknown }
  const stateName = String(entry.state || '').toUpperCase()
  const stateText = String(entry.state_str || '').trim().toUpperCase()
  const tupleValue = Array.isArray(entry.value) ? entry.value : null
  const code = tupleValue && tupleValue.length > 0 ? Number(tupleValue[0]) : NaN
  const tupleText = tupleValue && tupleValue.length > 1 ? String(tupleValue[1] || '').trim().toUpperCase() : ''

  if (
    (Number.isFinite(code) && code >= 400) ||
    stateName.includes('ERROR') ||
    stateText.includes('ERROR') ||
    tupleText.includes('ERROR')
  ) {
    return { label: 'ERROR', className: 'state-error' }
  }
  if (
    (Number.isFinite(code) && code >= 200 && code < 400) ||
    stateName.includes('BUSY') ||
    stateName.includes('WARN') ||
    stateText.includes('BUSY') ||
    stateText.includes('WARN') ||
    tupleText.includes('BUSY') ||
    tupleText.includes('WARN')
  ) {
    return { label: 'BUSY', className: 'state-busy' }
  }
  if (
    (Number.isFinite(code) && code >= 100 && code < 200) ||
    stateName.includes('OK') ||
    stateName.includes('IDLE') ||
    stateText.includes('IDLE') ||
    tupleText.includes('IDLE')
  ) {
    return { label: 'IDLE', className: 'state-idle' }
  }

  return fallback
}

function buildRows(deviceParams: DeviceParamsMap, latestValues: LatestValues): DeviceRow[] {
  const addrs = getRuntimeNodeAddrs()
  return Object.keys(deviceParams)
    .sort((left, right) => left.localeCompare(right))
    .map((deviceKey) => {
      const info = deviceParams[deviceKey] || {}
      const displayName = info.original_name || info.module_name || deviceKey
      const addr = addrs[deviceKey] || 'Resolving...'
      const status = getStartPageStatusInfo(latestValues[`${deviceKey}.status`])
      return {
        key: deviceKey,
        address: addr,
        name: displayName,
        type: getStartPageDeviceType(info),
        statusLabel: status.label,
        statusClassName: status.className,
      }
    })
}

export function AvailableDevices() {
  const deviceParams = useAppStore((s) => s.deviceParams)
  const latestValues = useAppStore((s) => s.latestValues)
  const [selected, setSelected] = useState('__all__')
  const [addrVersion, setAddrVersion] = useState(0)
  const pendingLookups = useRef(new Set<string>())

  const rows = useMemo(
    () => buildRows(deviceParams ?? {}, latestValues),
    // addrVersion re-renders once async address lookups land in localStorage.
    [deviceParams, latestValues, addrVersion],
  )

  // Resolve unknown addresses asynchronously (legacy resolveAvailableDeviceAddresses).
  useEffect(() => {
    const addrs = getRuntimeNodeAddrs()
    rows.forEach((row) => {
      if (addrs[row.key] || pendingLookups.current.has(row.key)) return
      pendingLookups.current.add(row.key)
      api
        .nodeForDevice(row.key)
        .then((payload) => {
          if (payload?.addr) {
            setRuntimeNodeAddr(row.key, payload.addr)
            setAddrVersion((v) => v + 1)
          }
        })
        .catch(() => undefined)
        .finally(() => pendingLookups.current.delete(row.key))
    })
  }, [rows])

  const deviceParamsLoaded = deviceParams !== null

  if (!rows.length) {
    return (
      <div
        id="available-devices-box"
        style={{ background: '#f8f9fa', border: '1px solid #dee2e6', padding: 12, marginBottom: 20, borderRadius: 4 }}
      >
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            marginBottom: 10,
          }}
        >
          <label htmlFor="available-devices-select" style={{ fontSize: 12, fontWeight: 'bold', color: '#495057' }}>
            Available devices
          </label>
          <select
            id="available-devices-select"
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', fontSize: 12, minWidth: 220 }}
            value=""
            onChange={() => undefined}
          >
            <option value="">{deviceParamsLoaded ? 'No devices available' : 'Loading devices...'}</option>
          </select>
        </div>
        <div id="available-devices-content" style={{ fontSize: 11, color: '#6c757d' }}>
          <div className="available-devices-empty">
            {deviceParamsLoaded ? 'No devices available yet.' : 'Loading devices...'}
          </div>
        </div>
      </div>
    )
  }

  const selectedValue = rows.some((row) => row.key === selected) ? selected : '__all__'
  const filteredRows = selectedValue !== '__all__' ? rows.filter((row) => row.key === selectedValue) : rows
  const selectedRow = selectedValue !== '__all__' ? rows.find((row) => row.key === selectedValue) : null

  return (
    <div
      id="available-devices-box"
      style={{ background: '#f8f9fa', border: '1px solid #dee2e6', padding: 12, marginBottom: 20, borderRadius: 4 }}
    >
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <label htmlFor="available-devices-select" style={{ fontSize: 12, fontWeight: 'bold', color: '#495057' }}>
          Available devices
        </label>
        <select
          id="available-devices-select"
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #ccc', fontSize: 12, minWidth: 220 }}
          value={selectedValue}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="__all__">All devices ({rows.length})</option>
          {rows.map((row) => (
            <option key={row.key} value={row.key}>
              {row.name} ({row.address})
            </option>
          ))}
        </select>
      </div>
      <div id="available-devices-content" style={{ fontSize: 11, color: '#6c757d' }}>
        <table className="available-devices-table">
          <thead>
            <tr>
              <th>IP address</th>
              <th>Device name</th>
              <th>Device type</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.key}>
                <td>{row.address}</td>
                <td className="available-devices-name">{row.name}</td>
                <td>{row.type}</td>
                <td>
                  <span className={`status-badge ${row.statusClassName}`}>{row.statusLabel}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {selectedRow ? (
          <div className="available-device-metadata">
            <div className="available-device-metadata-title">Full metadata for {selectedRow.name}</div>
            <pre className="available-device-metadata-pre">
              {JSON.stringify(
                {
                  ...((deviceParams ?? {})[selectedRow.key] ?? {}),
                  resolved_address: selectedRow.address,
                  display_name: selectedRow.name,
                  device_type: selectedRow.type,
                  device_status: selectedRow.statusLabel,
                },
                null,
                2,
              )}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  )
}
