/**
 * Promise-based modal dialogs (React port of the legacy showAppAlert /
 * showAppConfirm / showAppPrompt framework).
 *
 * Usage from anywhere:
 *   await appAlert('Saved')
 *   const ok = await appConfirm('Delete layout?')
 *   const name = await appPrompt('Layout name', 'default')
 */

import { create } from 'zustand'
import type { ReactNode } from 'react'

export type DialogKind = 'alert' | 'confirm' | 'prompt'

export interface DialogRequest {
  id: number
  kind: DialogKind
  title?: string
  message: ReactNode
  defaultValue?: string
  resolve: (value: unknown) => void
}

interface DialogState {
  current: DialogRequest | null
  enqueue: (req: DialogRequest) => void
  settle: (value: unknown) => void
}

let nextDialogId = 1
const queue: DialogRequest[] = []

export const useDialogStore = create<DialogState>((set, get) => ({
  current: null,

  enqueue: (req) => {
    if (get().current) {
      queue.push(req)
    } else {
      set({ current: req })
    }
  },

  settle: (value) => {
    const current = get().current
    if (!current) return
    current.resolve(value)
    const next = queue.shift() ?? null
    set({ current: next })
  },
}))

function showDialog<T>(kind: DialogKind, message: ReactNode, options: { title?: string; defaultValue?: string } = {}): Promise<T> {
  return new Promise<T>((resolve) => {
    useDialogStore.getState().enqueue({
      id: nextDialogId++,
      kind,
      title: options.title,
      message,
      defaultValue: options.defaultValue,
      resolve: resolve as (value: unknown) => void,
    })
  })
}

export function appAlert(message: ReactNode, title?: string): Promise<void> {
  return showDialog<void>('alert', message, { title })
}

export function appConfirm(message: ReactNode, title?: string): Promise<boolean> {
  return showDialog<boolean>('confirm', message, { title })
}

export function appPrompt(message: ReactNode, defaultValue = '', title?: string): Promise<string | null> {
  return showDialog<string | null>('prompt', message, { title, defaultValue })
}
