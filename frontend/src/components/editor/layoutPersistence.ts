/**
 * Layout save / load / new — React port of saveLayoutToStorage,
 * loadLayoutFromFile, create_newLayoutFile and getCurrentLayoutData from
 * system-layout.js. Layout JSON schema is preserved verbatim for backward
 * compatibility with existing layout/ files and localStorage copies.
 */

import { api } from '../../api/client'
import type { LayoutData } from '../../api/types'
import { useAppStore } from '../../store/appStore'
import { appAlert, appPrompt } from '../../store/dialogStore'
import { getStoredLayouts, saveStoredLayout } from '../../utils/storage'

export interface CanvasSnapshotSource {
  devices: LayoutData['devices']
  valveIcons: LayoutData['valveIcons']
  decorations: LayoutData['decorations']
  plots: LayoutData['plots']
  connections: LayoutData['connections']
}

/** Save the current canvas as a named layout (localStorage + server). */
export async function saveLayout(layout: LayoutData): Promise<string | null> {
  const name = await appPrompt('Enter a name for this layout:', '', 'Save Layout')
  if (!name) return null

  saveStoredLayout(name, layout)
  try {
    await api.nodemanager('save_layout', { name, layout })
  } catch {
    /* server-side save best-effort */
  }
  await appAlert(`Layout "${name}" saved locally (and requested save on server if available).`, 'Save Layout')
  return name
}

/** Load a layout JSON file from disk, store it, and return it (legacy loadLayoutFromFile). */
export function loadLayoutFromFile(): Promise<{ name: string; layout: LayoutData } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      const reader = new FileReader()
      reader.onload = async (event) => {
        try {
          const layout = JSON.parse(String(event.target?.result)) as LayoutData
          const name = await appPrompt('Enter a name for this layout:', file.name.replace(/\.json$/i, ''), 'Load Layout')
          if (!name) {
            resolve(null)
            return
          }
          saveStoredLayout(name, layout)
          await appAlert(`Layout "${name}" loaded and saved!`, 'Load Layout')
          resolve({ name, layout })
        } catch (err) {
          await appAlert(`Error loading layout: ${err}`, 'Load Layout')
          resolve(null)
        }
      }
      reader.readAsText(file)
    }
    input.click()
  })
}

/** Merge device metadata embedded in a layout into the app store (legacy hydrateDeviceMetadataFromLayout). */
export function hydrateDeviceMetadataFromLayout(layout: LayoutData | null): void {
  if (!layout || !Array.isArray(layout.devices) || layout.devices.length === 0) return
  const current = useAppStore.getState().deviceParams ?? {}
  const merged = { ...current }
  let added = 0
  layout.devices.forEach((entry) => {
    const key = entry.logicalName || entry.device
    if (!key || merged[key]) return
    const info = { ...(entry.info ?? {}) } as Record<string, unknown>
    if (!info.original_name && entry.device) info.original_name = entry.device
    if (!info.module_name && entry.device) info.module_name = entry.device
    if (!Array.isArray(info.interface_classes)) info.interface_classes = []
    if (!Array.isArray(info.params)) info.params = []
    if (!Array.isArray(info.all_params)) info.all_params = (info.params as string[]).slice()
    if (!Array.isArray(info.commands)) info.commands = []
    if (!Array.isArray(info.param_info)) info.param_info = []
    merged[key] = info as never
    added += 1
  })
  if (added) {
    useAppStore.getState().setDeviceParams(merged as never)
  }
}

/** Fetch device metadata defensively: returns null instead of throwing. */
export async function fetchDeviceParamsSafe(): Promise<void> {
  try {
    const params = await api.deviceParamsFile()
    useAppStore.getState().mergeDeviceParams(params)
  } catch {
    /* static file may be absent */
  }
}

/** Get a layout by name from localStorage or the server (legacy loaders). */
export async function fetchLayoutByName(name: string): Promise<LayoutData | null> {
  const stored = getStoredLayouts()
  if (stored[name]) return stored[name]
  try {
    const payload = await api.getLayout(name)
    return payload.layout ?? null
  } catch {
    try {
      const reply = await api.nodemanager('get_layout', { name })
      if (reply?.data && typeof reply.data === 'object') return reply.data as LayoutData
    } catch {
      /* not found */
    }
    return null
  }
}
