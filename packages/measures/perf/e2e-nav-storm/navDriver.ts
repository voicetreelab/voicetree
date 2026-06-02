/**
 * Foreground navigation driver for e2e-nav-storm.
 *
 * Drives the REAL production gesture path, not a bypass:
 *  - zoom   → ctrl+wheel over the canvas (CDP Input.dispatchMouseEvent
 *             mouseWheel, modifiers=Ctrl) → NavigationGestureService.onWheel's
 *             ctrlKey branch (zoomAtCursor).
 *  - pan    → middle-mouse drag → NavigationGestureService middle-button pan.
 *  - select → left click on a node → cytoscape `tap` → select.
 *  - expand → double click on a folder node → cytoscape `dbltap` on
 *             `node[?isFolderNode]` (setupBasicCytoscapeEventListeners) → folder
 *             collapse/expand toggle.
 *  - fit    → cy.fit(nodes, padding) — the production fit operation the fit
 *             control calls.
 *
 * NavigationGestureService exposes no public drive API (pan/zoom are private DOM
 * wheel/mouse handlers), so the only honest way to exercise it is real DOM input
 * — which is exactly what CDP/Playwright dispatch. Each gesture is bracketed by
 * `window.__vtPerfProbe__.mark(kind, …)` so it becomes a span on the timeline,
 * letting jank be attributed to the gesture that caused it.
 *
 * Impure shell: owns a CDP session + Playwright input + clock.
 */
import type { Page } from '@playwright/test'

export type InteractionKind = 'pan' | 'zoom' | 'select' | 'expand' | 'fit'

interface CdpInput {
    send(method: string, params?: Record<string, unknown>): Promise<unknown>
}

interface PagePoint {
    readonly x: number
    readonly y: number
}

export interface NavLoopInputs {
    readonly appWindow: Page
    readonly durationMs: number
    readonly actionIntervalMs: number
}

export interface NavLoopResult {
    readonly totalActions: number
    readonly actionsByKind: Readonly<Record<InteractionKind, number>>
    /** Kinds that could not be driven this run (e.g. no folder node visible). */
    readonly skippedKinds: readonly string[]
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Page-coordinate centre of the cytoscape canvas container. */
async function canvasCenter(appWindow: Page): Promise<PagePoint> {
    return appWindow.evaluate(() => {
        const cy = window.cytoscapeInstance
        const container = cy?.container()
        const rect = container?.getBoundingClientRect()
        if (!rect) return { x: 600, y: 400 }
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    })
}

/** Page point of a node matching `selector`, preferring one inside the viewport. */
async function pickNodePagePoint(appWindow: Page, selector: string): Promise<PagePoint | null> {
    return appWindow.evaluate((sel) => {
        const cy = window.cytoscapeInstance
        if (!cy) return null
        const container = cy.container()
        const rect = container?.getBoundingClientRect()
        if (!rect) return null
        const matches = cy.nodes(sel)
        if (matches.length === 0) return null
        // Prefer a node whose rendered position is within the visible canvas.
        const inView = matches.filter((n: { renderedPosition: () => { x: number; y: number } }) => {
            const rp = n.renderedPosition()
            return rp.x >= 0 && rp.x <= rect.width && rp.y >= 0 && rp.y <= rect.height
        })
        const chosen = (inView.length > 0 ? inView : matches)[0]
        const rp = chosen.renderedPosition()
        return { x: rect.left + rp.x, y: rect.top + rp.y }
    }, selector)
}

async function mark(appWindow: Page, kind: InteractionKind, phase: 'start' | 'end'): Promise<void> {
    await appWindow.evaluate(({ k, p }) => {
        window.__vtPerfProbe__?.mark(k as 'pan' | 'zoom' | 'select' | 'expand' | 'fit', p as 'start' | 'end')
    }, { k: kind, p: phase })
}

async function driveZoom(appWindow: Page, cdp: CdpInput, center: PagePoint, deltaY: number): Promise<void> {
    // Ctrl modifier (bit 2) makes onWheel take its zoom branch regardless of
    // device classification — the same path a trackpad pinch produces.
    for (let i = 0; i < 4; i++) {
        await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel', x: center.x, y: center.y, deltaX: 0, deltaY, modifiers: 2,
        })
        await sleep(30)
    }
}

async function drivePan(appWindow: Page, center: PagePoint): Promise<void> {
    // Middle-button drag is NavigationGestureService's mouse-pan gesture.
    await appWindow.mouse.move(center.x, center.y)
    await appWindow.mouse.down({ button: 'middle' })
    await appWindow.mouse.move(center.x - 140, center.y - 90, { steps: 12 })
    await appWindow.mouse.up({ button: 'middle' })
}

async function driveSelect(appWindow: Page): Promise<boolean> {
    const point = await pickNodePagePoint(appWindow, 'node[!isFolderNode]')
    if (!point) return false
    await appWindow.mouse.click(point.x, point.y)
    return true
}

async function driveExpand(appWindow: Page): Promise<boolean> {
    const point = await pickNodePagePoint(appWindow, 'node[?isFolderNode]')
    if (!point) return false
    await appWindow.mouse.dblclick(point.x, point.y)
    return true
}

async function driveFit(appWindow: Page): Promise<void> {
    await appWindow.evaluate(() => {
        const cy = window.cytoscapeInstance
        if (cy) cy.fit(cy.nodes(), 50)
    })
}

/**
 * Run the measured navigation loop for `durationMs`, cycling pan → zoom →
 * select → expand → fit at `actionIntervalMs` cadence. Each action is marked on
 * the renderer perf probe so frame jank can be attributed to it.
 */
export async function driveNavLoop(inputs: NavLoopInputs): Promise<NavLoopResult> {
    const { appWindow, durationMs, actionIntervalMs } = inputs
    const cdp = await appWindow.context().newCDPSession(appWindow) as unknown as CdpInput

    const counts: Record<InteractionKind, number> = { pan: 0, zoom: 0, select: 0, expand: 0, fit: 0 }
    const skipped = new Set<string>()
    const center = await canvasCenter(appWindow)

    const sequence: InteractionKind[] = ['pan', 'zoom', 'select', 'expand', 'fit']
    const deadline = Date.now() + durationMs
    let i = 0
    let zoomDirection = -1

    while (Date.now() < deadline) {
        const kind = sequence[i % sequence.length]!
        i += 1
        await mark(appWindow, kind, 'start')
        let drove = true
        switch (kind) {
            case 'pan': await drivePan(appWindow, center); break
            case 'zoom': await driveZoom(appWindow, cdp, center, 120 * zoomDirection); zoomDirection *= -1; break
            case 'select': drove = await driveSelect(appWindow); break
            case 'expand': drove = await driveExpand(appWindow); break
            case 'fit': await driveFit(appWindow); break
        }
        await mark(appWindow, kind, 'end')
        if (drove) counts[kind] += 1
        else skipped.add(kind)
        await sleep(actionIntervalMs)
    }

    const totalActions = counts.pan + counts.zoom + counts.select + counts.expand + counts.fit
    return { totalActions, actionsByKind: counts, skippedKinds: [...skipped] }
}
