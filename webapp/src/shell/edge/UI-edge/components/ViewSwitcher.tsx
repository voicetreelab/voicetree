import { useState, useEffect, useRef, useCallback } from 'react'
import type { JSX, KeyboardEvent, ChangeEvent } from 'react'
import type {} from '@/shell/hostApi'

type ViewRecord = {
  readonly viewId: string
  readonly name: string
  readonly isActive: boolean
}

async function fetchViews(): Promise<readonly ViewRecord[]> {
  if (!window.hostAPI) return []
  return window.hostAPI.main.views.list()
}

async function activateView(viewId: string): Promise<void> {
  if (!window.hostAPI) return
  await window.hostAPI.main.views.activate(viewId)
}

async function cloneAndActivate(srcViewId: string, name: string): Promise<void> {
  if (!window.hostAPI) return
  const cloned = await window.hostAPI.main.views.clone(srcViewId, name)
  await window.hostAPI.main.views.activate(cloned.viewId)
}

async function deleteView(viewId: string): Promise<void> {
  if (!window.hostAPI) return
  await window.hostAPI.main.views.delete(viewId)
}

export function ViewSwitcher(): JSX.Element | null {
  const [views, setViews] = useState<readonly ViewRecord[]>([])
  const [open, setOpen] = useState(false)
  const [showInput, setShowInput] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const activeView = views.find((v) => v.isActive)

  const refreshViews = useCallback(async (): Promise<void> => {
    const result = await fetchViews()
    setViews(result)
  }, [])

  useEffect(() => {
    void refreshViews()
  }, [refreshViews])

  useEffect(() => {
    if (!window.hostAPI?.onViewSwitched) return
    return window.hostAPI.onViewSwitched(() => void refreshViews())
  }, [refreshViews])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setShowInput(false)
        setNewViewName('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus inline input when shown
  useEffect(() => {
    if (showInput) inputRef.current?.focus()
  }, [showInput])

  const handleActivate = async (viewId: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await activateView(viewId)
      await refreshViews()
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (e: React.MouseEvent, viewId: string): Promise<void> => {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      await deleteView(viewId)
      await refreshViews()
    } finally {
      setBusy(false)
    }
  }

  const handleNewView = async (): Promise<void> => {
    const name = newViewName.trim()
    if (!name || !activeView || busy) return
    setBusy(true)
    try {
      await cloneAndActivate(activeView.viewId, name)
      await refreshViews()
      setShowInput(false)
      setNewViewName('')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const handleInputKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') void handleNewView()
    if (e.key === 'Escape') {
      setShowInput(false)
      setNewViewName('')
    }
  }

  if (!window.hostAPI) return null

  return (
    <div ref={dropdownRef} className="relative font-mono text-xs">
      <button
        data-testid="view-switcher-trigger"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-1.5 py-1 rounded bg-muted hover:bg-accent text-muted-foreground transition-colors"
        title="Switch view"
      >
        <span>{activeView?.name ?? '…'}</span>
        <span className="text-[10px]">▼</span>
      </button>

      {open && (
        <div
          data-testid="view-switcher-dropdown"
          className="absolute bottom-full mb-1 left-0 z-[1200] min-w-[140px] rounded border border-border bg-background shadow-lg"
        >
          {views.map((v) => (
            <div
              key={v.viewId}
              data-testid={`view-item-${v.name}`}
              className="flex items-center justify-between px-2 py-1 hover:bg-accent cursor-pointer"
              onClick={() => !v.isActive && void handleActivate(v.viewId)}
            >
              <span className={v.isActive ? 'font-semibold text-foreground' : 'text-muted-foreground'}>
                {v.isActive ? '✓ ' : ''}{v.name}
              </span>
              {!v.isActive && (
                <button
                  data-testid={`view-delete-${v.name}`}
                  onClick={(e) => void handleDelete(e, v.viewId)}
                  className="ml-2 text-muted-foreground hover:text-destructive"
                  title={`Delete view "${v.name}"`}
                  disabled={busy}
                >
                  🗑
                </button>
              )}
            </div>
          ))}

          <div className="border-t border-border px-2 py-1">
            {showInput ? (
              <div className="flex items-center gap-1">
                <input
                  ref={inputRef}
                  data-testid="new-view-name-input"
                  type="text"
                  value={newViewName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setNewViewName(e.target.value)}
                  onKeyDown={handleInputKey}
                  placeholder="View name…"
                  className="flex-1 min-w-0 bg-muted rounded px-1 py-0.5 text-foreground outline-none text-xs"
                  disabled={busy}
                />
                <button
                  data-testid="new-view-confirm"
                  onClick={() => void handleNewView()}
                  className="px-1.5 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-80 disabled:opacity-50 text-xs"
                  disabled={!newViewName.trim() || busy}
                >
                  ✓
                </button>
              </div>
            ) : (
              <button
                data-testid="new-view-button"
                onClick={() => setShowInput(true)}
                className="w-full text-left text-muted-foreground hover:text-foreground"
                disabled={busy}
              >
                + New view
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
