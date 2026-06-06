import type { Size } from '@vt/graph-model/graph'

/**
 * Pure resize math for folder grips. The DOM wiring in FolderHandleService is a
 * thin shell over this: it captures the start size + pointer, and on each move
 * asks for the new size.
 */

/** Eight grips: four edges + four corners. */
export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const ALL_RESIZE_HANDLES: readonly ResizeHandle[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

// Minimum folder dimensions in graph units. Large enough to keep the chip strip
// (44×22) and a label legible; the children bbox is a separate, dynamic floor
// enforced by cytoscape itself.
export const MIN_FOLDER_WIDTH = 120
export const MIN_FOLDER_HEIGHT = 80

// Which screen-delta axis component grows each dimension, and which way the
// grip points "outward": +1 = east/south, -1 = west/north, 0 = the axis the
// grip does not touch. The sign also drives resizeBiasForHandle below, which
// anchors the opposite edge so the grip tracks the cursor 1:1.
const WIDTH_SIGN: Record<ResizeHandle, number> = { e: 1, se: 1, ne: 1, w: -1, sw: -1, nw: -1, n: 0, s: 0 }
const HEIGHT_SIGN: Record<ResizeHandle, number> = { s: 1, se: 1, sw: 1, n: -1, ne: -1, nw: -1, e: 0, w: 0 }

/**
 * Cytoscape compound min-* bias keyed by style-property name, for a grip drag.
 *
 * A compound folder has no size of its own — its box is its children's bbox
 * grown to the min-width / min-height floor. cytoscape's DEFAULT bias (0/0)
 * splits that slack evenly around the children, so dragging one edge moved it
 * only HALF the cursor distance (felt like lag) and slid the top-left corner —
 * detaching the chip strip (chevron + eye) pinned there.
 *
 * Biasing all the slack toward the dragged edge anchors the OPPOSITE edge: the
 * grip then tracks the pointer 1:1 and the un-dragged edges stay put. From
 * cytoscape bounds.mjs `update()`: pos.x = childrenCenter + (diffRight − diffLeft)/2,
 * so `left:0, right:1` pins x1 to the children's left and puts the whole slack
 * on the right (and symmetrically for the vertical axis).
 *
 * Only the axis the grip actually grows is returned; the off-axis is omitted so
 * an edge drag never disturbs the other axis's existing bias.
 */
export interface FolderResizeBias {
    readonly 'min-width-bias-left'?: number
    readonly 'min-width-bias-right'?: number
    readonly 'min-height-bias-top'?: number
    readonly 'min-height-bias-bottom'?: number
}

export function resizeBiasForHandle(handle: ResizeHandle): FolderResizeBias {
    const bias: {
        'min-width-bias-left'?: number
        'min-width-bias-right'?: number
        'min-height-bias-top'?: number
        'min-height-bias-bottom'?: number
    } = {}
    if (WIDTH_SIGN[handle] > 0) { bias['min-width-bias-left'] = 0; bias['min-width-bias-right'] = 1 }
    else if (WIDTH_SIGN[handle] < 0) { bias['min-width-bias-left'] = 1; bias['min-width-bias-right'] = 0 }
    if (HEIGHT_SIGN[handle] > 0) { bias['min-height-bias-top'] = 0; bias['min-height-bias-bottom'] = 1 }
    else if (HEIGHT_SIGN[handle] < 0) { bias['min-height-bias-top'] = 1; bias['min-height-bias-bottom'] = 0 }
    return bias
}

function clampMin(value: number, min: number): number {
    return value < min ? min : value
}

/**
 * Compute a folder's new size (graph units) from a grip drag.
 *
 * @param startSize  folder body size in graph units at drag start
 * @param screenDelta pointer movement in screen px since drag start
 * @param handle     which grip is being dragged
 * @param zoom       cy.zoom() — graph units = screen px / zoom
 * @param min        minimum size (defaults to MIN_FOLDER_*)
 */
export function computeResizedFolderSize(
    startSize: Size,
    screenDelta: { readonly dx: number; readonly dy: number },
    handle: ResizeHandle,
    zoom: number,
    min: Size = { width: MIN_FOLDER_WIDTH, height: MIN_FOLDER_HEIGHT },
): Size {
    const safeZoom: number = zoom > 0 ? zoom : 1
    const dxGraph: number = screenDelta.dx / safeZoom
    const dyGraph: number = screenDelta.dy / safeZoom
    return {
        width: clampMin(startSize.width + WIDTH_SIGN[handle] * dxGraph, min.width),
        height: clampMin(startSize.height + HEIGHT_SIGN[handle] * dyGraph, min.height),
    }
}
