// Mockup stub for the real HoverEditor + AnchoredEditor pair.
//
// Production path (webapp/src/shell/edge/UI-edge/floating-windows/editors/):
//   HoverEditor.ts    → setupCommandHover(cy)        // mouseover → transient editor
//   AnchoredEditor.ts → createAnchoredFloatingEditor // click/dblclick → pinned editor
// Those modules require window.electronAPI (loadSettings, getNodeFromMainToUI,
// getGraph), CodeMirror, fp-ts, and the shadow-node anchoring machinery — none
// of which can run in a vite-only browser sandbox.
//
// This file recreates the same UX with a pure-DOM panel that pins to a node's
// rendered position. Hover = transient (closes when the cursor leaves the
// node + editor zone). Click = anchored (persists until clicked again).
// Identical event surface to production: mouseover, tap, pan/zoom/position.

import type {Core, NodeSingular, EventObject} from 'cytoscape'

type EditorMode = 'hover' | 'anchored'

interface EditorEntry {
    nodeId: string
    mode: EditorMode
    el: HTMLDivElement
    mouseLeaveHandler: ((e: MouseEvent) => void) | null
}

// Map from nodeId → editor entry. One editor per node max (matches production
// EditorStore.getEditorByNodeId early-return).
const editors: Map<string, EditorEntry> = new Map()

const HOVER_VERTICAL_OFFSET: number = 14
const HOVER_CLOSE_DELAY_MS: number = 120

function placeholderContent(nodeId: string, label: string, isFolder: boolean, isCollapsed: boolean): string {
    if (isFolder) {
        const kind: string = isCollapsed ? 'collapsed folder pill' : 'expanded folder body'
        return `# ${label}\n\nFolder note for \`${nodeId}/\` (${kind}).\n\nIn production this resolves via \`getFolderNotePath(graph, nodeId)\` to the folder's index markdown. The mockup just shows this placeholder.`
    }
    return `# ${label}\n\nSample content for \`${nodeId}\`. This panel is a stub of the real CodeMirror editor — edits don't persist.\n\n- hover to preview\n- click to anchor`
}

function fileTitle(nodeId: string, isFolder: boolean): string {
    if (isFolder) return `${nodeId}/index.md  ·  (folder note)`
    return nodeId
}

function buildEditorEl(nodeId: string, label: string, isFolder: boolean, isCollapsed: boolean): HTMLDivElement {
    const el: HTMLDivElement = document.createElement('div')
    el.className = 'vt-mockup-editor'
    el.dataset.nodeId = nodeId

    const titlebar: HTMLDivElement = document.createElement('div')
    titlebar.className = 'vt-mockup-editor__titlebar'
    const title: HTMLSpanElement = document.createElement('span')
    title.className = 'vt-mockup-editor__title'
    title.textContent = fileTitle(nodeId, isFolder)
    const badge: HTMLSpanElement = document.createElement('span')
    badge.className = 'vt-mockup-editor__badge'
    badge.textContent = 'hover'
    titlebar.appendChild(title)
    titlebar.appendChild(badge)

    const body: HTMLTextAreaElement = document.createElement('textarea')
    body.className = 'vt-mockup-editor__body'
    body.value = placeholderContent(nodeId, label, isFolder, isCollapsed)
    body.spellcheck = false

    el.appendChild(titlebar)
    el.appendChild(body)
    return el
}

function positionEditor(cy: Core, host: HTMLElement, entry: EditorEntry): void {
    const node = cy.getElementById(entry.nodeId)
    if (node.length === 0) {
        closeEditor(entry.nodeId)
        return
    }
    const bbox = node.renderedBoundingBox()
    const hostRect: DOMRect = host.getBoundingClientRect()
    // Anchor below the node's rendered bottom, centered on its X midpoint.
    // bbox is relative to the cy container (== host in our setup).
    const x: number = (bbox.x1 + bbox.x2) / 2
    const y: number = bbox.y2 + HOVER_VERTICAL_OFFSET
    entry.el.style.left = `${x}px`
    entry.el.style.top = `${y}px`
    // Don't let the editor escape the canvas-host bounds horizontally.
    const elWidth: number = entry.el.offsetWidth
    if (elWidth > 0) {
        const halfW: number = elWidth / 2
        const minX: number = halfW + 4
        const maxX: number = hostRect.width - halfW - 4
        const clamped: number = Math.max(minX, Math.min(maxX, x))
        entry.el.style.left = `${clamped}px`
    }
}

