/**
 * Polyomino grid primitives for shape-aware component separation.
 *
 * Provides a flat 2D grid (Uint16Array + generation counter) with:
 *  - O(1) resets via generation-counter pattern (no memset on reset)
 *  - Component rasterization: nodes + edges bounding boxes → absolute grid cells
 *  - Nearest-free-position search sorted by Manhattan distance
 *
 * Design: CellSet cells are in absolute grid coordinates (col/row relative to
 * the grid's world-space origin). polyominoFitsAt / bfsNearestFree take an
 * (offsetCol, offsetRow) delta — enabling probing alternate placements
 * without re-rasterizing.
 *
 * No Cytoscape dependency. No classes. All TypeScript types explicit.
 * The grid is the only mutable state and is always passed in explicitly.
 */

// ============================================================================
// Types
// ============================================================================

export type PolyominoGrid = {
    readonly cells: Uint16Array // Uint16Array contents mutated by stamp/clear/reset via method calls
    readonly width: number
    readonly height: number
    // eslint-disable-next-line functional/prefer-readonly-type -- generation is intentionally mutable (O(1) reset pattern)
    generation: number
}

/**
 * Set of absolute grid cells (col = x-axis index, row = y-axis index).
 * Produced by rasterizeComponent; consumed by stamp/clear/fits/bfsNearestFree.
 * Duplicate cells are allowed and handled correctly by all consumers.
 */
export type CellSet = readonly { readonly col: number; readonly row: number }[]

// ============================================================================
// Grid lifecycle
// ============================================================================

/**
 * Allocate a zeroed grid of (widthCells × heightCells) cells.
 * Generation starts at 1. A cell is "occupied" iff cells[idx] === generation.
 * Generation 0 is reserved: clearCells writes 0 to "unoccupy" individual cells.
 */
export function createGrid(widthCells: number, heightCells: number): PolyominoGrid {
    return {
        cells: new Uint16Array(widthCells * heightCells),
        width: widthCells,
        height: heightCells,
        generation: 1,
    }
}

/**
 * Mark all cells as empty in O(1) by incrementing the generation counter.
 * Any cell with cells[idx] < generation is implicitly empty.
 *
 * Safety: if generation reaches Uint16Array max (65535), zeros the backing
 * array and resets to 1 — prevents integer wraparound false-positives.
 */
export function resetGrid(grid: PolyominoGrid): void {
    if (grid.generation >= 65535) {
        grid.cells.fill(0) // method call — not flagged by no-param-reassign
        // eslint-disable-next-line no-param-reassign -- intentional O(1) reset via generation counter
        grid.generation = 1
    } else {
        // eslint-disable-next-line no-param-reassign -- intentional O(1) reset via generation counter
        grid.generation++
    }
}

// ============================================================================
// Rasterization
// ============================================================================

/**
 * Produce the set of absolute grid cells occupied by a component's geometry.
 *
 * For each node: rasterizes its axis-aligned bounding box into grid cells.
 * For each edge: rasterizes the bounding box of its start/end endpoints.
 * Node x,y = center (cytoscape convention); edge coords = absolute world-space.
 *
 * Cells may contain duplicates (where node and edge bboxes overlap) —
 * all consumers handle this correctly.
 *
 * @param nodes    - Nodes with center (x,y) and dimensions (width, height).
 * @param edges    - Edges with absolute start/end world-space coordinates.
 * @param gridStep - World pixels per grid cell (e.g. 80px).
 * @param originX  - World X of grid cell (0,0) — typically union-bbox minX.
 * @param originY  - World Y of grid cell (0,0) — typically union-bbox minY.
 */
export function rasterizeComponent(
    nodes: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[],
    edges: readonly { readonly startX: number; readonly startY: number; readonly endX: number; readonly endY: number }[],
    gridStep: number,
    originX: number,
    originY: number,
): CellSet {
    // Nested function declaration (not a const arrow) avoids @typescript-eslint/typedef.
    // Closes over gridStep / originX / originY from outer scope.
    function rasterizeRect(
        worldMinX: number,
        worldMinY: number,
        worldMaxX: number,
        worldMaxY: number,
    ): CellSet {
        const colMin: number = Math.floor((worldMinX - originX) / gridStep)
        const rowMin: number = Math.floor((worldMinY - originY) / gridStep)
        const colMax: number = Math.floor((worldMaxX - originX) / gridStep)
        const rowMax: number = Math.floor((worldMaxY - originY) / gridStep)
        const cols: number = colMax - colMin + 1
        const rows: number = rowMax - rowMin + 1
        return Array.from(
            { length: rows * cols },
            (_: unknown, i: number): { readonly col: number; readonly row: number } => ({
                col: (i % cols) + colMin,
                row: Math.floor(i / cols) + rowMin,
            }),
        )
    }

    return [
        ...nodes.flatMap(
            (n: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): CellSet => {
                const hw: number = n.width / 2
                const hh: number = n.height / 2
                return rasterizeRect(n.x - hw, n.y - hh, n.x + hw, n.y + hh)
            },
        ),
        ...edges.flatMap(
            (e: { readonly startX: number; readonly startY: number; readonly endX: number; readonly endY: number }): CellSet =>
                rasterizeRect(
                    Math.min(e.startX, e.endX),
                    Math.min(e.startY, e.endY),
                    Math.max(e.startX, e.endX),
                    Math.max(e.startY, e.endY),
                ),
        ),
    ]
}

