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

// Which screen-delta axis component grows each dimension. Expanded folders use
// centered bias, so dragging either horizontal edge changes width and either
// vertical edge changes height; the sign points the grip "outward".
const WIDTH_SIGN: Record<ResizeHandle, number> = { e: 1, se: 1, ne: 1, w: -1, sw: -1, nw: -1, n: 0, s: 0 }
const HEIGHT_SIGN: Record<ResizeHandle, number> = { s: 1, se: 1, sw: 1, n: -1, ne: -1, nw: -1, e: 0, w: 0 }

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
