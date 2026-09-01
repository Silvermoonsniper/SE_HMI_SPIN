/**
 * Canvas clipboard (Ctrl/Cmd+C/X/V) — React port of buildCanvasClipboard /
 * pasteCanvasClipboard / removeSelectedCanvasElement from system-layout.js.
 *
 * Supported copy sources: device boxes (re-created with a unique domId),
 * decorations, and valve icons (deep-copied with a unique id). Plot panels are
 * handled in Phase 5.
 */

import { useEffect } from 'react'
import { useAppStore, deviceDomId } from '../../store/appStore'
import { useEditorStore } from '../../store/editorStore'
import type { LayoutDecorationEntry, LayoutDeviceEntry, LayoutValveIconEntry } from '../../api/types'

interface ClipboardDevice {
  kind: 'device'
  device: string
  width?: string
  height?: string
}

interface ClipboardDecoration {
  kind: 'deco'
  data: LayoutDecorationEntry
}

interface ClipboardValve {
  kind: 'valve'
  data: LayoutValveIconEntry
}

type ClipboardItem = ClipboardDevice | ClipboardDecoration | ClipboardValve

/** Module-level clipboard (legacy `canvasClipboard` global). */
let canvasClipboard: ClipboardItem | null = null

function uniqueToken(prefix: string): string {
  const safe = String(prefix || 'item').replace(/[^a-zA-Z0-9_-]+/g, '_')
  return `${safe}_copy_${Date.now()}`
}

function isShortcutInputTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  const tag = (el.tagName || '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return !!el.closest?.('input, textarea, select, [contenteditable="true"]')
}

interface UseCanvasClipboardOptions {
  enabled: boolean
  /** Current pointer position in canvas coordinates (for paste placement). */
  lastPointer: React.MutableRefObject<{ left: number; top: number }>
  onAddDevice: (entry: LayoutDeviceEntry) => void
  onRemoveElement: (id: string) => void
}

export function useCanvasClipboard({ enabled, lastPointer, onAddDevice, onRemoveElement }: UseCanvasClipboardOptions): void {
  useEffect(() => {
    if (!enabled) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (isShortcutInputTarget(event.target)) return

      const key = (event.key || '').toLowerCase()
      const editor = useEditorStore.getState()
      const selectedId = editor.selectedId
      if (!selectedId) return

      const buildClipboard = (): ClipboardItem | null => {
        // Device box
        if (selectedId.startsWith('box-')) {
          const domId = selectedId.slice(4)
          const geo = editor.deviceGeometry[selectedId]
          // Recover the device key: domId is usually the sanitized device name.
          const deviceParams = useAppStore.getState().deviceParams ?? {}
          const device = Object.keys(deviceParams).find((d) => deviceDomId(d) === domId) ?? domId
          return { kind: 'device', device, width: geo?.width ? `${geo.width}px` : '', height: geo?.height ? `${geo.height}px` : '' }
        }
        // Valve icon
        if (selectedId.startsWith('icon-')) {
          const icon = editor.valveIcons.find((v) => v.id === selectedId)
          if (icon) return { kind: 'valve', data: { ...icon } }
          return null
        }
        // Decoration
        const deco = editor.decorations.find((d) => d.id === selectedId)
        if (deco) return { kind: 'deco', data: { ...deco } }
        return null
      }

      if (key === 'c') {
        const clip = buildClipboard()
        if (clip) canvasClipboard = clip
        event.preventDefault()
        return
      }

      if (key === 'x') {
        const clip = buildClipboard()
        if (!clip) return
        canvasClipboard = clip
        onRemoveElement(selectedId)
        editor.setSelected(null)
        event.preventDefault()
        return
      }

      if (key === 'v') {
        if (!canvasClipboard) return
        const { left, top } = lastPointer.current
        if (canvasClipboard.kind === 'device') {
          const device = canvasClipboard.device
          const newDomId = uniqueToken(deviceDomId(device || 'device'))
          const info = (useAppStore.getState().deviceParams ?? {})[device]
          onAddDevice({
            id: `box-${newDomId}`,
            device: info?.original_name || device,
            deviceKey: device,
            logicalName: device,
            left: `${left}px`,
            top: `${top}px`,
            width: canvasClipboard.width || '',
            height: canvasClipboard.height || '',
            info,
          })
        } else if (canvasClipboard.kind === 'deco') {
          const deco: LayoutDecorationEntry = {
            ...canvasClipboard.data,
            id: uniqueToken('deco'),
            left: `${left}px`,
            top: `${top}px`,
          }
          editor.addDecoration(deco)
          editor.setSelected(deco.id)
        } else if (canvasClipboard.kind === 'valve') {
          const icon: LayoutValveIconEntry = {
            ...canvasClipboard.data,
            id: uniqueToken('icon'),
            left: `${left}px`,
            top: `${top}px`,
          }
          editor.setValveIcons([...editor.valveIcons, icon])
          editor.setSelected(icon.id)
        }
        event.preventDefault()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled, lastPointer, onAddDevice, onRemoveElement])
}
