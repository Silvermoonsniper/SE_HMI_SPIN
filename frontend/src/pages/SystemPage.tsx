/**
 * System page — run-mode live view of a saved layout (Phase 3).
 *
 * Ports connect_to_system() from system-layout.js: device boxes (with robust
 * name matching), sample-magazine slots, sample-presence block, and valve
 * icons are restored from the layout JSON and fed by the live value store.
 *
 * Layout editor (configure mode: drag/resize/decorations/connections/plots)
 * is Phase 4; plots are Phase 5 — their toolbar buttons and dialogs are live.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { DeviceInfo, LayoutData, LayoutDeviceEntry, LayoutDecorationEntry } from '../api/types'
import { DeviceBox } from '../components/system/DeviceBox'
import { SamplePresence, SampleSlot } from '../components/system/SampleSlots'
import { TopToolbar, type DataSavingSnapshot } from '../components/system/TopToolbar'
import { ValveIcon, valveFieldsOf } from '../components/system/ValveIcon'
import { DataSavingDialog, stopDataSavingFlow } from '../components/system/DataSavingDialog'
import { NexusBrowser } from '../components/system/NexusBrowser'
import { deviceDomId, useAppStore } from '../store/appStore'
import { useEditorStore } from '../store/editorStore'
import { ConnectionLayer } from '../components/editor/ConnectionLayer'
import { DecorationBox } from '../components/editor/DecorationBox'
import { CanvasCreateMenu, type CanvasCreateRequest } from '../components/editor/CanvasCreateMenu'
import { fetchLayoutByName, hydrateDeviceMetadataFromLayout, loadLayoutFromFile, saveLayout } from '../components/editor/layoutPersistence'
import { useCanvasClipboard } from '../components/editor/useCanvasClipboard'
import { ValveIconMenus } from '../components/editor/ValveIconMenus'
import { PlotPanel, layoutPlotGeometry } from '../components/plots/PlotPanel'
import { PlotConfigWindow } from '../components/plots/PlotConfigWindow'
import { usePlotStore, layoutPlotToConfig, refreshSavedPlotNames } from '../store/plotStore'
import type { PlotConfig } from '../api/types'
import { getStoredLayouts, saveStoredLayout } from '../utils/storage'
import { hydrateDeviceFromNode, fetchAndMergeLatestValuesOnce } from '../components/system/deviceUtils'
import { appAlert } from '../store/dialogStore'

// ---------------------------------------------------------------------------
// Device matching (legacy robust matching from connect_to_system)
// ---------------------------------------------------------------------------

function matchDevice(entry: LayoutDeviceEntry, available: string[], deviceParams: Record<string, DeviceInfo> | null): string | null {
  const savedKey = entry.deviceKey || entry.logicalName
  let match = available.find((dev) => dev === savedKey)
  if (!match) match = available.find((dev) => dev === entry.logicalName)
  if (!match) match = available.find((dev) => dev === entry.device)
  if (!match && deviceParams) {
    match = available.find((dev) => {
      const info = deviceParams[dev]
      return info && info.original_name === entry.device
    })
  }
  return match ?? null
}

function isMagSlot(entry: LayoutDeviceEntry): boolean {
  return Boolean(
    (entry.logicalName && entry.logicalName.startsWith('mag-')) ||
      (entry.id && entry.id.startsWith('mag-')) ||
      entry.logicalName === 'sample_presence',
  )
}

export default function SystemPage() {
  const navigate = useNavigate()
  const selectedLayout = useAppStore((s) => s.selectedLayout)
  const pendingRenderMode = useAppStore((s) => s.pendingRenderMode)
  const deviceParams = useAppStore((s) => s.deviceParams)
  const latestValues = useAppStore((s) => s.latestValues)
  const setDeviceParams = useAppStore((s) => s.setDeviceParams)
  const setConfigurationMode = useAppStore((s) => s.setConfigurationMode)

  const isConfigure = pendingRenderMode === 'configure'

  const [layout, setLayout] = useState<LayoutData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [guiMode, setGuiMode] = useState(!isConfigure)
  const [configPanelsHidden, setConfigPanelsHidden] = useState(false)
  const [dataSavingOpen, setDataSavingOpen] = useState(false)
  const [nexusOpen, setNexusOpen] = useState(false)
  const [dataSaving, setDataSaving] = useState<DataSavingSnapshot>({ status: null, running: false })
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())

  // Editor (configure mode) state
  const editorZoom = useEditorStore((s) => s.zoom)
  const editorDecorations = useEditorStore((s) => s.decorations)
  const editorConnections = useEditorStore((s) => s.connections)
  const editorValveIcons = useEditorStore((s) => s.valveIcons)
  const deviceGeometry = useEditorStore((s) => s.deviceGeometry)
  const setDeviceGeometry = useEditorStore((s) => s.setDeviceGeometry)
  const updateValveIcon = useEditorStore((s) => s.updateValveIcon)
  const addDecoration = useEditorStore((s) => s.addDecoration)
  const clearEditor = useEditorStore((s) => s.clearAll)
  const setEditorSelected = useEditorStore((s) => s.setSelected)

  const [extraDevices, setExtraDevices] = useState<LayoutDeviceEntry[]>([])
  const [createMenu, setCreateMenu] = useState<CanvasCreateRequest | null>(null)
  const [iconsVersion, setIconsVersion] = useState(0)
  const [plotConfigOpen, setPlotConfigOpen] = useState(false)
  const [plotConfigPosition, setPlotConfigPosition] = useState<{ left: number; top: number } | null>(null)
  const plotPanels = usePlotStore((s) => s.plots)
  const createPlotInStore = usePlotStore((s) => s.createPlot)
  const removePlotFromStore = usePlotStore((s) => s.removePlot)

  const gridRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const lastPointerRef = useRef({ left: 200, top: 80 })

  // Sync configuration mode into the store (gates live editing elsewhere).
  useEffect(() => {
    setConfigurationMode(isConfigure)
    return () => setConfigurationMode(false)
  }, [isConfigure, setConfigurationMode])

  // Ensure device metadata is loaded. Merge (never replace) so that an empty
  // /c/device_params.json cannot wipe metadata hydrated from the layout.
  useEffect(() => {
    api
      .deviceParamsFile()
      .then((params) => useAppStore.getState().mergeDeviceParams(params))
      .catch(() => undefined)
    api.nodemanager('get_device_params').catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load the selected layout (localStorage first, then server — legacy connectToGUI).
  useEffect(() => {
    if (!selectedLayout) {
      setLayout(null)
      return
    }
    let cancelled = false
    const load = async () => {
      const loaded = await fetchLayoutByName(selectedLayout)
      if (cancelled) return
      if (loaded) {
        hydrateDeviceMetadataFromLayout(loaded)
        setLayout(loaded)
        setLoadError(null)
      } else {
        setLoadError(`Layout "${selectedLayout}" not found.`)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [selectedLayout])

  // Seed editor stores from the loaded layout (positions, decorations, connections, valve icons).
  useEffect(() => {
    if (!layout) return
    const deviceGeo: Record<string, { left: number; top: number; width?: number; height?: number }> = {}
    const parsePx = (v: string | undefined): number | undefined => {
      const n = parseFloat(v || '')
      return Number.isFinite(n) ? n : undefined
    }
    ;(layout.devices ?? []).forEach((d) => {
      const id = d.id || `box-${deviceDomId(d.deviceKey || d.device)}`
      deviceGeo[id] = { left: parsePx(d.left) ?? 20, top: parsePx(d.top) ?? 20, width: parsePx(d.width), height: parsePx(d.height) }
    })
    // deviceGeometry must fully replace (clear first).
    clearEditor()
    useEditorStore.setState({ deviceGeometry: deviceGeo })
    useEditorStore.setState({
      decorations: layout.decorations ?? [],
      connections: layout.connections ?? [],
      valveIcons: layout.valveIcons ?? [],
    })
    setRemovedIds(new Set())
    setExtraDevices([])
    // Restore plot panels saved in the layout (legacy create_plot /
    // restorePlotPanelFromLayout). Plots are recreated from their configName
    // when a full saved config exists, else from the embedded trace keys.
    const plotStore = usePlotStore.getState()
    Object.keys(plotStore.plots).forEach((id) => plotStore.removePlot(id))
    ;(layout.plots ?? []).forEach((savedPlot) => {
      const config = layoutPlotToConfig(savedPlot)
      const geo = layoutPlotGeometry(savedPlot)
      const id = plotStore.createPlot(config, { left: geo.left, top: geo.top })
      if (id) {
        plotStore.updateGeometry(id, geo)
        if (savedPlot.title) plotStore.setTitle(id, savedPlot.title)
      }
    })
    refreshSavedPlotNames()
  }, [layout, clearEditor])

  // Hydrate all devices referenced by the layout once it is known.
  const hydratedRef = useRef(false)
  useEffect(() => {
    if (!layout || hydratedRef.current) return
    hydratedRef.current = true
    fetchAndMergeLatestValuesOnce()
      .then(() => {
        const devices = (layout.devices ?? [])
          .map((d) => matchDevice(d, Object.keys(deviceParams ?? {}), deviceParams))
          .filter((d): d is string => !!d)
        const valveDevices = (layout.valveIcons ?? []).map((v) => v.device)
        return Promise.all(Array.from(new Set([...devices, ...valveDevices])).map((d) => hydrateDeviceFromNode(d)))
      })
      .catch(() => undefined)
  }, [layout, deviceParams])

  // Data-saving status polling.
  const refreshDataSavingStatus = useCallback(async () => {
    try {
      const payload = await api.dataSavingStatus()
      const exportState = payload?.export ?? null
      setDataSaving({ status: exportState, running: !!exportState?.running })
    } catch {
      setDataSaving({ status: null, running: false })
    }
  }, [])

  useEffect(() => {
    void refreshDataSavingStatus()
    const interval = window.setInterval(() => void refreshDataSavingStatus(), 10000)
    return () => window.clearInterval(interval)
  }, [refreshDataSavingStatus])

  // ------------------------------------------------------------------
  // Render lists derived from the layout + live values
  // ------------------------------------------------------------------

  const availableDevices = useMemo(() => Object.keys(deviceParams ?? {}), [deviceParams])

  // Devices = layout devices + any devices added via the canvas create menu.
  const allDeviceEntries = useMemo(() => {
    const fromLayout = layout?.devices ?? []
    const layoutIds = new Set(fromLayout.map((d) => d.id))
    const extras = extraDevices.filter((e) => !layoutIds.has(e.id))
    return [...fromLayout, ...extras]
  }, [layout, extraDevices])

  interface RenderedDevice {
    domId: string
    device: string
    left: number
    top: number
    width?: number
    height?: number
    kind: 'device' | 'valve-controller'
  }

  interface RenderedSlot {
    id: string
    device: string
    index: number
    label: unknown
    left?: number
    top?: number
  }

  interface RenderedValve {
    id: string
    device: string
    field: string
    left?: number
    top?: number
    width?: number
    height?: number
    rotationDegrees?: string
    layoutChoices?: { closedSvg?: string; openSvg?: string; switchSvg?: string; switchClosedSvg?: string; switchOpenSvg?: string }
  }

  const { devices, slots, valves, samplePresence } = useMemo<{
    devices: RenderedDevice[]
    slots: RenderedSlot[]
    valves: RenderedValve[]
    samplePresence: { device: string; left?: number; top?: number } | null
  }>(() => {
    const devices: RenderedDevice[] = []
    const slots: RenderedSlot[] = []
    const valves: RenderedValve[] = []
    let samplePresence: { device: string; left?: number; top?: number } | null = null

    const parsePx = (v: string | undefined): number | undefined => {
      const n = parseFloat(v || '')
      return Number.isFinite(n) ? n : undefined
    }

    ;(allDeviceEntries ?? []).forEach((entry) => {
      const matched = matchDevice(entry, availableDevices, deviceParams)
      if (matched) {
        const domId = entry.id && entry.id.startsWith('box-') ? entry.id.slice(4) : entry.id || deviceDomId(matched)
        const info = deviceParams?.[matched]
        const name = (info?.original_name || info?.module_name || matched).toLowerCase()
        const isValveController = name.includes('valve_controller') || matched.toLowerCase().includes('valve_controller')
        devices.push({
          domId,
          device: matched,
          left: parsePx(entry.left) ?? 20,
          top: parsePx(entry.top) ?? 20,
          width: parsePx(entry.width),
          height: parsePx(entry.height),
          kind: isValveController ? 'valve-controller' : 'device',
        })

        // Sample magazine: expand array value into per-slot boxes at layout positions.
        const isSampleMagazine = name.includes('storage') || matched.toLowerCase().includes('storage')
        if (isSampleMagazine) {
          const valueEntry = latestValues[`${matched}.value`] ?? latestValues[`${matched}.target`]
          const arr = Array.isArray(valueEntry?.value) ? (valueEntry.value as unknown[]) : []
          arr.forEach((item, idx) => {
            slots.push({ id: `mag-${deviceDomId(matched)}-slot-${idx}`, device: matched, index: idx, label: item })
          })
        }

        const isSamplePosition = name.includes('sample_at_measurement') || matched.toLowerCase().includes('sample_at_measurement')
        if (isSamplePosition) {
          samplePresence = { device: matched, left: parsePx(entry.left), top: parsePx(entry.top) }
        }
      } else if (isMagSlot(entry)) {
        // Synthetic slot placeholder from a saved layout.
        const id = entry.id || entry.logicalName || ''
        const idxMatch = id.match(/slot-(\d+)/)
        const deviceName = (entry.deviceKey || entry.logicalName || '').replace(/^mag-/, '').replace(/-slot-\d+$/, '')
        slots.push({
          id,
          device: deviceName,
          index: idxMatch ? Number(idxMatch[1]) : 0,
          label: entry.device,
          left: parsePx(entry.left),
          top: parsePx(entry.top),
        })
      }
    })

    // Valve icons saved in the layout.
    ;(layout?.valveIcons ?? []).forEach((iconDef) => {
      valves.push({
        id: iconDef.id,
        device: iconDef.device,
        field: iconDef.field,
        left: parsePx(iconDef.left),
        top: parsePx(iconDef.top),
        width: parsePx(iconDef.width),
        height: parsePx(iconDef.height),
        rotationDegrees: iconDef.rotationDegrees,
        layoutChoices: {
          closedSvg: iconDef.closedSvg,
          openSvg: iconDef.openSvg,
          switchSvg: iconDef.switchSvg,
          switchClosedSvg: iconDef.switchClosedSvg,
          switchOpenSvg: iconDef.switchOpenSvg,
        },
      })
    })

    // Auto-expand valve-controller devices that have no saved icons (legacy setupValveController).
    devices.forEach((d) => {
      if (d.kind !== 'valve-controller') return
      const hasSavedIcons = valves.some((v) => v.device === d.device)
      if (hasSavedIcons) return
      const valueEntry = latestValues[`${d.device}.value`] ?? latestValues[`${d.device}.target`]
      const fields = valveFieldsOf(valueEntry?.value)
      fields.forEach((field, index) => {
        valves.push({ id: `icon-${d.device}_${field}`, device: d.device, field, left: 20, top: 20 + index * 120 })
      })
    })

    return { devices, slots, valves, samplePresence }
  }, [allDeviceEntries, layout, availableDevices, deviceParams, latestValues])

  // Valve icons: prefer editor-store overrides (configure), else layout-derived.
  const valvesAll: RenderedValve[] = useMemo(() => {
    if (!isConfigure) return valves
    const fromStore = editorValveIcons.map((v) => ({
      id: v.id,
      device: v.device,
      field: v.field,
      left: parseFloat(v.left || '') || undefined,
      top: parseFloat(v.top || '') || undefined,
      width: parseFloat(v.width || '') || undefined,
      height: parseFloat(v.height || '') || undefined,
      rotationDegrees: v.rotationDegrees,
      layoutChoices: { closedSvg: v.closedSvg, openSvg: v.openSvg, switchSvg: v.switchSvg, switchClosedSvg: v.switchClosedSvg, switchOpenSvg: v.switchOpenSvg },
    }))
    // Keep auto-expanded valve icons (not yet in the store) too.
    const storeIds = new Set(fromStore.map((v) => v.id))
    return [...fromStore, ...valves.filter((v) => !storeIds.has(v.id))]
  }, [isConfigure, valves, editorValveIcons])

  // Apply device-geometry overrides (drag/resize in configure mode).
  const devicesWithGeo = useMemo(
    () =>
      devices.map((d) => {
        const geo = deviceGeometry[`box-${d.domId}`]
        return geo ? { ...d, left: geo.left, top: geo.top, width: geo.width ?? d.width, height: geo.height ?? d.height } : d
      }),
    [devices, deviceGeometry],
  )

  // Filter out removed elements.
  const visibleDevices = devicesWithGeo.filter((d) => !removedIds.has(`box-${d.domId}`))
  const visibleSlots = slots.filter((s) => !removedIds.has(s.id))
  const visibleValves = valvesAll.filter((v) => !removedIds.has(v.id))

  // Write a field change for one valve icon back into the stored layout copy.
  const syncIconToLayout = useCallback(
    (iconId: string, patch: Record<string, string>) => {
      const selected = selectedLayout
      if (!selected) return
      const layouts = getStoredLayouts()
      const layoutData = layouts[selected]
      if (!layoutData || !Array.isArray(layoutData.valveIcons)) return
      const entry = layoutData.valveIcons.find((item) => item && item.id === iconId)
      if (!entry) return
      Object.assign(entry, patch)
      try {
        localStorage.setItem('gas_system_layouts', JSON.stringify(layouts))
      } catch {
        /* storage unavailable */
      }
    },
    [selectedLayout],
  )

  const removeElement = useCallback(
    (id: string) => {
      setRemovedIds((prev) => new Set(prev).add(id))
      if (id.startsWith('icon-')) {
        useEditorStore.getState().removeValveIcon(id)
        // dblclick-delete also prunes the stored layout entry (legacy behavior).
        const selected = selectedLayout
        if (selected) {
          const layouts = getStoredLayouts()
          const layoutData = layouts[selected]
          if (layoutData && Array.isArray(layoutData.valveIcons)) {
            layoutData.valveIcons = layoutData.valveIcons.filter((v) => v && v.id !== id)
            try {
              localStorage.setItem('gas_system_layouts', JSON.stringify(layouts))
            } catch {
              /* storage unavailable */
            }
          }
        }
      } else if (id.startsWith('deco-')) {
        useEditorStore.getState().removeDecoration(id)
      }
    },
    [selectedLayout],
  )

  // Geometry lookup for the connection layer.
  const getGeometry = useCallback(
    (boxId: string) => {
      if (boxId.startsWith('box-')) {
        const domId = boxId.slice(4)
        const d = devicesWithGeo.find((x) => x.domId === domId)
        if (d) return { left: d.left, top: d.top, width: d.width ?? 240, height: d.height ?? 120 }
      }
      const slot = slots.find((s) => s.id === boxId)
      if (slot) return { left: slot.left ?? 200 + slot.index * 130, top: slot.top ?? 50, width: 120, height: 120 }
      const valve = valvesAll.find((v) => v.id === boxId)
      if (valve) return { left: valve.left ?? 20, top: valve.top ?? 20, width: valve.width ?? 80, height: valve.height ?? 100 }
      const deco = editorDecorations.find((x) => x.id === boxId)
      if (deco) {
        return {
          left: parseFloat(deco.left || '') || 100,
          top: parseFloat(deco.top || '') || 100,
          width: parseFloat(deco.width || '') || (deco.type === 'line' ? 120 : deco.type === 'switch' ? 80 : 100),
          height: parseFloat(deco.height || '') || (deco.type === 'line' ? 12 : deco.type === 'switch' ? 80 : 24),
        }
      }
      return undefined
    },
    [devicesWithGeo, slots, valvesAll, editorDecorations],
  )

  // ---- Layout editor actions --------------------------------------------------

  const canvasPointFromClient = (clientX: number, clientY: number) => {
    const grid = gridRef.current
    if (!grid) return { left: 100, top: 100 }
    const rect = grid.getBoundingClientRect()
    const zoom = useEditorStore.getState().zoom || 1
    return {
      left: Math.max(0, Math.round((clientX - rect.left) / zoom)),
      top: Math.max(0, Math.round((clientY - rect.top) / zoom)),
    }
  }

  const handleAddDeviceEntry = useCallback((entry: LayoutDeviceEntry) => {
    setExtraDevices((prev) => [...prev.filter((e) => e.id !== entry.id), entry])
    setDeviceGeometry(entry.id, {
      left: parseFloat(entry.left || '') || 20,
      top: parseFloat(entry.top || '') || 20,
      width: parseFloat(entry.width || '') || undefined,
      height: parseFloat(entry.height || '') || undefined,
    })
  }, [setDeviceGeometry])

  const handleAddDevice = (device: string, pos: { left: number; top: number }) => {
    const entry: LayoutDeviceEntry = {
      id: `box-${deviceDomId(device)}`,
      device: deviceParams?.[device]?.original_name || device,
      deviceKey: device,
      logicalName: device,
      left: `${pos.left}px`,
      top: `${pos.top}px`,
      width: '',
      height: '',
      info: deviceParams?.[device],
    }
    handleAddDeviceEntry(entry)
  }

  // Canvas clipboard (Ctrl/Cmd+C/X/V)
  useCanvasClipboard({
    enabled: isConfigure,
    lastPointer: lastPointerRef,
    onAddDevice: handleAddDeviceEntry,
    onRemoveElement: removeElement,
  })

  // ---- Plots (create / remove / canvas menu) ----------------------------------

  const handleNewPlot = (pos: { left: number; top: number }) => {
    setPlotConfigPosition(pos)
    setPlotConfigOpen(true)
  }

  const handleCreateSavedPlot = async (name: string, pos: { left: number; top: number }) => {
    const config = await import('../store/plotStore').then((m) => m.loadPlotConfig(name))
    if (!config) return
    createPlotInStore(config, pos)
  }

  const handleCreatePlotFromConfig = (config: PlotConfig, pos: { left: number; top: number } | null) => {
    createPlotInStore(config, pos ?? undefined)
  }

  const handleRemovePlot = (id: string) => {
    removePlotFromStore(id)
  }

  const handleAddDecoration = (type: string, pos: { left: number; top: number }) => {
    const id = `deco-${Date.now()}`
    const deco: LayoutDecorationEntry = {
      id,
      type,
      left: `${pos.left}px`,
      top: `${pos.top}px`,
      width: type === 'line' ? '120px' : type === 'switch' ? '80px' : '100px',
      height: type === 'line' ? '12px' : type === 'switch' ? '80px' : '24px',
      color: '#cccccc',
      text: type === 'label' ? 'Label' : '',
      fontFamily: type === 'label' ? 'Arial, sans-serif' : '',
      fontSize: type === 'label' ? '16px' : '',
      lineColor: type === 'line' ? '#007bff' : '',
      lineWidth: type === 'line' ? '2' : '',
      lineType: type === 'line' ? 'solid' : '',
      rotationDegrees: '0',
    }
    addDecoration(deco)
    setEditorSelected(id)
  }

  const handleSaveLayout = async () => {
    const layoutData = buildCurrentLayout()
    await saveLayout(layoutData)
  }

  const handleLoadLayout = async () => {
    const result = await loadLayoutFromFile()
    if (!result) return
    useAppStore.getState().setSelectedLayout(result.name)
    hydrateDeviceMetadataFromLayout(result.layout)
    setLayout(result.layout)
  }

  const handleNewLayout = () => {
    setLayout(null)
    setRemovedIds(new Set())
    setExtraDevices([])
    clearEditor()
    useAppStore.getState().setSelectedLayout(null)
  }

  const buildCurrentLayout = (): LayoutData => {
    const deviceEntries: LayoutDeviceEntry[] = visibleDevices.map((d) => {
      const geo = deviceGeometry[`box-${d.domId}`]
      const info = deviceParams?.[d.device]
      return {
        id: `box-${d.domId}`,
        device: info?.original_name || info?.module_name || d.device,
        deviceKey: d.device,
        logicalName: d.device,
        left: `${geo?.left ?? d.left}px`,
        top: `${geo?.top ?? d.top}px`,
        width: geo?.width ? `${geo.width}px` : d.width ? `${d.width}px` : '',
        height: geo?.height ? `${geo.height}px` : d.height ? `${d.height}px` : '',
        info,
        image: null,
      }
    })
    const valveEntries = visibleValves.map((v) => ({
      id: v.id,
      device: v.device,
      field: v.field,
      left: `${v.left ?? 20}px`,
      top: `${v.top ?? 20}px`,
      width: v.width ? `${v.width}px` : '',
      height: v.height ? `${v.height}px` : '',
      rotationDegrees: v.rotationDegrees || '0',
      closedSvg: v.layoutChoices?.closedSvg || '',
      openSvg: v.layoutChoices?.openSvg || '',
      switchSvg: v.layoutChoices?.switchSvg || '',
      switchClosedSvg: v.layoutChoices?.switchClosedSvg || '',
      switchOpenSvg: v.layoutChoices?.switchOpenSvg || '',
    }))
    // Plot panels: persist geometry + config reference (legacy getCurrentLayoutData).
    const plotEntries = Object.values(usePlotStore.getState().plots).map((p) => ({
      id: `${p.id}_panel`,
      title: p.title,
      configName: p.configName,
      xAxisTitle: p.xAxisTitle,
      yAxisTitle: p.yAxisTitle,
      left: `${p.left}px`,
      top: `${p.top}px`,
      width: `${p.width}px`,
      height: `${p.height}px`,
      traces: Object.keys(p.traces),
    }))
    return {
      devices: deviceEntries,
      valveIcons: valveEntries,
      decorations: editorDecorations,
      plots: plotEntries,
      connections: editorConnections,
    }
  }

  // Silently persist the in-progress editor state back to the selected layout
  // (no prompt) so switching to connect/GUI mode shows the latest edits,
  // including drawn connection lines. Connect mode reloads the saved layout,
  // so edits must be committed on the way out of the editor.
  const persistCurrentLayoutSilently = useCallback(async () => {
    const name = selectedLayout
    if (!name) return
    const layoutData = buildCurrentLayout()
    try {
      saveStoredLayout(name, layoutData)
      await api.nodemanager('save_layout', { name, layout: layoutData }).catch(() => undefined)
    } catch {
      /* best-effort */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLayout, visibleDevices, visibleValves, editorDecorations, editorConnections, deviceGeometry, deviceParams])

  // Canvas right-click: open create menu only on empty canvas targets.
  const handleGridContextMenu = (e: React.MouseEvent) => {
    if (!isConfigure) return
    const target = e.target as HTMLElement
    const inCanvas = !!target.closest?.('#device-grid, #viewport')
    const blocked = !!target.closest?.(
      '.device-box, .deco-box, .plot-panel, .valve-icon, .line-context-menu, .text-context-menu, .canvas-create-menu, .contact-point, .device-connection-line',
    )
    if (!inCanvas || blocked) return
    e.preventDefault()
    const pos = canvasPointFromClient(e.clientX, e.clientY)
    setCreateMenu({ x: e.clientX, y: e.clientY, canvasLeft: pos.left, canvasTop: pos.top })
  }

  // Click on empty grid clears selection; track pointer for clipboard paste.
  const handleGridMouseDown = (e: React.MouseEvent) => {
    if (isConfigure) {
      lastPointerRef.current = canvasPointFromClient(e.clientX, e.clientY)
    }
    if (!isConfigure) return
    if (e.target === gridRef.current || (e.target as HTMLElement).id === 'viewport') {
      setEditorSelected(null)
    }
  }

  // Focus the viewport on the content bounding box after load (legacy focusViewportOnLayoutContent).
  useEffect(() => {
    if (!layout || !viewportRef.current) return
    const raf = requestAnimationFrame(() => {
      const grid = gridRef.current
      const viewport = viewportRef.current
      if (!grid || !viewport) return
      const elements = Array.from(grid.querySelectorAll('.device-box, .deco-box, .valve-icon, .plot-panel')) as HTMLElement[]
      if (!elements.length) return
      let minLeft = Infinity
      let minTop = Infinity
      elements.forEach((el) => {
        const l = Number.isFinite(el.offsetLeft) ? el.offsetLeft : parseFloat(el.style.left || '0')
        const t = Number.isFinite(el.offsetTop) ? el.offsetTop : parseFloat(el.style.top || '0')
        if (Number.isFinite(l)) minLeft = Math.min(minLeft, l)
        if (Number.isFinite(t)) minTop = Math.min(minTop, t)
      })
      if (Number.isFinite(minLeft)) viewport.scrollLeft = Math.max(0, minLeft - 40)
      if (Number.isFinite(minTop)) viewport.scrollTop = Math.max(0, minTop - 40)
    })
    return () => cancelAnimationFrame(raf)
  }, [layout])

  // ---- GUI mode (fullscreen, hides editor chrome) ----------------------------

  const toggleGuiMode = useCallback(() => {
    // Leaving the editor (entering GUI/connect view) commits pending edits.
    if (isConfigure) {
      void persistCurrentLayoutSilently()
    }
    setGuiMode((current) => {
      const next = !current
      if (next) {
        document.documentElement.requestFullscreen?.().catch(() => undefined)
      } else if (document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => undefined)
      }
      return next
    })
  }, [isConfigure, persistCurrentLayoutSilently])

  const handleBack = useCallback(() => {
    if (isConfigure) {
      void persistCurrentLayoutSilently()
    }
    navigate('/')
  }, [isConfigure, persistCurrentLayoutSilently, navigate])

  const openHistory = useCallback(() => {
    window.open('/history', '_blank', 'noopener')
  }, [])

  return (
    <div id="main-panel" style={{ display: 'block' }} className={isConfigure ? 'config-mode' : ''} data-configuration-mode={isConfigure ? 'true' : 'false'}>
      {!guiMode && (
        <div id="main-panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div id="main-panel-title-wrap" style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <h3 id="main-panel-title" style={{ margin: 0 }}>
              {isConfigure ? 'Configure your system layout' : 'System view'}
              {selectedLayout ? ` — ${selectedLayout}` : ''}
            </h3>
          </div>
          <TopToolbar
            isConfigure={isConfigure}
            guiMode={guiMode}
            configPanelsHidden={configPanelsHidden}
            onBack={handleBack}
            onToggleConfigPanels={() => setConfigPanelsHidden((v) => !v)}
            onToggleGuiMode={toggleGuiMode}
            onOpenDataSaving={() => setDataSavingOpen(true)}
            onStopDataSaving={() => void stopDataSavingFlow(refreshDataSavingStatus)}
            onOpenNexusBrowser={() => setNexusOpen(true)}
            onOpenHistory={openHistory}
            dataSaving={dataSaving}
          />
        </div>
      )}
      {guiMode && (
        <button
          type="button"
          className="topbar-action-btn topbar-action-btn-neutral"
          style={{ position: 'fixed', top: 8, right: 8, zIndex: 5000 }}
          onClick={toggleGuiMode}
        >
          Configure GUI
        </button>
      )}

      {loadError && (
        <div style={{ padding: 16, color: '#b91c1c' }}>
          {loadError}{' '}
          <button type="button" onClick={() => navigate('/')}>
            Back to start
          </button>
        </div>
      )}

      {!selectedLayout && !loadError && (
        <div style={{ padding: 16, color: '#64748b' }}>
          No layout selected. Go back and pick a saved layout, or configure a new one.
        </div>
      )}

      {/* Full-width workspace: device grid (3000×2000) inside a scrollable viewport */}
      <div style={{ width: '100%', padding: '8px 12px', boxSizing: 'border-box' }}>
        <div
          className="viewport"
          id="viewport"
          ref={viewportRef}
          style={{ overflow: 'auto', position: 'relative', height: guiMode ? '100vh' : undefined }}
        >
          <div
            id="device-grid"
            ref={gridRef}
            onContextMenu={handleGridContextMenu}
            onMouseDown={handleGridMouseDown}
            style={{
              width: 3000,
              height: 2000,
              position: 'relative',
              background: '#fdfdfd',
              transform: `scale(${isConfigure ? editorZoom : 1})`,
              transformOrigin: '0 0',
            }}
          >
            <ConnectionLayer getGeometry={getGeometry} interactive={isConfigure} />
            {visibleDevices.map((d) =>
              d.kind === 'valve-controller' ? null : (
                <DeviceBox
                  key={`box-${d.domId}`}
                  device={d.device}
                  domId={d.domId}
                  isConfigure={isConfigure}
                  left={d.left}
                  top={d.top}
                  width={d.width}
                  height={d.height}
                  onRemove={(id) => removeElement(`box-${id}`)}
                  onGeometryChange={(domId, geo) => setDeviceGeometry(`box-${domId}`, geo)}
                />
              ),
            )}
            {visibleSlots.map((s) => (
              <SampleSlot
                key={s.id}
                device={s.device}
                index={s.index}
                label={s.label}
                isConfigure={isConfigure}
                left={s.left}
                top={s.top}
                onRemove={removeElement}
                onGeometryChange={(id, geo) => setDeviceGeometry(id, geo)}
              />
            ))}
            {samplePresence && !removedIds.has('sample_presence') && (
              <SamplePresence device={samplePresence.device} isConfigure={isConfigure} left={samplePresence.left} top={samplePresence.top} onRemove={removeElement} onGeometryChange={(id, geo) => setDeviceGeometry(id, geo)} />
            )}
            {visibleValves.map((v) => (
              <ValveIcon
                key={`${v.id}-${iconsVersion}`}
                device={v.device}
                field={v.field}
                isConfigure={isConfigure}
                left={v.left}
                top={v.top}
                width={v.width}
                height={v.height}
                rotationDegrees={v.rotationDegrees}
                layoutChoices={v.layoutChoices}
                onRemove={removeElement}
                onGeometryChange={(id, geo) => {
                  if (id.startsWith('icon-')) {
                    updateValveIcon(id, { left: `${geo.left}px`, top: `${geo.top}px`, width: `${geo.width}px`, height: `${geo.height}px` })
                    syncIconToLayout(id, { left: `${geo.left}px`, top: `${geo.top}px` })
                  }
                }}
              />
            ))}
            {editorDecorations.map((deco) => (
              <DecorationBox key={deco.id} decoration={deco} isConfigure={isConfigure} onGeometryChange={(id, geo) => setDeviceGeometry(id, geo)} />
            ))}
            {Object.values(plotPanels).map((p) => (
              <PlotPanel key={p.id} panel={p} isConfigure={isConfigure} onRemove={handleRemovePlot} />
            ))}
          </div>
        </div>
      </div>

      <ValveIconMenus isConfigure={isConfigure} onRefreshIcons={() => setIconsVersion((v) => v + 1)} />

      <CanvasCreateMenu
        request={createMenu}
        onClose={() => setCreateMenu(null)}
        onAddDevice={handleAddDevice}
        onAddDecoration={handleAddDecoration}
        onNewPlot={handleNewPlot}
        onCreateSavedPlot={(name, pos) => void handleCreateSavedPlot(name, pos)}
        onZoom={(delta) => useEditorStore.getState().zoomBy(delta)}
        onResetView={() => {
          useEditorStore.getState().resetZoom()
          if (viewportRef.current) {
            viewportRef.current.scrollLeft = 0
            viewportRef.current.scrollTop = 0
          }
        }}
        onSaveLayout={handleSaveLayout}
        onLoadLayout={() => void handleLoadLayout()}
        onNewLayout={handleNewLayout}
      />

      <PlotConfigWindow
        open={plotConfigOpen}
        position={plotConfigPosition}
        onClose={() => setPlotConfigOpen(false)}
        onCreatePlot={handleCreatePlotFromConfig}
      />

      <DataSavingDialog open={dataSavingOpen} onClose={() => setDataSavingOpen(false)} onStatusChanged={refreshDataSavingStatus} />
      <NexusBrowser open={nexusOpen} onClose={() => setNexusOpen(false)} />
    </div>
  )
}
