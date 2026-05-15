// Run: cd webapp && npx vite --config mockups/folder-handle/vite.config.ts
// Then open: http://localhost:5175/
//
// Wires the REAL FolderHandleService + REAL getDefaultNodeStyles into a
// stand-alone cytoscape canvas. Only the folderCollapse module is aliased to
// a local stub (see ./stubs/folderCollapse.ts) — that's the one piece of the
// shipped path that requires Electron IPC.

import cytoscape, { type Core, type NodeSingular } from 'cytoscape'

import { setupFolderHandles } from '@/shell/UI/cytoscape-graph-ui/services/folder-handle/FolderHandleService'
import { getDefaultNodeStyles } from '@/shell/UI/cytoscape-graph-ui/services/styles/defaultNodeStyles'
import { getGraphColors } from '@/shell/UI/cytoscape-graph-ui/services/styles/themeColors'
// Same stub the vite-alias hands to FolderHandleService — so dbltap / pill-tap
// route through the identical path the chevron click does.
import { toggleFolderCollapse as toggleFolderCollapseRef } from '@/shell/edge/UI-edge/graph/view/folderCollapse'

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T

const container: HTMLDivElement = $<HTMLDivElement>('#cy')
const cursorReadout: HTMLDivElement = $<HTMLDivElement>('#cursor-readout')
const eventLog: HTMLDivElement = $<HTMLDivElement>('#event-log')
const resetBtn: HTMLButtonElement = $<HTMLButtonElement>('#reset-graph')
const themeBtn: HTMLButtonElement = $<HTMLButtonElement>('#toggle-theme')

let isDark: boolean = document.documentElement.classList.contains('dark')

// Folders that should boot collapsed. Mutated by the expand-rebuild hook so
// that re-rendering the cy instance preserves user collapse/expand state.
const collapsedFolderIds: Set<string> = new Set(['retros'])

function buildSampleGraph(): cytoscape.ElementDefinition[] {
    // Two sibling folders + a free leaf. Kept intentionally flat (no
    // folder-within-folder): the shipped FolderHandleService leans on the
    // daemon-async collapse flow to break up bounds-event re-entrancy that
    // nested folders trigger when descendants remove synchronously. The chip
    // behaviour itself (positioning, ungrabify, collapsed-pill swap, chevron
    // hover) is identical regardless of nesting depth, so the demo stays on
    // the lower-risk shape.
    const folderData = (id: string, label: string, childCount: number, extra: Record<string, unknown> = {}): Record<string, unknown> => {
        const collapsed: boolean = collapsedFolderIds.has(id)
        return collapsed
            ? { id, isFolderNode: true, folderLabel: label, collapsed: true, childCount, ...extra }
            : { id, isFolderNode: true, folderLabel: label, ...extra }
    }

    const elements: cytoscape.ElementDefinition[] = []
    elements.push({ data: folderData('notes', '/notes', 3) as cytoscape.NodeDataDefinition })
    if (!collapsedFolderIds.has('notes')) {
        elements.push({ data: { id: 'notes/architecture.md', parent: 'notes', label: 'architecture' }, position: { x: 220, y: 220 } })
        elements.push({ data: { id: 'notes/auth.md',          parent: 'notes', label: 'auth flow' },     position: { x: 400, y: 220 } })
        elements.push({ data: { id: 'notes/openq.md',         parent: 'notes', label: 'open questions' },position: { x: 310, y: 340 } })
    }

    elements.push({ data: folderData('diagrams', '/diagrams', 2) as cytoscape.NodeDataDefinition })
    if (!collapsedFolderIds.has('diagrams')) {
        elements.push({ data: { id: 'diagrams/system.md',   parent: 'diagrams', label: 'system' },    position: { x: 600, y: 230 } })
        elements.push({ data: { id: 'diagrams/sequence.md', parent: 'diagrams', label: 'sequence' }, position: { x: 720, y: 330 } })
    }

    elements.push({ data: folderData('retros', '/retros', 4) as cytoscape.NodeDataDefinition, position: { x: 880, y: 220 } })

    elements.push({ data: { id: 'inbox.md', label: 'inbox' }, position: { x: 110, y: 110 } })

    if (!collapsedFolderIds.has('notes') && !collapsedFolderIds.has('diagrams')) {
        elements.push({ data: { id: 'e1', source: 'notes/architecture.md', target: 'notes/auth.md' } })
        elements.push({ data: { id: 'e2', source: 'notes/auth.md',         target: 'diagrams/system.md' } })
    }
    return elements
}

function flashLog(msg: string): void {
    eventLog.textContent = msg
    eventLog.classList.add('show')
    window.clearTimeout((flashLog as unknown as { t?: number }).t)
    ;(flashLog as unknown as { t?: number }).t = window.setTimeout((): void => {
        eventLog.classList.remove('show')
    }, 1600)
}

