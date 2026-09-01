/**
 * Start-Data-Saving dialog — React port of ensureDataSavingModal /
 * openDataSavingDialog / startDataSaving from system-core.js, including the
 * File System Access API "save to this computer" flow with browser-download
 * fallback for Firefox / non-secure contexts.
 */

import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { appAlert } from '../../store/dialogStore'

interface DirectoryHandleLike {
  name: string
  getFileHandle: (name: string, opts: { create: boolean }) => Promise<{ createWritable: () => Promise<{ write: (b: Blob) => Promise<void>; close: () => Promise<void> }> }>
}

function isDirectLocalExportSupported(): boolean {
  return !!(window.isSecureContext && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function')
}

function isFirefoxBrowser(): boolean {
  const ua = String(navigator.userAgent || '').toLowerCase()
  return ua.includes('firefox') && !ua.includes('seamonkey')
}

function getFileNameFromPath(filePath: string | null | undefined): string {
  const rawPath = String(filePath || '').trim()
  if (!rawPath) return ''
  const parts = rawPath.split(/[\\/]/)
  return parts[parts.length - 1] || ''
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

async function fetchExportBlob(kind: 'csv' | 'nexus', fileName: string): Promise<Blob> {
  const url =
    kind === 'csv' ? api.dataSavingDownloadUrl(fileName) : api.nexusDownloadUrl(fileName)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.blob()
}

/** Persisted local-export preference (module-level like the legacy singleton). */
export const dataSavingLocalPreference: {
  enabled: boolean
  directoryHandle: DirectoryHandleLike | null
  directoryName: string
} = { enabled: false, directoryHandle: null, directoryName: '' }

interface DataSavingDialogProps {
  open: boolean
  onClose: () => void
  onStatusChanged: () => void
}

export function DataSavingDialog({ open, onClose, onStatusChanged }: DataSavingDialogProps) {
  const [serverDirectory, setServerDirectory] = useState('/app/data_exports')
  const [fileName, setFileName] = useState('experiment_data.csv')
  const [intervalSeconds, setIntervalSeconds] = useState('10')
  const [saveNexus, setSaveNexus] = useState(true)
  const [, forceRender] = useState(0)

  // Prefill from backend status when opened (legacy openDataSavingDialog).
  useEffect(() => {
    if (!open) return
    api
      .dataSavingStatus()
      .then((payload) => {
        const exportState = payload?.export ?? {}
        const dir = exportState.default_directory || exportState.directory || '/app/data_exports'
        setServerDirectory(dir)
        setFileName(exportState.file_name || 'experiment_data.csv')
        setIntervalSeconds(String(Math.max(1, Math.round(Number(exportState.interval_seconds || 10)))))
        setSaveNexus(true)
      })
      .catch(() => setServerDirectory('/app/data_exports'))
  }, [open])

  if (!open) return null

  const chooseLocalFolder = async (): Promise<boolean> => {
    if (!isDirectLocalExportSupported()) {
      // Fallback: browser downloads.
      dataSavingLocalPreference.enabled = true
      dataSavingLocalPreference.directoryHandle = null
      dataSavingLocalPreference.directoryName = ''
      forceRender((v) => v + 1)
      return true
    }
    try {
      const picker = (window as unknown as { showDirectoryPicker: () => Promise<DirectoryHandleLike> }).showDirectoryPicker
      const handle = await picker()
      dataSavingLocalPreference.enabled = true
      dataSavingLocalPreference.directoryHandle = handle
      dataSavingLocalPreference.directoryName = handle?.name || ''
      forceRender((v) => v + 1)
      return true
    } catch (e) {
      await appAlert(`Failed to choose storage location.\n${e instanceof Error ? e.message : e}`, 'Storage Location')
      return false
    }
  }

  const useServerStorage = () => {
    dataSavingLocalPreference.enabled = false
    dataSavingLocalPreference.directoryHandle = null
    dataSavingLocalPreference.directoryName = ''
    forceRender((v) => v + 1)
  }

  const submit = async () => {
    const parsedInterval = Number(intervalSeconds)
    if (!Number.isFinite(parsedInterval) || parsedInterval <= 0) {
      await appAlert('Please enter an interval greater than 0 seconds.', 'Start Data Saving')
      return
    }

    const saveToLocal = dataSavingLocalPreference.enabled
    if (saveToLocal && isDirectLocalExportSupported() && !dataSavingLocalPreference.directoryHandle) {
      const chosen = await chooseLocalFolder()
      if (!chosen || !dataSavingLocalPreference.directoryHandle) return
    }

    try {
      const payload = await api.dataSavingStart({
        directory: serverDirectory.trim(),
        file_name: fileName.trim(),
        interval_seconds: parsedInterval,
        save_nexus: saveNexus,
      })
      onStatusChanged()
      const message = [
        'CSV data saving started.',
        payload.file_path || '',
        payload.nexus_file_path ? `NeXus report: ${payload.nexus_file_path}` : '',
        saveToLocal
          ? dataSavingLocalPreference.directoryHandle
            ? `Finished files will be copied to this computer: ${dataSavingLocalPreference.directoryName || 'chosen folder'}`
            : 'Finished files will be downloaded to this computer when saving stops.'
          : '',
      ]
        .filter(Boolean)
        .join('\n')
      await appAlert(message, 'Start Data Saving')
      onClose()
    } catch (e) {
      await appAlert(`Failed to start CSV data saving.\n${e instanceof Error ? e.message : e}`, 'Start Data Saving')
    }
  }

  const localEnabled = dataSavingLocalPreference.enabled
  const hasFolderHandle = !!dataSavingLocalPreference.directoryHandle

  let localNote = ''
  if (localEnabled && hasFolderHandle) {
    localNote = `Finished files will be copied to this computer: ${dataSavingLocalPreference.directoryName || 'chosen folder'}`
  } else if (localEnabled && !hasFolderHandle) {
    localNote = isFirefoxBrowser()
      ? 'Firefox does not support direct folder access — finished files will be downloaded to this computer when saving stops.'
      : 'Direct folder access requires a secure (localhost/HTTPS) context — finished files will be downloaded to this computer when saving stops.'
  } else {
    localNote = 'Files are stored on the server. Use the folder button to copy finished files to this computer instead.'
  }

  return (
    <div
      id="data-saving-overlay"
      style={{
        display: 'flex',
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.42)',
        zIndex: 3200,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          width: 'min(520px, calc(100vw - 32px))',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 24px 48px rgba(15,23,42,0.28)',
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 18, color: '#0f172a' }}>Start Data Saving</h3>
          <button
            type="button"
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}
          >
            &times;
          </button>
        </div>
        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4, fontSize: 13, color: '#334155' }}>
            <span>Storage location</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                readOnly
                value={localEnabled ? dataSavingLocalPreference.directoryName || 'This computer (downloads)' : serverDirectory}
                style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#f8fafc', cursor: 'default' }}
                placeholder="Choose storage location"
              />
              <button
                type="button"
                aria-label="Choose folder on this computer"
                title="Choose folder on this computer"
                onClick={() => void chooseLocalFolder()}
                style={{ width: 40, height: 40, border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 20, lineHeight: 1 }}
              >
                📁
              </button>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>{localNote}</div>
          </label>
          {localEnabled && (
            <button type="button" onClick={useServerStorage} style={{ justifySelf: 'start', fontSize: 12, border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', padding: 0 }}>
              Use server storage instead
            </button>
          )}
          <label style={{ display: 'grid', gap: 4, fontSize: 13, color: '#334155' }}>
            <span>Base file name</span>
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }}
              placeholder="experiment_data.csv"
            />
          </label>
          <label style={{ display: 'grid', gap: 4, fontSize: 13, color: '#334155' }}>
            <span>Write interval in seconds</span>
            <input
              type="number"
              min={1}
              step={1}
              value={intervalSeconds}
              onChange={(e) => setIntervalSeconds(e.target.value)}
              style={{ padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155' }}>
            <input type="checkbox" checked={saveNexus} onChange={(e) => setSaveNexus(e.target.checked)} />
            <span>Also write a NeXus report with the same directory and base name</span>
          </label>
          <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.45 }}>
            When running in Docker, use an absolute server-side directory such as{' '}
            <span style={{ fontFamily: 'monospace' }}>/app/data_exports</span> if you want to store files on the
            server. If you choose a local folder, the finished files will be copied there after saving stops.
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ padding: '8px 12px', border: '1px solid #cbd5e1', background: '#fff', color: '#000', borderRadius: 8, cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            style={{ padding: '8px 12px', border: 'none', background: '#2563eb', color: '#fff', borderRadius: 8, cursor: 'pointer' }}
          >
            Start Saving
          </button>
        </div>
      </div>
    </div>
  )
}

