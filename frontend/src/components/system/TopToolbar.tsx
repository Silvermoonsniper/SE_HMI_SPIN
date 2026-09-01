/**
 * Main-panel header toolbar — React port of the top-bar action buttons and
 * the three status text spans (system-core.js refreshNexusExportStatus /
 * refreshDataSavingStatus / refreshStorageAlertStatus).
 */

import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { DataSavingStatus, StorageStatus } from '../../api/types'
import { appAlert } from '../../store/dialogStore'

export function formatBytes(value: unknown): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown'
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const scaled = bytes / Math.pow(1024, exponent)
  return `${scaled >= 10 || exponent === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[exponent]}`
}

export interface DataSavingSnapshot {
  status: DataSavingStatus | null
  running: boolean
}

interface TopToolbarProps {
  isConfigure: boolean
  guiMode: boolean
  configPanelsHidden: boolean
  onBack: () => void
  onToggleConfigPanels: () => void
  onToggleGuiMode: () => void
  onOpenDataSaving: () => void
  onStopDataSaving: () => void
  onOpenNexusBrowser: () => void
  onOpenHistory: () => void
  dataSaving: DataSavingSnapshot
}

export function TopToolbar({
  isConfigure,
  guiMode,
  configPanelsHidden,
  onBack,
  onToggleConfigPanels,
  onToggleGuiMode,
  onOpenDataSaving,
  onStopDataSaving,
  onOpenNexusBrowser,
  onOpenHistory,
  dataSaving,
}: TopToolbarProps) {
  const [nexusText, setNexusText] = useState('NeXus idle')
  const [nexusTitle, setNexusTitle] = useState('')
  const [storage, setStorage] = useState<{ text: string; color: string; title: string }>({
    text: 'Disk monitor idle',
    color: '#475569',
    title: '',
  })
  const lastStorageAlertLevel = useRef<string>('normal')

  // Poll NeXus + storage status every 10s (legacy interval).
  useEffect(() => {
    let cancelled = false

    const refreshNexus = async () => {
      try {
        const payload = await api.nexusStatus()
        const exportState = payload?.export ?? {}
        if (cancelled) return
        if (exportState.running) {
          setNexusText(`NeXus: ${exportState.run_name || 'run'}`)
          setNexusTitle(exportState.file_path || '')
        } else {
          setNexusText('NeXus idle')
          setNexusTitle('')
        }
      } catch {
        if (!cancelled) {
          setNexusText('NeXus unavailable')
          setNexusTitle('')
        }
      }
    }

    const refreshStorage = async () => {
      try {
        const payload = await api.storageStatus()
        const storage: StorageStatus = payload.storage
        const usedPercent = Number(storage.filesystem_used_percent || 0)
        const freeBytes = Number(storage.filesystem_free_bytes || 0)
        const dbBytes = Number(storage.database_bytes || 0)
        const level = storage.level || 'normal'
        if (cancelled) return
        setStorage({
          text:
            level === 'critical'
              ? `Disk critical: ${usedPercent.toFixed(1)}% used, ${formatBytes(freeBytes)} free`
              : level === 'warning'
                ? `Disk warning: ${usedPercent.toFixed(1)}% used, ${formatBytes(freeBytes)} free`
                : `Disk: ${usedPercent.toFixed(1)}% used, ${formatBytes(freeBytes)} free`,
          color: level === 'critical' ? '#b91c1c' : level === 'warning' ? '#b45309' : '#475569',
          title: `Monitoring ${storage.monitor_path || ''}${dbBytes > 0 ? ` | PostgreSQL: ${formatBytes(dbBytes)}` : ''}`,
        })
        if (level !== 'normal' && level !== lastStorageAlertLevel.current) {
          lastStorageAlertLevel.current = level
          const threshold = level === 'critical' ? storage.critical_percent : storage.warning_percent
          void appAlert(
            `Disk usage reached ${usedPercent.toFixed(1)}% on the monitored storage path.` +
              (storage.monitor_path ? `\nPath: ${storage.monitor_path}` : '') +
              (Number.isFinite(threshold) ? `\nAlert threshold: ${threshold}%` : '') +
              (dbBytes > 0 ? `\nPostgreSQL size: ${formatBytes(dbBytes)}` : '') +
              `\nFree space: ${formatBytes(freeBytes)}`,
            level === 'critical' ? 'Disk Critical' : 'Disk Warning',
          )
        } else if (level === 'normal') {
          lastStorageAlertLevel.current = 'normal'
        }
      } catch {
        if (!cancelled) setStorage({ text: 'Disk monitor unavailable', color: '#64748b', title: '' })
      }
    }

    void refreshNexus()
    void refreshStorage()
    const interval = window.setInterval(() => {
      void refreshNexus()
      void refreshStorage()
    }, 10000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  const savingStatus = dataSaving.status
  const savingRunning = dataSaving.running
  const savingText = savingStatus
    ? savingRunning
      ? `CSV saving: ${savingStatus.file_name || 'data.csv'} every ${savingStatus.interval_seconds || 0}s`
      : 'CSV saving idle'
    : 'CSV saving unavailable'
  const savingTitle = savingStatus?.file_path || savingStatus?.default_directory || ''

  return (
    <div id="main-config-btns" className="main-config-actions">
      <button
        id="start-data-saving-btn"
        className="topbar-action-btn topbar-action-btn-primary"
        onClick={onOpenDataSaving}
        disabled={savingRunning}
      >
        Start Data Saving
      </button>
      <button
        id="stop-data-saving-btn"
        className="topbar-action-btn topbar-action-btn-warn"
        onClick={onStopDataSaving}
        disabled={!savingRunning}
      >
        Stop Data Saving
      </button>
      <button id="browse-export-btn" className="topbar-action-btn topbar-action-btn-muted" onClick={onOpenNexusBrowser}>
        Browse Exports
      </button>
      <button id="browse-history-btn" className="topbar-action-btn topbar-action-btn-primary" onClick={onOpenHistory}>
        History Browser
      </button>
      <span id="nexus-export-status" className="topbar-status-text" title={nexusTitle}>
        {nexusText}
      </span>
      <span id="data-saving-status" className="topbar-status-text topbar-status-text-accent" title={savingTitle}>
        {savingText}
      </span>
      <span id="storage-alert-status" className="topbar-status-text" style={{ color: storage.color }} title={storage.title}>
        {storage.text}
      </span>
      <button type="button" onClick={onBack} className="topbar-action-btn topbar-action-btn-neutral">
        Back
      </button>
      {isConfigure && (
        <button
          id="toggle-config-panels-btn"
          className="topbar-action-btn topbar-action-btn-neutral"
          onClick={onToggleConfigPanels}
        >
          {configPanelsHidden ? 'Show configuration panel' : 'Hide configuration panel'}
        </button>
      )}
      <button id="toggle-gui-btn" className="topbar-action-btn topbar-action-btn-primary" onClick={onToggleGuiMode}>
        {guiMode ? 'Configure GUI' : 'Show GUI'}
      </button>
    </div>
  )
}
