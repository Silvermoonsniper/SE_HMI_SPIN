/**
 * Valve/switch icon context menus — React port of showValveIconActionMenu
 * (configure mode: Rotate Icon / Change SVG) and showValveSvgPicker
 * (choose Closed/Open artwork from /api/assets/svg, Apply/Reset) from
 * system-devices.js.
 *
 * Choices persist to localStorage (legacy keys) and are written back into the
 * currently selected layout's valveIcons entry (legacy
 * syncValveRotationToStoredLayout / syncValveSvgSelectionToStoredLayout).
 */

import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useEditorStore } from '../../store/editorStore'
import { appAlert, appPrompt } from '../../store/dialogStore'
import {
  DEFAULT_SWITCH_CLOSED_SVG,
  DEFAULT_SWITCH_OPEN_SVG,
  DEFAULT_VALVE_CLOSED_SVG,
  DEFAULT_VALVE_OPEN_SVG,
  setSwitchSvgChoices,
  setValveSvgChoices,
} from '../system/valveAssets'
import { getStoredLayouts } from '../../utils/storage'
import { useAppStore } from '../../store/appStore'

export interface ValveMenuTarget {
  iconId: string
  device: string
  field: string
}

interface ValveIconMenusProps {
  isConfigure: boolean
  onRefreshIcons: () => void
}

/** Write the given rotation/svg fields back into the stored layout's matching valveIcons entry. */
function syncIconToStoredLayout(iconId: string, patch: Record<string, string>): void {
  const selected = useAppStore.getState().selectedLayout
  if (!selected) return
  const layouts = getStoredLayouts()
  const layout = layouts[selected]
  if (!layout || !Array.isArray(layout.valveIcons)) return
  const entry = layout.valveIcons.find((item) => item && item.id === iconId)
  if (!entry) return
  Object.assign(entry, patch)
  try {
    localStorage.setItem('gas_system_layouts', JSON.stringify(layouts))
  } catch {
    /* storage unavailable */
  }
}