/** Stop data saving and persist finished exports locally (legacy stopDataSaving). */
export async function stopDataSavingFlow(onStatusChanged: () => void): Promise<void> {
  try {
    const payload = await api.dataSavingStop()
    onStatusChanged()

    let localMessage = ''
    if (dataSavingLocalPreference.enabled) {
      const files: Array<{ kind: 'csv' | 'nexus'; fileName: string }> = []
      const csvFileName = getFileNameFromPath(payload.file_path)
      const nexusFileName = getFileNameFromPath(payload.nexus_file_path)
      if (csvFileName) files.push({ kind: 'csv', fileName: csvFileName })
      if (nexusFileName) files.push({ kind: 'nexus', fileName: nexusFileName })

      const saved: string[] = []
      const downloaded: string[] = []
      const errors: string[] = []
      for (const file of files) {
        try {
          const blob = await fetchExportBlob(file.kind, file.fileName)
          if (dataSavingLocalPreference.directoryHandle && isDirectLocalExportSupported()) {
            try {
              const handle = await dataSavingLocalPreference.directoryHandle.getFileHandle(file.fileName, { create: true })
              const writable = await handle.createWritable()
              await writable.write(blob)
              await writable.close()
              saved.push(file.fileName)
              continue
            } catch (writeError) {
              errors.push(`${file.fileName}: ${writeError instanceof Error ? writeError.message : writeError}`)
            }
          }
          triggerBlobDownload(blob, file.fileName)
          downloaded.push(file.fileName)
        } catch (e) {
          errors.push(`${file.fileName}: ${e instanceof Error ? e.message : e}`)
        }
      }
      localMessage = [
        saved.length ? `Copied to this computer: ${saved.join(', ')}` : '',
        downloaded.length ? `Downloaded to this computer: ${downloaded.join(', ')}` : '',
        errors.length ? `Local copy issues: ${errors.join(' | ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    }

    const message = [
      'CSV data saving stopped.',
      payload.file_path || '',
      payload.nexus_file_path ? `NeXus report: ${payload.nexus_file_path}` : '',
      localMessage,
    ]
      .filter(Boolean)
      .join('\n')
    await appAlert(message, 'Stop Data Saving')
  } catch (e) {
    await appAlert(`Failed to stop CSV data saving.\n${e instanceof Error ? e.message : e}`, 'Stop Data Saving')
  }
}