// ============================================================================
// Grid stamping
// ============================================================================

/**
 * Mark cells as occupied by writing the current generation value.
 * Uses TypedArray.fill(v, start, end) — a method call, not an element assignment —
 * to satisfy no-param-reassign without needing eslint-disable.
 * Out-of-bounds cells are silently skipped.
 */
export function stampCells(grid: PolyominoGrid, cells: CellSet): void {
    cells.forEach(({ col, row }: { readonly col: number; readonly row: number }): void => {
        if (col >= 0 && col < grid.width && row >= 0 && row < grid.height) {
            const idx: number = row * grid.width + col
            grid.cells.fill(grid.generation, idx, idx + 1)
        }
    })
}

/**
 * Unmark cells by writing 0 (generation is always ≥ 1, so 0 means "empty").
 * Out-of-bounds cells are silently skipped.
 */
export function clearCells(grid: PolyominoGrid, cells: CellSet): void {
    cells.forEach(({ col, row }: { readonly col: number; readonly row: number }): void => {
        if (col >= 0 && col < grid.width && row >= 0 && row < grid.height) {
            const idx: number = row * grid.width + col
            grid.cells.fill(0, idx, idx + 1)
        }
    })
}

// ============================================================================
// Collision check
// ============================================================================

/**
 * Check whether the polyomino, shifted by (offsetCol, offsetRow), fits on the grid.
 * Returns true iff ALL shifted cells are within grid bounds AND unoccupied.
 * Returns true vacuously for an empty polyomino.
 */
export function polyominoFitsAt(
    grid: PolyominoGrid,
    polyomino: CellSet,
    offsetCol: number,
    offsetRow: number,
): boolean {
    return polyomino.every(({ col, row }: { readonly col: number; readonly row: number }): boolean => {
        const c: number = col + offsetCol
        const r: number = row + offsetRow
        return c >= 0 && c < grid.width && r >= 0 && r < grid.height
            && grid.cells[r * grid.width + c] !== grid.generation
    })
}

// ============================================================================
// Nearest-free search
// ============================================================================

/** Internal candidate type for bfsNearestFree. */
type BfsCandidate = { readonly col: number; readonly row: number; readonly dist: number }

/**
 * Find the nearest offset position where the polyomino fits, by Manhattan distance.
 *
 * Generates all candidate offsets in the (2*maxRadius+1)² square, filters to
 * those within Manhattan distance ≤ maxRadius, sorts ascending by distance, then
 * finds the first offset where polyominoFitsAt returns true. This is semantically
 * equivalent to BFS (finds the nearest-by-Manhattan-distance free position) but
 * implemented with Array.from + sort + find to satisfy functional lint rules.
 *
 * Returns null if no position within maxRadius fits.
 *
 * @param startCol  - Starting offset column (0 = component's current grid position).
 * @param startRow  - Starting offset row.
 * @param maxRadius - Max Manhattan distance from start. Bounds search to O(maxRadius²).
 */
export function bfsNearestFree(
    grid: PolyominoGrid,
    polyomino: CellSet,
    startCol: number,
    startRow: number,
    maxRadius: number,
): { readonly col: number; readonly row: number } | null {
    const side: number = 2 * maxRadius + 1
    const candidate: BfsCandidate | undefined = Array.from(
        { length: side * side },
        (_: unknown, i: number): BfsCandidate => {
            const dc: number = (i % side) - maxRadius
            const dr: number = Math.floor(i / side) - maxRadius
            return { col: startCol + dc, row: startRow + dr, dist: Math.abs(dc) + Math.abs(dr) }
        },
    )
        .filter(({ dist }: BfsCandidate): boolean => dist <= maxRadius)
        .sort((a: BfsCandidate, b: BfsCandidate): number => a.dist - b.dist)
        .find(({ col, row }: BfsCandidate): boolean => polyominoFitsAt(grid, polyomino, col, row))

    return candidate !== undefined ? { col: candidate.col, row: candidate.row } : null
}
