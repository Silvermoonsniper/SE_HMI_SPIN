/**
 * Layout-editor state (configure mode) — positions/geometry of every canvas
 * element plus zoom, selection, and clipboard. Geometry lives here (not in the
 * DOM) so React owns the source of truth for save/load.
 */

import { create } from 'zustand'
import type {
  LayoutConnectionEntry,
  LayoutDecorationEntry,
  LayoutDeviceEntry,
  LayoutPlotEntry,
  LayoutValveIconEntry,
} from '../api/types'

export interface DecorationState extends LayoutDecorationEntry {
  /** runtime color for non-label decorations */
}

interface EditorState {
  zoom: number
  selectedId: string | null
  decorations: LayoutDecorationEntry[]
  connections: LayoutConnectionEntry[]
  valveIcons: LayoutValveIconEntry[]
  deviceGeometry: Record<string, { left: number; top: number; width?: number; height?: number }>
  plotGeometry: Record<string, Partial<LayoutPlotEntry>>

  setZoom: (z: number) => void
  zoomBy: (delta: number) => void
  resetZoom: () => void
  setSelected: (id: string | null) => void

  addDecoration: (d: LayoutDecorationEntry) => void
  updateDecoration: (id: string, patch: Partial<LayoutDecorationEntry>) => void
  removeDecoration: (id: string) => void

  addConnection: (c: LayoutConnectionEntry) => void
  updateConnection: (index: number, patch: Partial<LayoutConnectionEntry>) => void
  removeConnection: (index: number) => void
  setConnections: (c: LayoutConnectionEntry[]) => void

  setValveIcons: (icons: LayoutValveIconEntry[]) => void
  updateValveIcon: (id: string, patch: Partial<LayoutValveIconEntry>) => void
  removeValveIcon: (id: string) => void

  setDeviceGeometry: (id: string, geo: { left: number; top: number; width?: number; height?: number }) => void
  setPlotGeometry: (id: string, geo: Partial<LayoutPlotEntry>) => void

  clearAll: () => void
}

const MIN_ZOOM = 0.3
const MAX_ZOOM = 3.0

export const useEditorStore = create<EditorState>((set) => ({
  zoom: 1,
  selectedId: null,
  decorations: [],
  connections: [],
  valveIcons: [],
  deviceGeometry: {},
  plotGeometry: {},

  setZoom: (z) => set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z)) }),
  zoomBy: (delta) => set((s) => ({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, s.zoom + delta)) })),
  resetZoom: () => set({ zoom: 1 }),
  setSelected: (id) => set({ selectedId: id }),

  addDecoration: (d) => set((s) => ({ decorations: [...s.decorations, d] })),
  updateDecoration: (id, patch) =>
    set((s) => ({ decorations: s.decorations.map((d) => (d.id === id ? { ...d, ...patch } : d)) })),
  removeDecoration: (id) => set((s) => ({ decorations: s.decorations.filter((d) => d.id !== id) })),

  addConnection: (c) => set((s) => ({ connections: [...s.connections, c] })),
  updateConnection: (index, patch) =>
    set((s) => ({ connections: s.connections.map((c, i) => (i === index ? { ...c, ...patch } : c)) })),
  removeConnection: (index) => set((s) => ({ connections: s.connections.filter((_, i) => i !== index) })),
  setConnections: (c) => set({ connections: c }),

  setValveIcons: (icons) => set({ valveIcons: icons }),
  updateValveIcon: (id, patch) =>
    set((s) => ({ valveIcons: s.valveIcons.map((v) => (v.id === id ? { ...v, ...patch } : v)) })),
  removeValveIcon: (id) => set((s) => ({ valveIcons: s.valveIcons.filter((v) => v.id !== id) })),

  setDeviceGeometry: (id, geo) => set((s) => ({ deviceGeometry: { ...s.deviceGeometry, [id]: geo } })),
  setPlotGeometry: (id, geo) => set((s) => ({ plotGeometry: { ...s.plotGeometry, [id]: geo } })),

  clearAll: () =>
    set({
      decorations: [],
      connections: [],
      valveIcons: [],
      deviceGeometry: {},
      plotGeometry: {},
      selectedId: null,
      zoom: 1,
    }),
}))
