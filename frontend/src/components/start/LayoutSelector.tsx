/**
 * Saved-layout selector on the start page — merges localStorage layout names
 * with server-side layout files (GET /api/layouts), exactly like the legacy
 * updateLayoutList(). Deletion removes both copies (deleteSelectedLayout()).
 */

import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useAppStore } from '../../store/appStore'
import { appAlert, appConfirm } from '../../store/dialogStore'
import { deleteStoredLayout, getStoredLayouts } from '../../utils/storage'

export function LayoutSelector() {
  const selectedLayout = useAppStore((s) => s.selectedLayout)
  const setSelectedLayout = useAppStore((s) => s.setSelectedLayout)
  const [names, setNames] = useState<string[]>([])

  const refresh = useCallback(async () => {
    const localNames = Object.keys(getStoredLayouts())
    let serverNames: string[] = []
    try {
      const payload = await api.listLayouts()
      serverNames = payload.names ?? []
    } catch {
      serverNames = []
    }
    const merged = Array.from(new Set([...localNames, ...serverNames])).sort((a, b) => a.localeCompare(b))
    setNames(merged)
    if (selectedLayout && !merged.includes(selectedLayout)) {
      setSelectedLayout(null)
    }
  }, [selectedLayout, setSelectedLayout])

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const deleteSelected = async () => {
    if (!selectedLayout) {
      await appAlert('Please select a layout to delete.', 'Delete Layout')
      return
    }
    const confirmed = await appConfirm(`Delete layout "${selectedLayout}"? This cannot be undone.`, 'Delete Layout')
    if (!confirmed) return

    deleteStoredLayout(selectedLayout)
    const deleted = selectedLayout
    setSelectedLayout(null)
    await refresh()

    try {
      await api.nodemanager('delete_layout', { name: deleted })
      await appAlert('Layout deleted locally and delete request sent to the server.', 'Delete Layout')
    } catch {
      await appAlert('Layout deleted locally, but the server could not be contacted to remove the saved file.', 'Delete Layout')
    }
    await refresh()
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor="layout-select" style={{ fontWeight: 'bold', fontSize: 12 }}>
        Saved Layouts:
      </label>{' '}
      <select
        id="layout-select"
        style={{ padding: 4, borderRadius: 4, border: '1px solid #ccc', fontSize: 12, minWidth: 150, marginRight: 8 }}
        value={selectedLayout ?? ''}
        onChange={(e) => setSelectedLayout(e.target.value || null)}
      >
        <option value="">-- Select Layout --</option>
        {names.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <button
        id="delete-layout-btn"
        type="button"
        onClick={() => void deleteSelected()}
        style={{
          padding: '4px 8px',
          fontSize: 11,
          background: '#dc3545',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          marginLeft: 8,
        }}
      >
        Delete
      </button>
    </div>
  )
}