function repositionAll(cy: Core, host: HTMLElement): void {
    editors.forEach((entry) => positionEditor(cy, host, entry))
}

function closeEditor(nodeId: string): void {
    const entry: EditorEntry | undefined = editors.get(nodeId)
    if (!entry) return
    if (entry.mouseLeaveHandler) {
        entry.el.removeEventListener('mouseleave', entry.mouseLeaveHandler)
    }
    entry.el.remove()
    editors.delete(nodeId)
}

function closeAllHoverEditors(): void {
    // Production HoverEditor.closeHoverEditor — only closes the unanchored one.
    editors.forEach((entry, nodeId) => {
        if (entry.mode === 'hover') closeEditor(nodeId)
    })
}

function setMode(entry: EditorEntry, mode: EditorMode): void {
    entry.mode = mode
    entry.el.classList.toggle('vt-mockup-editor--anchored', mode === 'anchored')
    const badge: HTMLElement | null = entry.el.querySelector('.vt-mockup-editor__badge')
    if (badge) badge.textContent = mode
}

function isPointInsideEditor(entry: EditorEntry, x: number, y: number): boolean {
    const r: DOMRect = entry.el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
}

function isPointInsideNode(cy: Core, host: HTMLElement, nodeId: string, x: number, y: number): boolean {
    const node = cy.getElementById(nodeId)
    if (node.length === 0) return false
    const bbox = node.renderedBoundingBox()
    const hostRect: DOMRect = host.getBoundingClientRect()
    const nx1: number = hostRect.left + bbox.x1
    const nx2: number = hostRect.left + bbox.x2
    const ny1: number = hostRect.top + bbox.y1
    const ny2: number = hostRect.top + bbox.y2
    return x >= nx1 && x <= nx2 && y >= ny1 && y <= ny2
}

function openHoverEditor(cy: Core, host: HTMLElement, node: NodeSingular): void {
    const nodeId: string = node.id()
    // Already has an editor for this node — production early-returns the same way.
    if (editors.has(nodeId)) return

    // Hover is single-occupancy: close any other hover editor first.
    closeAllHoverEditors()

    const isFolder: boolean = node.data('isFolderNode') === true
    const isCollapsed: boolean = node.data('collapsed') === true
    const label: string = (node.data('folderLabel') as string | undefined) ?? (node.data('label') as string | undefined) ?? nodeId

    const el: HTMLDivElement = buildEditorEl(nodeId, label, isFolder, isCollapsed)
    host.appendChild(el)
    const entry: EditorEntry = {nodeId, mode: 'hover', el, mouseLeaveHandler: null}

    const handleMouseLeave: (e: MouseEvent) => void = (e: MouseEvent): void => {
        // Only close if mouse left the editor AND is not back over the source node.
        // Matches production isMouseInHoverZone semantics.
        window.setTimeout((): void => {
            const x: number = e.clientX
            const y: number = e.clientY
            if (entry.mode !== 'hover') return
            if (isPointInsideEditor(entry, x, y)) return
            if (isPointInsideNode(cy, host, nodeId, x, y)) return
            closeEditor(nodeId)
        }, HOVER_CLOSE_DELAY_MS)
    }
    entry.mouseLeaveHandler = handleMouseLeave
    el.addEventListener('mouseleave', handleMouseLeave)

    // Single-click on the editor body anchors it (matches double-click-to-pin in
    // production HoverEditor.ts L213 — we use single-click for snappier mockup feel).
    el.addEventListener('mousedown', (e: MouseEvent): void => {
        // Only anchor on titlebar click; let textarea clicks edit content.
        const target: HTMLElement = e.target as HTMLElement
        if (target.classList.contains('vt-mockup-editor__body')) return
        if (entry.mode === 'hover') setMode(entry, 'anchored')
    })

    editors.set(nodeId, entry)
    positionEditor(cy, host, entry)
}

