/**
 * localStorage/sessionStorage helpers.
 *
 * Key names and payload schemas are identical to the legacy frontend so that
 * existing user data (saved layouts, plot configs, icon choices, preferences)
 * keeps working unchanged.
 */

import type { LayoutData, PlotConfig } from '../api/types'

export const LAYOUT_STORAGE_KEY = 'gas_system_layouts'
export const PLOT_CONFIG_STORAGE_KEY = 'plot_configurations'
export const START_PAGE_MODE_KEY = 'startPageMode'
export const RESTART_ON_REFRESH_KEY = 'restart_on_refresh'
export const RESTART_LAST_REQUESTED_KEY = 'restart_last_requested'
export const RUNTIME_NODE_ADDRS_KEY = 'runtime_node_addrs'
export const SYSTEM_BG_KEY = 'system_bg'

// -- Saved layouts ------------------------------------------------------------

export function getStoredLayouts(): Record<string, LayoutData> {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, LayoutData>) : {}
  } catch {
    return {}
  }
}

export function saveStoredLayout(name: string, layout: LayoutData): void {
  const layouts = getStoredLayouts()
  layouts[name] = layout
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts))
}

export function deleteStoredLayout(name: string): void {
  const layouts = getStoredLayouts()
  delete layouts[name]
  localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layouts))
}

// -- Plot configurations --------------------------------------------------------

export function getStoredPlotConfigs(): Record<string, PlotConfig> {
  try {
    const raw = localStorage.getItem(PLOT_CONFIG_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, PlotConfig>) : {}
  } catch {
    return {}
  }
}

export function saveStoredPlotConfig(name: string, config: PlotConfig): void {
  const configs = getStoredPlotConfigs()
  configs[name] = config
  localStorage.setItem(PLOT_CONFIG_STORAGE_KEY, JSON.stringify(configs))
}

export function deleteStoredPlotConfig(name: string): void {
  const configs = getStoredPlotConfigs()
  delete configs[name]
  localStorage.setItem(PLOT_CONFIG_STORAGE_KEY, JSON.stringify(configs))
}

// -- Runtime node address cache ---------------------------------------------------

export function getRuntimeNodeAddrs(): Record<string, string> {
  try {
    const raw = localStorage.getItem(RUNTIME_NODE_ADDRS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function setRuntimeNodeAddr(device: string, addr: string): void {
  const addrs = getRuntimeNodeAddrs()
  addrs[device] = addr
  localStorage.setItem(RUNTIME_NODE_ADDRS_KEY, JSON.stringify(addrs))
}

// -- Icon artwork overrides ---------------------------------------------------------

export function getIconOverride(kind: 'valve-svg' | 'switch-svg' | 'magimg', ...parts: Array<string | number>): string | null {
  return localStorage.getItem([kind, ...parts].join(':'))
}

export function setIconOverride(kind: 'valve-svg' | 'switch-svg' | 'magimg', value: string, ...parts: Array<string | number>): void {
  localStorage.setItem([kind, ...parts].join(':'), value)
}
