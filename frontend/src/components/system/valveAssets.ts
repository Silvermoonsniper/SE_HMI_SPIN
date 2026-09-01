/**
 * Valve/switch SVG artwork — defaults and per-device/field/state overrides.
 *
 * Ported from system-devices.js. Overrides are stored in localStorage under
 * the legacy keys: valve-svg:<dev>:<field>:<state>, switch-svg:<dev>:<field>:<state>
 * (plus the legacy single-key fallback switch-svg:<dev>:<field>).
 */

export const DEFAULT_VALVE_CLOSED_SVG =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9Ijk0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iOTQiIGZpbGw9IiNmZmYiLz48cG9seWdvbiBwb2ludHM9IjEwLDIwIDEwLDc0IDYwLDQ3IiBmaWxsPSIjMDAwMDAwIiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMiIvPjxwb2x5Z29uIHBvaW50cz0iMTEwLDIwIDExMCw3NCA2MCw0NyIgZmlsbD0iIzAwMDAwMCIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4='
export const DEFAULT_VALVE_OPEN_SVG =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9Ijk0IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iOTQiIGZpbGw9IiNmZmYiLz48IS0tIExlZnQgdHJpYW5nbGUgcG9pbnRpbmcgcmlnaHQgLS0+PHBvbHlnb24gcG9pbnRzPSIxMCwyMCAxMCw3NCA2MCw0NyIgZmlsbD0iIzI4YTc0NSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIiLz48IS0tIFJpZ2h0IHRyaWFuZ2xlIHBvaW50aW5nIGxlZnQgLS0+PHBvbHlnb24gcG9pbnRzPSIxMTAsMjAgMTEwLDc0IDYwLDQ3IiBmaWxsPSIjMjhhNzQ1IiBzdHJva2U9IiMwMDAiIHN0cm9rZS13aWR0aD0iMiIvPjwvc3ZnPg=='
export const DEFAULT_SWITCH_SVG =
  'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTI0IiBoZWlnaHQ9IjEwNiIgZmlsbD0id2hpdGUiLz48ZyB0cmFuc2Zvcm09InRyYW5zbGF0ZSg2Miw1MykiPjxjaXJjbGUgY3g9IjAiIGN5PSIwIiByPSI0NSIgZmlsbD0id2hpdGUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIi8+PHBhdGggZD0iTSAtNDQuMyA2LjcgQSA0NSA0NSAwIDAgMSAtNi43IDQ0LjMiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzMzMyIgc3Ryb2tlLXdpZHRoPSIzIiBzdHJva2UtbGluZWNhcD0icm91bmQiLz48cGF0aCBkPSJNIDQ0LjMgLTYuNyBBIDQ1IDQ1IDAgMCAxIDYuNyAtNDQuMyIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMzMzIiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPjwvZz48L3N2Zz4='
export const DEFAULT_SWITCH_CLOSED_SVG = DEFAULT_SWITCH_SVG
export const DEFAULT_SWITCH_OPEN_SVG = DEFAULT_SWITCH_SVG

export type IconState = 'closed' | 'open'

function readPreference(kind: 'valve-svg' | 'switch-svg', device: string, field: string, state: IconState): string | null {
  try {
    return localStorage.getItem(`${kind}:${device}:${field}:${state}`)
  } catch {
    return null
  }
}

function writePreference(kind: 'valve-svg' | 'switch-svg', device: string, field: string, state: IconState, value: string): void {
  try {
    if (value) {
      localStorage.setItem(`${kind}:${device}:${field}:${state}`, value)
    } else {
      localStorage.removeItem(`${kind}:${device}:${field}:${state}`)
    }
  } catch {
    /* storage unavailable */
  }
}

function readLegacySwitchPreference(device: string, field: string): string | null {
  try {
    return localStorage.getItem(`switch-svg:${device}:${field}`)
  } catch {
    return null
  }
}

/** Resolve the valve SVG for a state, honoring stored overrides. */
export function getValveSvg(device: string, field: string, isOpen: boolean, layoutChoices?: { closedSvg?: string; openSvg?: string }): string {
  const state: IconState = isOpen ? 'open' : 'closed'
  const fallback = isOpen ? DEFAULT_VALVE_OPEN_SVG : DEFAULT_VALVE_CLOSED_SVG
  return (
    (isOpen ? layoutChoices?.openSvg : layoutChoices?.closedSvg) ||
    readPreference('valve-svg', device, field, state) ||
    fallback
  )
}

/** Resolve the switch SVG for a state, honoring stored overrides + legacy key. */
export function getSwitchSvg(
  device: string,
  field: string,
  isOpen: boolean,
  layoutChoices?: { switchSvg?: string; switchClosedSvg?: string; switchOpenSvg?: string },
): string {
  const state: IconState = isOpen ? 'open' : 'closed'
  const fallback = isOpen ? DEFAULT_SWITCH_OPEN_SVG : DEFAULT_SWITCH_CLOSED_SVG
  const layoutChoice = isOpen ? layoutChoices?.switchOpenSvg : layoutChoices?.switchClosedSvg
  return (
    layoutChoice ||
    layoutChoices?.switchSvg ||
    readPreference('switch-svg', device, field, state) ||
    readLegacySwitchPreference(device, field) ||
    fallback
  )
}

/** Persist valve artwork overrides (empty string resets to default). */
export function setValveSvgChoices(device: string, field: string, closedSvg: string, openSvg: string): void {
  writePreference('valve-svg', device, field, 'closed', closedSvg === DEFAULT_VALVE_CLOSED_SVG ? '' : closedSvg)
  writePreference('valve-svg', device, field, 'open', openSvg === DEFAULT_VALVE_OPEN_SVG ? '' : openSvg)
}

/** Persist switch artwork overrides (empty string resets to default). */
export function setSwitchSvgChoices(device: string, field: string, closedSvg: string, openSvg: string): void {
  writePreference('switch-svg', device, field, 'closed', closedSvg === DEFAULT_SWITCH_CLOSED_SVG ? '' : closedSvg)
  writePreference('switch-svg', device, field, 'open', openSvg === DEFAULT_SWITCH_OPEN_SVG ? '' : openSvg)
}
