import type { LayoutCanvasData, LayoutData, LayoutSubpage } from '../../api/types'

export const MAIN_PAGE_ID = 'main'

/** Extract a single canvas, including defaults for older layout files. */
export function layoutCanvas(layout?: Partial<LayoutCanvasData> | null): LayoutCanvasData {
  return {
    devices: layout?.devices ?? [],
    valveIcons: layout?.valveIcons ?? [],
    decorations: layout?.decorations ?? [],
    plots: layout?.plots ?? [],
    connections: layout?.connections ?? [],
  }
}

/** Keep the main page compatible with existing saved layouts. */
export function layoutDocument(
  main: LayoutCanvasData,
  pages: LayoutSubpage[],
  activeId: string,
  current: LayoutCanvasData,
): LayoutData {
  const root = activeId === MAIN_PAGE_ID ? current : main
  return {
    ...root,
    ...(pages.length ? {
      pages: pages.map((page) => page.id === activeId ? { ...page, layout: current } : page),
    } : {}),
  }
}
