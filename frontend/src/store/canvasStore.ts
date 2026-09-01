/**
 * Canvas element store — tracks every element rendered on the device-grid
 * canvas (device boxes, valve icons, sample slots, decorations, plot panels)
 * with their geometry. Phase 3 populates device boxes and slots; the layout
 * editor (Phase 4) adds drag/resize/connections on top of this same store.
 */

import { create } from 'zustand'

export type CanvasElementKind = 'device' | 'valve' | 'slot' | 'decoration' | 'plot'

export interface CanvasElementGeometry {
  id: string
  kind: CanvasElementKind
  device?: string
  left: number
  top: number
  width: number
  height: number
}

interface CanvasState {
  elements: Record<string, CanvasElementGeometry>
  upsertElement: (el: CanvasElementGeometry) => void
  removeElement: (id: string) => void
  clear: () => void
  moveElement: (id: string, left: number, top: number) => void
}

export const useCanvasStore = create<CanvasState>((set) => ({
  elements: {},

  upsertElement: (el) => set((s) => ({ elements: { ...s.elements, [el.id]: el } })),

  removeElement: (id) =>
    set((s) => {
      const next = { ...s.elements }
      delete next[id]
      return { elements: next }
    }),

  clear: () => set({ elements: {} }),

  moveElement: (id, left, top) =>
    set((s) => {
      const el = s.elements[id]
      if (!el) return s
      return { elements: { ...s.elements, [id]: { ...el, left, top } } }
    }),
}))
