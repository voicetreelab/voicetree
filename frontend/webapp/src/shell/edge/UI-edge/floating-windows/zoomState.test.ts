import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isZoomActive, markZoomActive } from './cytoscape-floating-windows'

// The implementation uses ZOOM_ACTIVE_MS = 250ms
const ZOOM_ACTIVE_MS: number = 250

describe('zoomState', () => {
    beforeEach(() => {
        // Enable fake timers with Date mocking so Date.now() advances with timers
        vi.useFakeTimers({ shouldAdvanceTime: false })
        vi.setSystemTime(new Date(0))
    })

    afterEach(() => {
        vi.useRealTimers()
    })

    describe('isZoomActive', () => {
        it('returns true immediately after markZoomActive is called', () => {
            markZoomActive()

            expect(isZoomActive()).toBe(true)
        })

        it('returns true before 250ms has elapsed', () => {
            markZoomActive()

            vi.advanceTimersByTime(200)

            expect(isZoomActive()).toBe(true)
        })

        it('returns false after 250ms has elapsed', () => {
            markZoomActive()

            vi.advanceTimersByTime(ZOOM_ACTIVE_MS)

            expect(isZoomActive()).toBe(false)
        })

        it('returns false after initial state (no recent zoom)', () => {
            // Advance time well past any previous zoom activity
            vi.advanceTimersByTime(1000)

            expect(isZoomActive()).toBe(false)
        })

        it('extends the active window when markZoomActive is called again', () => {
            markZoomActive()
            vi.advanceTimersByTime(150)

            // Zoom is still active (150ms < 250ms)
            expect(isZoomActive()).toBe(true)

            // Call markZoomActive again - should extend the window
            markZoomActive()
            vi.advanceTimersByTime(150)

            // Still active because we extended (window restarted at 150ms, now at 150ms into new window)
            expect(isZoomActive()).toBe(true)

            // Advance past the new 250ms window
            vi.advanceTimersByTime(150)

            expect(isZoomActive()).toBe(false)
        })
    })
})
