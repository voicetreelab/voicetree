import { describe, it, expect } from 'vitest'
import {
    computeResizedFolderSize,
    resizeBiasForHandle,
    MIN_FOLDER_WIDTH,
    MIN_FOLDER_HEIGHT,
    type ResizeHandle,
} from './folderResize'

const START = { width: 200, height: 150 }

describe('computeResizedFolderSize', () => {
    it('grows width dragging the east edge right (converted to graph units by zoom)', () => {
        const r = computeResizedFolderSize(START, { dx: 100, dy: 0 }, 'e', 2)
        // 100 screen px / zoom 2 = 50 graph units
        expect(r).toEqual({ width: 250, height: 150 })
    })

    it('grows width dragging the west edge left (negative dx, negative sign)', () => {
        const r = computeResizedFolderSize(START, { dx: -60, dy: 0 }, 'w', 1)
        expect(r).toEqual({ width: 260, height: 150 })
    })

    it('grows height dragging the south edge down', () => {
        const r = computeResizedFolderSize(START, { dx: 0, dy: 40 }, 's', 1)
        expect(r).toEqual({ width: 200, height: 190 })
    })

    it('grows height dragging the north edge up', () => {
        const r = computeResizedFolderSize(START, { dx: 0, dy: -40 }, 'n', 1)
        expect(r).toEqual({ width: 200, height: 190 })
    })

    it('changes both dimensions for a corner grip', () => {
        const r = computeResizedFolderSize(START, { dx: 30, dy: 20 }, 'se', 1)
        expect(r).toEqual({ width: 230, height: 170 })
    })

    it('leaves the off-axis dimension untouched for an edge grip', () => {
        const r = computeResizedFolderSize(START, { dx: 50, dy: 50 }, 'e', 1)
        expect(r.height).toBe(150)
    })

    it('clamps to the minimum size when shrinking past it', () => {
        const r = computeResizedFolderSize(START, { dx: -1000, dy: -1000 }, 'se', 1)
        expect(r).toEqual({ width: MIN_FOLDER_WIDTH, height: MIN_FOLDER_HEIGHT })
    })

    it('treats a zero/invalid zoom as 1 (no divide-by-zero)', () => {
        const r = computeResizedFolderSize(START, { dx: 10, dy: 0 }, 'e', 0)
        expect(r.width).toBe(210)
    })

    it('respects a custom minimum', () => {
        const r = computeResizedFolderSize(START, { dx: -1000, dy: 0 }, 'e', 1, { width: 175, height: 50 })
        expect(r.width).toBe(175)
    })

    it('every handle keeps both dimensions at or above the minimum', () => {
        const handles: readonly ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
        for (const h of handles) {
            const r = computeResizedFolderSize(START, { dx: -9999, dy: -9999 }, h, 1)
            expect(r.width).toBeGreaterThanOrEqual(MIN_FOLDER_WIDTH)
            expect(r.height).toBeGreaterThanOrEqual(MIN_FOLDER_HEIGHT)
        }
    })
})

describe('resizeBiasForHandle', () => {
    it('puts all width slack on the right (left edge pinned) when dragging east', () => {
        expect(resizeBiasForHandle('e')).toEqual({
            'min-width-bias-left': 0,
            'min-width-bias-right': 1,
        })
    })

    it('puts all width slack on the left (right edge pinned) when dragging west', () => {
        expect(resizeBiasForHandle('w')).toEqual({
            'min-width-bias-left': 1,
            'min-width-bias-right': 0,
        })
    })

    it('puts all height slack on the bottom (top edge pinned) when dragging south', () => {
        expect(resizeBiasForHandle('s')).toEqual({
            'min-height-bias-top': 0,
            'min-height-bias-bottom': 1,
        })
    })

    it('puts all height slack on the top (bottom edge pinned) when dragging north', () => {
        expect(resizeBiasForHandle('n')).toEqual({
            'min-height-bias-top': 1,
            'min-height-bias-bottom': 0,
        })
    })

    it('biases both axes toward the dragged corner (se → bottom-right grows, top-left pinned)', () => {
        expect(resizeBiasForHandle('se')).toEqual({
            'min-width-bias-left': 0,
            'min-width-bias-right': 1,
            'min-height-bias-top': 0,
            'min-height-bias-bottom': 1,
        })
    })

    it('biases both axes toward the dragged corner (nw → top-left grows, bottom-right pinned)', () => {
        expect(resizeBiasForHandle('nw')).toEqual({
            'min-width-bias-left': 1,
            'min-width-bias-right': 0,
            'min-height-bias-top': 1,
            'min-height-bias-bottom': 0,
        })
    })

    it('omits the off-axis so an edge drag never disturbs the other axis bias', () => {
        // East drag must not touch the vertical bias, north drag the horizontal.
        expect(resizeBiasForHandle('e')).not.toHaveProperty('min-height-bias-top')
        expect(resizeBiasForHandle('e')).not.toHaveProperty('min-height-bias-bottom')
        expect(resizeBiasForHandle('n')).not.toHaveProperty('min-width-bias-left')
        expect(resizeBiasForHandle('n')).not.toHaveProperty('min-width-bias-right')
    })
})
