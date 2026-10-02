/**
 * Mouse-based drag & resize hook for canvas elements — React port of
 * makeDraggable / makeResizable from system-layout.js.
 *
 * Movement is applied directly to the DOM node during the gesture (no React
 * re-render per mousemove) and committed to the caller via onDragEnd /
 * onResizeEnd so the layout store can persist it.
 */

import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

export interface GeometryResult {
  left: number
  top: number
  width: number
  height: number
}

interface UseCanvasDragOptions {
  /** Whether editing gestures are enabled (configure mode). */
  enabled: boolean
  /** Minimum width/height while resizing (device/deco use 150x80, lines 38). */
  minWidth?: number
  minHeight?: number
  /** Line decorations resize horizontally only. */
  lineOnly?: boolean
  onDragEnd?: (result: GeometryResult) => void
  onResizeEnd?: (result: GeometryResult) => void
}

export function useCanvasDrag(ref: RefObject<HTMLElement | null>, options: UseCanvasDragOptions): void {
  const { enabled, minWidth = 150, minHeight = 80, lineOnly = false, onDragEnd, onResizeEnd } = options
  // Keep latest callbacks without re-binding listeners.
  const callbacks = useRef({ onDragEnd, onResizeEnd })
  callbacks.current = { onDragEnd, onResizeEnd }

  useEffect(() => {
    const el = ref.current
    if (!el || !enabled) return

    let isDragging = false
    let isResizing = false
    let startX = 0
    let startY = 0
    let initialLeft = 0
    let initialTop = 0
    let initialWidth = 0
    let initialHeight = 0
    let scaleX = 1
    let scaleY = 1

    const captureScale = () => {
      const rect = el.getBoundingClientRect()
      scaleX = el.offsetWidth ? rect.width / el.offsetWidth || 1 : 1
      scaleY = el.offsetHeight ? rect.height / el.offsetHeight || 1 : 1
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const target = e.target as HTMLElement

      // Don't start dragging from interactive controls / editable text.
      if (target.classList?.contains('deco-remove')) return
      if (target.classList?.contains('resize-handle')) return
      if (['SELECT', 'INPUT', 'BUTTON', 'TEXTAREA'].includes(target.tagName)) return
      if (target.closest?.('.control-section')) return
      if (target.classList?.contains('contact-point')) return
      if (target.isContentEditable && !target.classList?.contains('deco-drag-handle')) return

      const style = window.getComputedStyle(el)
      captureScale()
      initialLeft = parseInt(style.left, 10) || el.offsetLeft || 0
      initialTop = parseInt(style.top, 10) || el.offsetTop || 0
      startX = e.clientX
      startY = e.clientY
      isDragging = true
      el.style.zIndex = '1000'
      e.preventDefault()
    }

    const onResizeMouseDown = (e: MouseEvent) => {
      e.stopPropagation()
      if (e.button !== 0) return
      isResizing = true
      captureScale()
      startX = e.clientX
      startY = e.clientY
      const style = window.getComputedStyle(el)
      initialWidth = parseInt(style.width, 10) || el.offsetWidth
      initialHeight = parseInt(style.height, 10) || el.offsetHeight
      e.preventDefault()
    }

    const resizeHandle = el.querySelector<HTMLElement>('.resize-handle')
    resizeHandle?.addEventListener('mousedown', onResizeMouseDown)
    el.addEventListener('mousedown', onMouseDown)

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        e.preventDefault()
        const dx = (e.clientX - startX) / scaleX
        const dy = (e.clientY - startY) / scaleY
        el.style.left = `${initialLeft + dx}px`
        el.style.top = `${initialTop + dy}px`
      } else if (isResizing) {
        e.preventDefault()
        const dx = (e.clientX - startX) / scaleX
        const dy = (e.clientY - startY) / scaleY
        el.style.width = `${Math.max(minWidth, initialWidth + dx)}px`
        if (!lineOnly) {
          el.style.height = `${Math.max(minHeight, initialHeight + dy)}px`
        } else {
          el.style.height = `${Math.max(12, initialHeight + dy)}px`
        }
      }
    }

    const onMouseUp = () => {
      if (isDragging) {
        isDragging = false
        el.style.zIndex = '10'
        callbacks.current.onDragEnd?.({
          left: parseInt(el.style.left, 10) || 0,
          top: parseInt(el.style.top, 10) || 0,
          width: el.offsetWidth,
          height: el.offsetHeight,
        })
      }
      if (isResizing) {
        isResizing = false
        callbacks.current.onResizeEnd?.({
          left: parseInt(el.style.left, 10) || 0,
          top: parseInt(el.style.top, 10) || 0,
          width: el.offsetWidth,
          height: el.offsetHeight,
        })
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      el.removeEventListener('mousedown', onMouseDown)
      resizeHandle?.removeEventListener('mousedown', onResizeMouseDown)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [ref, enabled, minWidth, minHeight, lineOnly])
}
