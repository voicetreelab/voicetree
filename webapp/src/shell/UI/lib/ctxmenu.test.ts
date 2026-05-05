import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

interface CtxMenu {
  show: (items: {text: string}[], event: MouseEvent) => void
  hide: () => void
}

describe('ctxmenu getScale() zero-division guard', () => {
  let ctxmenu: CtxMenu

  beforeEach(async () => {
    Object.defineProperty(window, 'visualViewport', {
      value: { width: 1312, height: 800 },
      writable: true,
      configurable: true,
    })

    delete (window as unknown as Record<string, unknown>).ctxmenu
    await import('./ctxmenu.js')
    ctxmenu = (window as unknown as Record<string, CtxMenu>).ctxmenu
  })

  afterEach(() => {
    ctxmenu?.hide()
    document.querySelectorAll('.ctxmenu').forEach((el) => el.remove())
  })

  it('positions menu at correct Y when body.offsetHeight is 0', () => {
    vi.spyOn(document.body, 'offsetHeight', 'get').mockReturnValue(0)
    vi.spyOn(document.body, 'offsetWidth', 'get').mockReturnValue(1312)
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, width: 1312, height: 0,
      top: 0, left: 0, bottom: 0, right: 1312,
      toJSON: () => {},
    })

    const clickX: number = 500
    const clickY: number = 350
    const syntheticEvent: MouseEvent = new MouseEvent('contextmenu', {
      clientX: clickX,
      clientY: clickY,
      bubbles: true,
      cancelable: true,
    })

    ctxmenu.show([{ text: 'Test Item' }], syntheticEvent)

    const menu: HTMLElement = document.querySelector('.ctxmenu') as HTMLElement
    expect(menu).not.toBeNull()

    const top: number = parseFloat(menu.style.top)
    expect(top).toBe(clickY)
  })
})
