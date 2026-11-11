import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import type { LayoutSubpage } from '../../api/types'
import { MAIN_PAGE_ID } from '../editor/layoutPages'

interface LayoutPageTabsProps {
  pages: LayoutSubpage[]
  activeId: string
  canEdit: boolean
  onSelect: (id: string) => void
  onAdd: () => void
  onRename: () => void
  onRemove: () => void
  onSave: () => void
}

export function LayoutPageTabs({ pages, activeId, canEdit, onSelect, onAdd, onRename, onRemove, onSave }: LayoutPageTabsProps) {
  const tabsRef = useRef<HTMLDivElement>(null)
  const tabs = [{ id: MAIN_PAGE_ID, name: 'Main' }, ...pages]
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    onSelect(tabs[next].id)
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div className="layout-page-bar">
      <div ref={tabsRef} role="tablist" aria-label="GUI pages" className="layout-page-tabs">
        {tabs.map((page, index) => (
          <button key={page.id} type="button" role="tab" id={`layout-tab-${page.id}`}
            aria-controls="layout-page-canvas" aria-selected={activeId === page.id}
            tabIndex={activeId === page.id ? 0 : -1}
            onClick={() => onSelect(page.id)} onKeyDown={(event) => handleKeyDown(event, index)}>
            {page.name}
          </button>
        ))}
      </div>
      {canEdit && (
        <div className="layout-page-actions" aria-label="Page actions">
          <button type="button" onClick={onAdd}>+ Add page</button>
          <button type="button" onClick={onRename} disabled={activeId === MAIN_PAGE_ID}>Rename page</button>
          <button type="button" onClick={onRemove} disabled={activeId === MAIN_PAGE_ID}>Remove page</button>
          <button type="button" className="layout-save-button" onClick={onSave}>Save layout</button>
        </div>
      )}
    </div>
  )
}