function toggleAnchor(cy: Core, host: HTMLElement, node: NodeSingular): void {
    const nodeId: string = node.id()
    const existing: EditorEntry | undefined = editors.get(nodeId)
    if (existing) {
        if (existing.mode === 'anchored') {
            // Un-pin: close editor entirely.
            closeEditor(nodeId)
        } else {
            // Promote hover → anchored.
            setMode(existing, 'anchored')
        }
        return
    }
    // No editor yet — open one directly in anchored mode.
    openHoverEditor(cy, host, node)
    const entry: EditorEntry | undefined = editors.get(nodeId)
    if (entry) setMode(entry, 'anchored')
}

/**
 * Wire hover + anchored editors to a cytoscape instance.
 *
 * Hover:    mouseover any node → transient editor beneath it.
 * Anchor:   single-click any node (except a collapsed folder pill, which is
 *           reserved for the expand handler) → pin editor.
 * Position: tracks pan / zoom / node-move via cy events.
 *
 * Returns a teardown function — callers should invoke it before destroying cy.
 */
export function setupNodeEditors(cy: Core, host: HTMLElement): () => void {
    const onMouseover: (e: EventObject) => void = (e: EventObject): void => {
        const node: NodeSingular = e.target as NodeSingular
        // Skip collapsed folder pills on hover — they're tiny and tap expands them.
        // Hovering them spawns an editor that immediately gets orphaned when the
        // pill node is removed during rebuild. Production avoids this too:
        // HoverEditor calls getFolderNotePath() which fails for collapsed folders.
        if (node.data('isFolderNode') === true && node.data('collapsed') === true) return
        openHoverEditor(cy, host, node)
    }

    const onTap: (e: EventObject) => void = (e: EventObject): void => {
        const node: NodeSingular = e.target as NodeSingular
        // Collapsed pill taps belong to the expand path — don't anchor.
        if (node.data('isFolderNode') === true && node.data('collapsed') === true) return
        toggleAnchor(cy, host, node)
    }

    // Defer repositioning to the next animation frame. Reading
    // renderedBoundingBox() inside the cy `render` event re-entered cytoscape's
    // label/bounds pipeline and stack-overflowed at BRp.getLabelText. rAF moves
    // our reads to AFTER cy commits the frame, breaking the cycle. Same trick
    // FolderHandleService.positionChip uses for its compound-bounds reads.
    let rafId: number = 0
    const onReposition: () => void = (): void => {
        if (rafId !== 0) return
        rafId = window.requestAnimationFrame((): void => {
            rafId = 0
            repositionAll(cy, host)
        })
    }

    cy.on('mouseover', 'node', onMouseover)
    cy.on('tap', 'node', onTap)
    cy.on('pan zoom', onReposition)
    cy.on('position', 'node', onReposition)

    // Click on the cy background closes hover editors (anchored ones stay).
    cy.on('tap', (e: EventObject): void => {
        if (e.target === cy) closeAllHoverEditors()
    })

    return (): void => {
        cy.off('mouseover', 'node', onMouseover)
        cy.off('tap', 'node', onTap)
        cy.off('pan zoom', onReposition)
        cy.off('position', 'node', onReposition)
        if (rafId !== 0) window.cancelAnimationFrame(rafId)
        editors.forEach((_, nodeId) => closeEditor(nodeId))
    }
}

/**
 * Close every editor — call before tearing down / rebuilding cy.
 */
export function closeAllNodeEditors(): void {
    editors.forEach((_, nodeId) => closeEditor(nodeId))
}