export function ValveIconMenus({ isConfigure, onRefreshIcons }: ValveIconMenusProps) {
  const [actionMenu, setActionMenu] = useState<{ target: ValveMenuTarget; x: number; y: number } | null>(null)
  const [picker, setPicker] = useState<{ target: ValveMenuTarget; x: number; y: number } | null>(null)
  const [assets, setAssets] = useState<Array<{ name: string; url: string }>>([])
  const [closedChoice, setClosedChoice] = useState('')
  const [openChoice, setOpenChoice] = useState('')
  const valveIcons = useEditorStore((s) => s.valveIcons)
  const updateValveIcon = useEditorStore((s) => s.updateValveIcon)

  // Right-click any valve icon: configure mode -> action menu; run mode -> SVG picker.
  useEffect(() => {
    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const icon = target?.closest?.('.valve-icon') as HTMLElement | null
      if (!icon) return
      event.preventDefault()
      event.stopPropagation()
      const t: ValveMenuTarget = {
        iconId: icon.id,
        device: icon.dataset.device || '',
        field: icon.dataset.field || '',
      }
      if (icon.classList.contains('configure-layout')) {
        setPicker(null)
        setActionMenu({ target: t, x: event.clientX, y: event.clientY })
      } else {
        setActionMenu(null)
        void openPicker(t, event.clientX, event.clientY)
      }
    }
    document.addEventListener('contextmenu', onContextMenu, true)
    return () => document.removeEventListener('contextmenu', onContextMenu, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openPicker = async (target: ValveMenuTarget, x: number, y: number) => {
    try {
      const payload = await api.svgAssets()
      setAssets(payload.files ?? [])
    } catch (e) {
      await appAlert(`Failed to load SVG assets.\n${e instanceof Error ? e.message : e}`, 'Valve SVG')
      return
    }
    // Prefill from the editor-store layout choices if present.
    const stored = valveIcons.find((v) => v.id === target.iconId)
    void stored
    setClosedChoice('')
    setOpenChoice('')
    setPicker({ target, x, y })
  }

  const rotateIcon = async (target: ValveMenuTarget) => {
    setActionMenu(null)
    const current = valveIcons.find((v) => v.id === target.iconId)
    const response = await appPrompt(
      'Enter icon rotation in degrees',
      String(current?.rotationDegrees ?? '0'),
      `Rotate ${target.field || 'Valve Icon'}`,
    )
    if (response === null) return
    const next = parseFloat(String(response).trim())
    if (!Number.isFinite(next)) {
      await appAlert('Please enter a valid number of degrees.', `Rotate ${target.field || 'Valve Icon'}`)
      return
    }
    updateValveIcon(target.iconId, { rotationDegrees: String(next) })
    syncIconToStoredLayout(target.iconId, { rotationDegrees: String(next) })
    onRefreshIcons()
  }

  const isSwitch = (picker?.target.field ?? '').toLowerCase().includes('switch')
  const defaults = isSwitch
    ? { closed: DEFAULT_SWITCH_CLOSED_SVG, open: DEFAULT_SWITCH_OPEN_SVG }
    : { closed: DEFAULT_VALVE_CLOSED_SVG, open: DEFAULT_VALVE_OPEN_SVG }

  const applyPicker = () => {
    if (!picker) return
    const { device, field, iconId } = picker.target
    const closed = closedChoice || defaults.closed
    const open = openChoice || defaults.open
    if (isSwitch) {
      setSwitchSvgChoices(device, field, closed, open)
      syncIconToStoredLayout(iconId, { switchClosedSvg: closed, switchOpenSvg: open, switchSvg: open })
      updateValveIcon(iconId, { switchClosedSvg: closed, switchOpenSvg: open, switchSvg: open })
    } else {
      setValveSvgChoices(device, field, closed, open)
      syncIconToStoredLayout(iconId, { closedSvg: closed, openSvg: open })
      updateValveIcon(iconId, { closedSvg: closed, openSvg: open })
    }
    setPicker(null)
    onRefreshIcons()
  }

  const resetPicker = () => {
    if (!picker) return
    const { device, field, iconId } = picker.target
    if (isSwitch) {
      setSwitchSvgChoices(device, field, defaults.closed, defaults.open)
      syncIconToStoredLayout(iconId, { switchClosedSvg: '', switchOpenSvg: '', switchSvg: '' })
      updateValveIcon(iconId, { switchClosedSvg: '', switchOpenSvg: '', switchSvg: '' })
    } else {
      setValveSvgChoices(device, field, defaults.closed, defaults.open)
      syncIconToStoredLayout(iconId, { closedSvg: '', openSvg: '' })
      updateValveIcon(iconId, { closedSvg: '', openSvg: '' })
    }
    setPicker(null)
    onRefreshIcons()
  }

  const svgOptions = [{ name: 'Built-in', url: '' }, ...assets]

  return (
    <>
      {/* Action menu (configure mode): Rotate / Change SVG / Cancel */}
      {actionMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 5100 }} onMouseDown={() => setActionMenu(null)} onContextMenu={(e) => { e.preventDefault(); setActionMenu(null) }} />
          <div className="valve-icon-action-menu" style={{ display: 'block', position: 'fixed', left: Math.min(actionMenu.x, window.innerWidth - 180), top: Math.min(actionMenu.y, window.innerHeight - 140), zIndex: 5101 }}>
            <button type="button" onClick={() => void rotateIcon(actionMenu.target)}>Rotate Icon</button>
            <button type="button" onClick={() => { const t = actionMenu.target; setActionMenu(null); void openPicker(t, actionMenu.x, actionMenu.y) }}>Change SVG</button>
            <button type="button" onClick={() => setActionMenu(null)}>Cancel</button>
          </div>
        </>
      )}

      {/* SVG picker */}
      {picker && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 5100 }} onMouseDown={() => setPicker(null)} onContextMenu={(e) => { e.preventDefault(); setPicker(null) }} />
          <div className="valve-svg-picker-menu" style={{ display: 'block', position: 'fixed', left: Math.min(picker.x, window.innerWidth - 260), top: Math.min(picker.y, window.innerHeight - 220), zIndex: 5101 }}>
            <div className="valve-svg-picker-title">{picker.target.field || (isSwitch ? 'Switch' : 'Valve')} SVG</div>
            <label className="valve-svg-picker-label" htmlFor="valve-svg-closed-select">{isSwitch ? 'State 0' : 'Closed (0)'}</label>
            <select id="valve-svg-closed-select" className="valve-svg-picker-select" value={closedChoice} onChange={(e) => setClosedChoice(e.target.value)}>
              {svgOptions.map((o) => (
                <option key={`c-${o.url || o.name}`} value={o.url}>{o.name}</option>
              ))}
            </select>
            <label className="valve-svg-picker-label" htmlFor="valve-svg-open-select">{isSwitch ? 'State 1' : 'Open (1)'}</label>
            <select id="valve-svg-open-select" className="valve-svg-picker-select" value={openChoice} onChange={(e) => setOpenChoice(e.target.value)}>
              {svgOptions.map((o) => (
                <option key={`o-${o.url || o.name}`} value={o.url}>{o.name}</option>
              ))}
            </select>
            <div className="valve-svg-picker-actions">
              <button type="button" onClick={applyPicker}>Apply</button>
              <button type="button" onClick={resetPicker}>Reset</button>
              <button type="button" onClick={() => setPicker(null)}>Cancel</button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
