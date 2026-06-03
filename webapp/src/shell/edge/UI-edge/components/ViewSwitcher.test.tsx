// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, screen, waitFor, cleanup } from '@testing-library/react'
import { ViewSwitcher } from './ViewSwitcher'

type ViewRecord = { viewId: string; name: string; isActive: boolean }

function makeElectronAPI(views: ViewRecord[]): Window['hostAPI'] {
  const listeners: Array<(data: { activeViewId: string }) => void> = []

  const api = {
    main: {
      views: {
        list: vi.fn(async () => views),
        activate: vi.fn(async (viewId: string) => {
          const v = views.find((r) => r.viewId === viewId)
          if (!v) throw new Error('not found')
          views.forEach((r) => { r.isActive = r.viewId === viewId })
          listeners.forEach((l) => l({ activeViewId: viewId }))
          return { ...v, isActive: true }
        }),
        clone: vi.fn(async (_srcViewId: string, name: string) => {
          const id = `cloned-${name}`
          views.push({ viewId: id, name, isActive: false })
          return { viewId: id, name, isActive: false }
        }),
        delete: vi.fn(async (viewId: string) => {
          const idx = views.findIndex((r) => r.viewId === viewId)
          if (idx !== -1) views.splice(idx, 1)
        }),
      },
    },
    onViewSwitched: vi.fn((cb: (data: { activeViewId: string }) => void) => {
      listeners.push(cb)
      return () => {
        const i = listeners.indexOf(cb)
        if (i !== -1) listeners.splice(i, 1)
      }
    }),
  }
  return api as unknown as Window['hostAPI']
}

describe('ViewSwitcher', () => {
  let views: ViewRecord[]

  beforeEach(() => {
    views = [
      { viewId: 'v1', name: 'main', isActive: true },
      { viewId: 'v2', name: 'scratch', isActive: false },
    ]
    Object.defineProperty(window, 'hostAPI', {
      value: makeElectronAPI(views),
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    cleanup()
    Object.defineProperty(window, 'hostAPI', {
      value: undefined,
      writable: true,
      configurable: true,
    })
  })

  it('renders trigger with active view name', async () => {
    render(<ViewSwitcher />)
    await waitFor(() =>
      expect(screen.getByTestId('view-switcher-trigger')).toHaveTextContent('main'),
    )
  })

  it('opens dropdown with view list on click', async () => {
    render(<ViewSwitcher />)
    await waitFor(() => screen.getByTestId('view-switcher-trigger'))
    fireEvent.click(screen.getByTestId('view-switcher-trigger'))
    expect(screen.getByTestId('view-switcher-dropdown')).toBeInTheDocument()
    expect(screen.getByTestId('view-item-main')).toBeInTheDocument()
    expect(screen.getByTestId('view-item-scratch')).toBeInTheDocument()
  })

  it('active view has no delete button', async () => {
    render(<ViewSwitcher />)
    await waitFor(() => screen.getByTestId('view-switcher-trigger'))
    fireEvent.click(screen.getByTestId('view-switcher-trigger'))
    expect(screen.queryByTestId('view-delete-main')).not.toBeInTheDocument()
    expect(screen.getByTestId('view-delete-scratch')).toBeInTheDocument()
  })

  it('activates view on click and refreshes list', async () => {
    render(<ViewSwitcher />)
    await waitFor(() => screen.getByTestId('view-switcher-trigger'))
    fireEvent.click(screen.getByTestId('view-switcher-trigger'))
    fireEvent.click(screen.getByTestId('view-item-scratch'))
    await waitFor(() =>
      expect(window.hostAPI!.main.views.activate).toHaveBeenCalledWith('v2'),
    )
  })

  it('shows inline input on + New view, submits with Enter', async () => {
    render(<ViewSwitcher />)
    await waitFor(() => screen.getByTestId('view-switcher-trigger'))
    fireEvent.click(screen.getByTestId('view-switcher-trigger'))
    fireEvent.click(screen.getByTestId('new-view-button'))
    const input = screen.getByTestId('new-view-name-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'focus' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(window.hostAPI!.main.views.clone).toHaveBeenCalledWith('v1', 'focus'),
    )
    await waitFor(() =>
      expect(window.hostAPI!.main.views.activate).toHaveBeenCalledWith('cloned-focus'),
    )
  })

  it('deletes non-active view and refreshes', async () => {
    render(<ViewSwitcher />)
    await waitFor(() => screen.getByTestId('view-switcher-trigger'))
    fireEvent.click(screen.getByTestId('view-switcher-trigger'))
    fireEvent.click(screen.getByTestId('view-delete-scratch'))
    await waitFor(() =>
      expect(window.hostAPI!.main.views.delete).toHaveBeenCalledWith('v2'),
    )
  })

  it('refreshes on view:switched event', async () => {
    render(<ViewSwitcher />)
    await waitFor(() => screen.getByTestId('view-switcher-trigger'))
    expect(window.hostAPI!.onViewSwitched).toHaveBeenCalled()
  })
})
