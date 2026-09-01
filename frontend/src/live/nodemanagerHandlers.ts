/**
 * Global handlers for nodemanager.* live updates (ported from the legacy
 * spinupdate listeners in system-runtime.js / system-core.js).
 *
 * The nodemanager device delivers command results as pushed parameters:
 *   nodemanager.nodes          -> list of configured nodes
 *   nodemanager.status         -> transient status message (auto-cleared)
 *   nodemanager.device_params  -> full device metadata map
 */

import { liveClient } from '../api/ws'
import { api } from '../api/client'
import { useAppStore } from '../store/appStore'
import { appAlert } from '../store/dialogStore'
import { scheduleBackendRestartReload } from '../utils/restartRecovery'
import { getRuntimeNodeAddrs, setRuntimeNodeAddr } from '../utils/storage'
import type { DeviceParamsMap } from '../api/types'

let initialized = false

export function initNodemanagerHandlers(): void {
  if (initialized) return
  initialized = true

  liveClient.onUpdate((update) => {
    const { key, value } = update

    if (key === 'nodemanager.nodes') {
      if (Array.isArray(value)) {
        useAppStore.getState().setNodes(value as Array<{ host: string; port: number }>)
      }
      return
    }

    if (key === 'nodemanager.device_params') {
      if (value && typeof value === 'object') {
        const previous = useAppStore.getState().deviceParams ?? {}
        const next = value as DeviceParamsMap
        // Merge rather than replace: after a backend restart with unreachable
        // nodes the pushed map may be empty, which must not wipe metadata that
        // was hydrated from the loaded layout.
        useAppStore.getState().mergeDeviceParams(next)

        // Attribute newly-seen devices to the node that was just added so
        // address resolution works immediately after add_node.
        const pendingAddr = sessionStorage.getItem('pending_backend_restart_addr')
        if (pendingAddr) {
          const known = getRuntimeNodeAddrs()
          Object.keys(next).forEach((deviceKey) => {
            if (!(deviceKey in previous) && !known[deviceKey]) {
              setRuntimeNodeAddr(deviceKey, pendingAddr)
            }
          })
        }
      }
      return
    }

    if (key === 'nodemanager.status') {
      const message = typeof value === 'string' ? value.trim() : ''
      if (!message) return
      if (message.includes('Restarting server')) {
        scheduleBackendRestartReload()
      }
      if (message.includes('Node added successfully')) {
        // Refresh params and values through the REST channel.
        api
          .nodemanager('get_device_params')
          .catch(() => undefined)
        api
          .latestValues()
          .then((values) => useAppStore.getState().mergeLatestValues(values))
          .catch(() => undefined)
      }
      void appAlert(message, 'Node Manager')
      return
    }
  })
}
