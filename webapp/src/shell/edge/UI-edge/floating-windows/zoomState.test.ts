import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isZoomActive, markZoomActive, onZoomEnd } from './cytoscape-floating-windows'

// The implementation uses ZOOM_ACTIVE_MS = 250ms
const ZOOM_ACTIVE_MS: number = 250
// Zoom-end callbacks fire after 100ms debounce
const ZOOM_END_DEBOUNCE_MS: number = 100

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

    describe('onZoomEnd', () => {
        it('calls registered callback after 100ms debounce when zoom ends', () => {
            const callback = vi.fn()
            onZoomEnd(callback)

            markZoomActive()

            // Callback not called immediately
            expect(callback).not.toHaveBeenCalled()

            // Callback still not called before debounce period
            vi.advanceTimersByTime(50)
            expect(callback).not.toHaveBeenCalled()

            // Callback called after 100ms debounce
            vi.advanceTimersByTime(50)
            expect(callback).toHaveBeenCalledTimes(1)
        })

        it('debounces rapid zoom events - callback fires once after last zoom', () => {
            const callback = vi.fn()
            onZoomEnd(callback)

            // Simulate rapid zooming
            markZoomActive()
            vi.advanceTimersByTime(50)
            markZoomActive() // Reset debounce
            vi.advanceTimersByTime(50)
            markZoomActive() // Reset debounce again
            vi.advanceTimersByTime(50)

            // Callback not called yet - debounce keeps resetting
            expect(callback).not.toHaveBeenCalled()

            // Wait for debounce to complete
            vi.advanceTimersByTime(ZOOM_END_DEBOUNCE_MS)
            expect(callback).toHaveBeenCalledTimes(1)
        })

        it('unsubscribe function removes callback', () => {
            const callback = vi.fn()
            const unsubscribe = onZoomEnd(callback)

            // Unsubscribe before zoom
            unsubscribe()

            markZoomActive()
            vi.advanceTimersByTime(ZOOM_END_DEBOUNCE_MS)

            // Callback should not be called since we unsubscribed
            expect(callback).not.toHaveBeenCalled()
        })

        it('calls multiple registered callbacks', () => {
            const callback1 = vi.fn()
            const callback2 = vi.fn()
            onZoomEnd(callback1)
            onZoomEnd(callback2)

            markZoomActive()
            vi.advanceTimersByTime(ZOOM_END_DEBOUNCE_MS)

            expect(callback1).toHaveBeenCalledTimes(1)
            expect(callback2).toHaveBeenCalledTimes(1)
        })
    })
})
