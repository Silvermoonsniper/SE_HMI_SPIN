/**
 * Central application store (Zustand).
 *
 * Replaces the legacy global shared state: window.SEAppState, latestValues,
 * WRITABLE_PARAMS and friends. Latest values are stored under flat
 * "<device>.<param>" keys; helpers resolve device/param pairs.
 */

import { create } from 'zustand'
import type { DeviceParamsMap, LatestValue, LatestValues, SecopState, UpdateEvent } from '../api/types'

export type RenderMode = 'configure' | 'connect'

interface AppState {
  /** Device metadata map from device_params.json / nodemanager.device_params. */
  deviceParams: DeviceParamsMap | null
  /** Flat latest-value cache ("device.param" -> payload). */
  latestValues: LatestValues
  /** Whether the live WebSocket is currently connected. */
  wsConnected: boolean
  /** Whether the layout editor (configuration mode) is active. */
  configurationMode: boolean
  /** Name of the currently selected layout (mirrors sessionStorage). */
  selectedLayout: string | null
  /** How the current layout should be rendered once loaded. */
  pendingRenderMode: RenderMode | null
  /** SECoP nodes from nodes.json / nodemanager.nodes pushes. */
  nodes: Array<{ host: string; port: number }>

  setDeviceParams: (params: DeviceParamsMap | null) => void
  /** Merge entries into deviceParams (incoming wins per key; never wipes). */
  mergeDeviceParams: (params: DeviceParamsMap | null) => void
  mergeLatestValues: (values: LatestValues) => void
  applyUpdate: (update: UpdateEvent) => void
  setWsConnected: (connected: boolean) => void
  setConfigurationMode: (active: boolean) => void
  setSelectedLayout: (name: string | null) => void
  setPendingRenderMode: (mode: RenderMode | null) => void
  setNodes: (nodes: Array<{ host: string; port: number }>) => void
}

const SELECTED_LAYOUT_KEY = 'selectedLayout'
const PENDING_MODE_KEY = 'pendingLayoutRenderMode'

export const useAppStore = create<AppState>((set) => ({
  deviceParams: null,
  latestValues: {},
  wsConnected: false,
  configurationMode: false,
  selectedLayout: sessionStorage.getItem(SELECTED_LAYOUT_KEY),
  pendingRenderMode: (sessionStorage.getItem(PENDING_MODE_KEY) as RenderMode | null) ?? null,
  nodes: [],

  setDeviceParams: (params) => set({ deviceParams: params }),

  mergeDeviceParams: (params) =>
    set((state) => {
      if (!params || Object.keys(params).length === 0) return {}
      return { deviceParams: { ...(state.deviceParams ?? {}), ...params } }
    }),

  mergeLatestValues: (values) =>
    set((state) => ({ latestValues: { ...state.latestValues, ...values } })),

  applyUpdate: (update) =>
    set((state) => ({
      latestValues: {
        ...state.latestValues,
        [update.key]: {
          value: update.value,
          unit: update.unit ?? '',
          state: update.state,
          state_str: update.state_str ?? '',
        },
      },
    })),

  setWsConnected: (connected) => set({ wsConnected: connected }),

  setConfigurationMode: (active) => set({ configurationMode: active }),

  setSelectedLayout: (name) => {
    if (name) {
      sessionStorage.setItem(SELECTED_LAYOUT_KEY, name)
    } else {
      sessionStorage.removeItem(SELECTED_LAYOUT_KEY)
    }
    set({ selectedLayout: name })
  },

  setPendingRenderMode: (mode) => {
    if (mode) {
      sessionStorage.setItem(PENDING_MODE_KEY, mode)
    } else {
      sessionStorage.removeItem(PENDING_MODE_KEY)
    }
    set({ pendingRenderMode: mode })
  },

  setNodes: (nodes) => set({ nodes: Array.isArray(nodes) ? nodes : [] }),
}))

// ---------------------------------------------------------------------------
// Selectors / helpers
// ---------------------------------------------------------------------------

/** Split a flat update key into device and parameter at the first dot. */
export function splitKey(key: string): { device: string; param: string } {
  const idx = key.indexOf('.')
  if (idx < 0) return { device: key, param: '' }
  return { device: key.slice(0, idx), param: key.slice(idx + 1) }
}

/** Read the latest value for one device parameter from a values map. */
export function getParamValue(values: LatestValues, device: string, param: string): LatestValue | undefined {
  return values[`${device}.${param}`]
}

/** Read the status payload of one device. */
export function getDeviceStatus(
  values: LatestValues,
  device: string,
): { state: SecopState; stateStr: string } | undefined {
  const payload = values[`${device}.status`]
  if (!payload) return undefined
  return { state: payload.state, stateStr: payload.state_str }
}

/** Sanitize a device name into a DOM-id-safe token (legacy deviceDomId). */
export function deviceDomId(device: string): string {
  return device.replace(/[^a-zA-Z0-9_-]/g, '_')
}
