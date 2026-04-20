import { describe, expect, it, vi, beforeEach } from 'vitest'

const layoutStoreMocks = vi.hoisted(() => ({
    dispatchSetZoom: vi.fn(),
    dispatchSetPan: vi.fn(),
    dispatchRequestFit: vi.fn(),
    flushLayout: vi.fn(),
}))

vi.mock('@vt/graph-state/state/layoutStore', () => ({
    dispatchSetZoom: layoutStoreMocks.dispatchSetZoom,
    dispatchSetPan: layoutStoreMocks.dispatchSetPan,
    dispatchRequestFit: layoutStoreMocks.dispatchRequestFit,
    flushLayout: layoutStoreMocks.flushLayout,
}))

import { applyLiveCommandToRenderer } from '@/shell/edge/UI-edge/graph/applyLiveCommandToRenderer'

describe('applyLiveCommandToRenderer layout commands', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('mirrors SetZoom into layoutStore and flushes synchronously', async () => {
        await applyLiveCommandToRenderer({ type: 'SetZoom', zoom: 1.45 })

        expect(layoutStoreMocks.dispatchSetZoom).toHaveBeenCalledWith(1.45)
        expect(layoutStoreMocks.flushLayout).toHaveBeenCalledOnce()
    })

    it('mirrors SetPan into layoutStore and flushes synchronously', async () => {
        await applyLiveCommandToRenderer({ type: 'SetPan', pan: { x: 180, y: -90 } })

        expect(layoutStoreMocks.dispatchSetPan).toHaveBeenCalledWith({ x: 180, y: -90 })
        expect(layoutStoreMocks.flushLayout).toHaveBeenCalledOnce()
    })

    it('mirrors RequestFit into layoutStore and flushes synchronously', async () => {
        await applyLiveCommandToRenderer({ type: 'RequestFit', paddingPx: 32 })

        expect(layoutStoreMocks.dispatchRequestFit).toHaveBeenCalledWith(32)
        expect(layoutStoreMocks.flushLayout).toHaveBeenCalledOnce()
    })
})
