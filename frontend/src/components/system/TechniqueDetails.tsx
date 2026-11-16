import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TechniqueRow } from './waferMeasurement'

export function TechniqueDetails({ technique }: { technique: TechniqueRow }) {
  const id = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const keepOpen = () => {
    clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const scheduleClose = () => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !popupRef.current) return
    // Native popovers occupy the browser's top layer, above canvas stacking contexts.
    const panel = popupRef.current
    panel.setAttribute('popover', 'manual')
    if (typeof panel.showPopover === 'function' && !panel.matches(':popover-open')) panel.showPopover()
    const button = buttonRef.current.getBoundingClientRect()
    const popup = popupRef.current.getBoundingClientRect()
    const gap = 8
    const left = button.right + gap + popup.width <= window.innerWidth - gap
      ? button.right + gap : button.left - popup.width - gap
    setPosition({
      left: Math.max(gap, Math.min(left, window.innerWidth - popup.width - gap)),
      top: Math.max(gap, Math.min(button.top, window.innerHeight - popup.height - gap)),
    })
  }, [open, technique])

  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useEffect(() => {
    if (!open) return
    const dismiss = () => setOpen(false)
    const keyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss() }
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return
      dismiss()
    }
    document.addEventListener('keydown', keyDown)
    window.addEventListener('resize', dismiss)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('keydown', keyDown)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open])

  return <>
    <button ref={buttonRef} type="button" className="wafer-details-button"
      aria-describedby={open ? id : undefined}
      onMouseEnter={keepOpen} onMouseLeave={scheduleClose}
      onFocus={keepOpen} onBlur={scheduleClose} onClick={keepOpen}>details</button>
    {open && createPortal(<div ref={popupRef} id={id} role="tooltip"
      className="wafer-details-popup" style={position}
      onMouseEnter={keepOpen} onMouseLeave={scheduleClose}>
      <strong>Technique {technique.number} · {technique.name}</strong>
      <dl>{technique.details.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>
    </div>, document.body)}
  </>
}
