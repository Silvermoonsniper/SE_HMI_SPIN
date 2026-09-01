/**
 * Backend restart recovery.
 *
 * Ported from system-runtime.js `scheduleBackendRestartReload`: after a node
 * is added the backend re-execs itself; the UI polls a readiness endpoint and
 * reloads the page once the backend is back and the node is streaming values.
 * State is kept in sessionStorage so an in-progress recovery survives reloads.
 */

import { api } from '../api/client'

const PENDING_RECOVERY_KEY = 'pending_backend_restart_recovery'
const PENDING_ADDR_KEY = 'pending_backend_restart_addr'
const POLL_INTERVAL_MS = 1000
const MIN_WAIT_MS = 4000
const MAX_WAIT_MS = 60000

let activeTimer: number | null = null

async function probeReady(addr: string | null): Promise<boolean> {
  try {
    if (addr) {
      const payload = await api.runtimeNodeReady(addr)
      return Boolean(payload?.ready)
    }
    await api.latestValues()
    return true
  } catch {
    return false
  }
}

/**
 * Arm the restart-recovery polling loop. When the backend becomes ready again
 * the page reloads so all state is rebuilt cleanly.
 */
export function scheduleBackendRestartReload(startedAt?: number, expectedAddr?: string): void {
  const started = startedAt ?? Date.now()
  const addr = expectedAddr ?? null

  sessionStorage.setItem(PENDING_RECOVERY_KEY, String(started))
  if (addr) {
    sessionStorage.setItem(PENDING_ADDR_KEY, addr)
  } else {
    sessionStorage.removeItem(PENDING_ADDR_KEY)
  }

  if (activeTimer !== null) {
    window.clearTimeout(activeTimer)
    activeTimer = null
  }

  const tick = async () => {
    const elapsed = Date.now() - started
    const ready = await probeReady(addr)
    if (ready && elapsed >= MIN_WAIT_MS) {
      sessionStorage.removeItem(PENDING_RECOVERY_KEY)
      sessionStorage.removeItem(PENDING_ADDR_KEY)
      window.location.reload()
      return
    }
    if (elapsed >= MAX_WAIT_MS) {
      sessionStorage.removeItem(PENDING_RECOVERY_KEY)
      sessionStorage.removeItem(PENDING_ADDR_KEY)
      window.location.reload()
      return
    }
    activeTimer = window.setTimeout(tick, POLL_INTERVAL_MS)
  }

  activeTimer = window.setTimeout(tick, POLL_INTERVAL_MS)
}

/** Resume a pending recovery after a page reload (call once at app start). */
export function resumePendingRestartRecovery(): void {
  const started = Number(sessionStorage.getItem(PENDING_RECOVERY_KEY) || 0)
  if (!started) return
  const addr = sessionStorage.getItem(PENDING_ADDR_KEY) || undefined
  scheduleBackendRestartReload(started, addr)
}