function buildCy(): Core {
    const colors = getGraphColors(isDark)
    const cy: Core = cytoscape({
        container,
        elements: buildSampleGraph(),
        style: getDefaultNodeStyles(colors, 'Inter, system-ui, sans-serif', isDark) as cytoscape.StylesheetCSS[],
        layout: { name: 'preset' },
        wheelSensitivity: 0.2,
    })

    // Mirrors applyGraphDeltaToUI: expanded folders ungrabify, collapsed pills stay grabbable.
    // (Real source: webapp/src/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI.ts)
    cy.nodes('node[?isFolderNode]').forEach((n: NodeSingular): void => {
        if (n.data('collapsed') === true) n.grabify()
        else n.ungrabify()
    })
    cy.on('add', 'node[?isFolderNode]', (evt): void => {
        const n: NodeSingular = evt.target
        if (n.data('collapsed') === true) n.grabify()
        else n.ungrabify()
    })

    // Mirrors setupBasicCytoscapeEventListeners: folder body is input-inert.
    // Hovering a folder does NOT flip cursor to grab and does NOT auto-select.
    // (Real source: webapp/src/shell/UI/views/VoiceTreeGraphViewHelpers/setupBasicCytoscapeEventListeners.ts)
    const cursorTarget: HTMLElement = container.parentElement ?? container
    cy.on('mouseover', 'node', (e): void => {
        const node: NodeSingular = e.target
        if (node.data('isFolderNode')) {
            cursorTarget.style.cursor = 'default'
            cursorReadout.textContent = 'cursor: default (folder body — pass-through)'
            return
        }
        cursorTarget.style.cursor = 'grab'
        cursorReadout.textContent = `cursor: grab (over ${node.id()})`
    })
    cy.on('mouseout', 'node', (): void => {
        cursorTarget.style.cursor = 'default'
        cursorReadout.textContent = 'cursor: default'
    })

    // Mirrors setupBasicCytoscapeEventListeners L94-96: dbltap on a folder
    // toggles collapse via the same path the chevron uses.
    cy.on('dbltap', 'node[?isFolderNode]', (evt): void => {
        const folderId: string = (evt.target as NodeSingular).id()
        void toggleFolderCollapseRef(cy, folderId)
    })

    // Single click on a *collapsed* folder pill — expand. This isn't in the
    // shipped event listener (production relies on dbltap) but mirrors the
    // UX call-out in the openspec: "click the chip = expand". Keeps the demo
    // navigable on the round trip.
    cy.on('tap', 'node[?isFolderNode][?collapsed]', (evt): void => {
        const folderId: string = (evt.target as NodeSingular).id()
        void toggleFolderCollapseRef(cy, folderId)
    })

    // Right-click on the canvas (and inside folder bodies) — proves pass-through works.
    cy.on('cxttap', (evt): void => {
        if (evt.target === cy) {
            flashLog('right-click → canvas context menu would open here')
        } else if ((evt.target as NodeSingular).data?.('isFolderNode')) {
            flashLog('right-click → folder body passed through to canvas (real impl: cytoscape vertical menu fires)')
        } else {
            flashLog(`right-click → node ${(evt.target as NodeSingular).id()}`)
        }
    })

    // Keep collapsedFolderIds in sync with cy state so rebuild() preserves
    // user collapse/expand choices on theme toggle / future rebuilds.
    cy.on('data', 'node[?isFolderNode]', (evt): void => {
        const id: string = (evt.target as NodeSingular).id()
        if ((evt.target as NodeSingular).data('collapsed') === true) collapsedFolderIds.add(id)
        else collapsedFolderIds.delete(id)
    })

    // Wire the REAL service.
    setupFolderHandles(cy, container)
    cy.fit(undefined, 60)
    return cy
}

function rebuild(): void {
    // Drop the chip listeners before destroying cy. Without this, an in-flight
    // tap/dbltap event on the soon-to-be-dead cy can drive positionChip
    // (which reads compound bounds) into the bbox-emit recursion documented in
    // stubs/folderCollapse.ts. The chips themselves come back as part of the
    // fresh setupFolderHandles() call inside buildCy().
    cy.off('position bounds add remove data render pan zoom')
    cy.destroy()
    container.innerHTML = ''
    document.querySelectorAll('.vt-folder-handle-overlay').forEach((el): void => el.remove())
    cy = buildCy()
    ;(window as unknown as { cy: Core }).cy = cy
}

let cy: Core = buildCy()
;(window as unknown as { cy: Core }).cy = cy

// Hook the stub's expand path: re-render cy from a clean state with this
// folder marked expanded. See stubs/folderCollapse.ts for why the in-place
// path is unsafe (compound-bounds re-entrancy in the shipped chip listener).
;(window as unknown as { __mockupExpandFolderRebuild?: (id: string) => void })
    .__mockupExpandFolderRebuild = (folderId: string): void => {
    collapsedFolderIds.delete(folderId)
    rebuild()
    flashLog(`expand → rebuilt cy with /${folderId} expanded (stub workaround)`)
}

resetBtn.addEventListener('click', (): void => {
    collapsedFolderIds.clear()
    collapsedFolderIds.add('retros')
    rebuild()
})

themeBtn.addEventListener('click', (): void => {
    isDark = !isDark
    document.documentElement.classList.toggle('dark', isDark)
    document.body.classList.toggle('dark', isDark)
    rebuild()
})
