// mountMockupHarness — bootstrap a browser-only cytoscape playground that
// runs the REAL VoiceTree renderer end-to-end.
//
// Wires:
//   - In-browser daemon (real `project()` from @vt/graph-state over a
//     synthetic Graph + FolderTreeNode + ProjectState)
//   - window.hostAPI stub bridging to that daemon
//   - Real `applyGraphDeltaToUI` mutates cy from each ProjectedGraph
//   - Real `FolderHandleService` chevron chip
//   - Real `folderCollapse.toggleFolderCollapse` for chip taps
//   - Real `defaultNodeStyles` + `themeColors` for styling
//   - Real floating editor stack (HoverEditor → AnchoredEditor → CodeMirror)
//     via `setupCommandHover` + `updateFloatingEditorsFromProjectedGraph`
//   - Theme toggle, reset button, cursor readout, event log
//
// What's NOT wired (mockups can layer on via `onCyReady`):
//   - presentation cards / image viewers (stubbed, see viteAliases.ts)
//   - drag-to-create, right-click menus, context selection
//   - any window.hostAPI surface beyond folder-state + read-only graph

import './harness.css'

import cytoscape, { type Core, type EventObject, type NodeSingular } from 'cytoscape'

import { setupFolderHandles } from '@/shell/UI/cytoscape-graph-ui/services/folder-handle/FolderHandleService'
import { getDefaultNodeStyles } from '@/shell/UI/cytoscape-graph-ui/services/styles/defaultNodeStyles'
import { getGraphColors } from '@/shell/UI/cytoscape-graph-ui/services/styles/themeColors'
import { applyGraphDeltaToUI } from '@/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI'
import { toggleFolderCollapse } from '@/shell/edge/UI-edge/graph/view/folderCollapse'
import { setupCommandHover } from '@/shell/edge/UI-edge/floating-windows/editors/HoverEditor'
import { updateFloatingEditorsFromProjectedGraph } from '@/shell/edge/UI-edge/floating-windows/editors/EditorSync'
import { closeAllEditors } from '@/shell/edge/UI-edge/floating-windows/editors/FloatingEditorCRUD'
import { mountLayoutProjection, type LayoutProjectionMount } from '@/shell/edge/UI-edge/graph/layout/layoutProjection'
import { getLayoutStoreSingleton } from '@vt/graph-state/state/layoutStore'
import { applyNodeSelectionSideEffects } from '@/shell/edge/UI-edge/graph/actions/applyNodeSelectionSideEffects'
import type { NodeIdAndFilePath } from '@vt/graph-model/graph'
import type { ProjectedGraph } from '@vt/graph-state/contract'

import { buildPlaygroundFixture } from './playground/domainFixture'
import { createInBrowserDaemon, type InBrowserDaemon } from './playground/inBrowserDaemon'
import { installElectronApiStub } from './playground/electronApiStub'

export interface HarnessLegendItem {
    /** HTML allowed — rendered as innerHTML. */
    html: string
}

export interface MountHarnessOptions {
    /** Root element to render the harness into. Will be replaced. */
    root: HTMLElement
    /** Page title shown in the header. */
    title?: string
    /** Optional intro HTML below the title. */
    introHtml?: string
    /** Optional legend bullets shown under the intro. */
    legend?: HarnessLegendItem[]
    /** Optional yellow-tinted note below the legend. */
    noteHtml?: string
    /** Footer hint text on the right of the buttons. */
    footerHint?: string
    /** Start in dark mode. Defaults to true. */
    startDark?: boolean
    /**
     * Hook called after the cy instance is built (after initial projection
     * is applied). Use for extra event wiring, presentation-card setup, etc.
     */
    onCyReady?: (cy: Core, host: HTMLElement) => void
}

export interface HarnessHandle {
    /** Current cy instance. */
    getCy(): Core
    /** In-browser daemon for direct interaction in tests / dev tools. */
    getDaemon(): InBrowserDaemon
    /** Re-apply the current projection to cy (for dev parity with reset). */
    reproject(): void
    /** Detach everything and remove the harness from the DOM. */
    teardown(): void
    /** Flash a transient message in the bottom-left event log. */
    flashLog(msg: string): void
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const node: HTMLElementTagNameMap[K] = document.createElement(tag)
    if (className) node.className = className
    return node
}

function buildDom(opts: MountHarnessOptions): {
    container: HTMLDivElement
    cursorReadout: HTMLDivElement
    eventLog: HTMLDivElement
    resetBtn: HTMLButtonElement
    themeBtn: HTMLButtonElement
} {
    const page: HTMLDivElement = el('div', 'vt-harness')

    const header: HTMLElement = el('header', 'vt-harness__header')
    if (opts.title) {
        const h1: HTMLHeadingElement = el('h1')
        h1.textContent = opts.title
        header.appendChild(h1)
    }
    if (opts.introHtml) {
        const intro: HTMLParagraphElement = el('p', 'vt-harness__intro')
        intro.innerHTML = opts.introHtml
        header.appendChild(intro)
    }
    if (opts.legend && opts.legend.length > 0) {
        const ul: HTMLUListElement = el('ul', 'vt-harness__legend')
        for (const item of opts.legend) {
            const li: HTMLLIElement = document.createElement('li')
            li.innerHTML = item.html
            ul.appendChild(li)
        }
        header.appendChild(ul)
    }
    if (opts.noteHtml) {
        const note: HTMLParagraphElement = el('p', 'vt-harness__note')
        note.innerHTML = opts.noteHtml
        header.appendChild(note)
    }
    page.appendChild(header)

    const canvasHost: HTMLDivElement = el('div', 'vt-harness__canvas-host')
    const container: HTMLDivElement = el('div', 'vt-harness__cy')
    const cursorReadout: HTMLDivElement = el('div', 'vt-harness__cursor-readout')
    cursorReadout.textContent = 'cursor: default'
    const eventLog: HTMLDivElement = el('div', 'vt-harness__event-log')
    canvasHost.appendChild(container)
    canvasHost.appendChild(cursorReadout)
    canvasHost.appendChild(eventLog)
    page.appendChild(canvasHost)

    const footer: HTMLElement = el('footer', 'vt-harness__footer')
    const resetBtn: HTMLButtonElement = el('button', 'vt-harness__btn')
    resetBtn.textContent = 'Reset graph'
    const themeBtn: HTMLButtonElement = el('button', 'vt-harness__btn')
    themeBtn.textContent = 'Toggle light/dark'
    const hint: HTMLSpanElement = el('span', 'vt-harness__hint')
    hint.textContent = opts.footerHint ?? ''
    footer.appendChild(resetBtn)
    footer.appendChild(themeBtn)
    if (opts.footerHint) footer.appendChild(hint)
    page.appendChild(footer)

    opts.root.replaceChildren(page)
    return { container, cursorReadout, eventLog, resetBtn, themeBtn }
}

/**
 * Mount a browser-only cytoscape harness that drives the real VoiceTree
 * folder-node pipeline. Returns a handle for tests + dev tools.
 */
export function mountMockupHarness(opts: MountHarnessOptions): HarnessHandle {
    const dom = buildDom(opts)
    const { container, cursorReadout, eventLog, resetBtn, themeBtn } = dom

    let isDark: boolean = opts.startDark ?? true
    document.documentElement.classList.toggle('dark', isDark)
    document.body.classList.toggle('dark', isDark)

    // Build the fixture + daemon ONCE; the cy instance is rebuilt on theme
    // toggle (because styles are baked in at cytoscape() init), but the
    // underlying daemon state and collapseSet persist across rebuilds.
    const fixture = buildPlaygroundFixture()
    let daemon: InBrowserDaemon = createInBrowserDaemon({
        project: fixture.project,
        graph: fixture.graph,
        folderTree: fixture.folderTree,
        initialCollapsedFolderIds: fixture.initialCollapsedFolderIds,
        positions: fixture.positions,
    })
    installElectronApiStub(daemon)

    let cy: Core
    let layoutProjection: LayoutProjectionMount | null = null
    let lastProjection: ProjectedGraph | null = null

    function flashLog(msg: string): void {
        eventLog.textContent = msg
        eventLog.classList.add('vt-harness__event-log--show')
        window.clearTimeout((flashLog as unknown as { t?: number }).t)
        ;(flashLog as unknown as { t?: number }).t = window.setTimeout((): void => {
            eventLog.classList.remove('vt-harness__event-log--show')
        }, 1600)
    }

    function buildCy(): Core {
        const colors = getGraphColors(isDark)
        // Match production's renderer (initializeCytoscapeInstance.ts) so visual
        // bugs in the WebGL texture path reproduce in the playground.
        const created: Core = cytoscape({
            container,
            elements: [],
            style: getDefaultNodeStyles(colors, 'Inter, system-ui, sans-serif', isDark) as cytoscape.StylesheetCSS[],
            layout: { name: 'preset' },
            wheelSensitivity: 0.2,
            renderer: {
                name: 'canvas',
                webgl: true,
                webglDebug: false,
                webglTexSize: 2048,
                webglTexRows: 24,
                webglBatchSize: 2048,
                webglTexPerBatch: 16,
            },
        } as cytoscape.CytoscapeOptions)

        // Hover cursor — exact mirror of setupBasicCytoscapeEventListeners
        // for the folder-vs-leaf distinction. Lives here (not aliased) so
        // the harness owns its own cursor readout.
        const cursorTarget: HTMLElement = container.parentElement ?? container
        created.on('mouseover', 'node', (e: EventObject): void => {
            const node: NodeSingular = e.target
            if (node.data('isFolderNode')) {
                cursorTarget.style.cursor = 'default'
                cursorReadout.textContent = 'cursor: default (folder body — pass-through)'
                return
            }
            cursorTarget.style.cursor = 'grab'
            cursorReadout.textContent = `cursor: grab (over ${node.id()})`
        })
        created.on('mouseout', 'node', (): void => {
            cursorTarget.style.cursor = 'default'
            cursorReadout.textContent = 'cursor: default'
        })

        // Right-click pass-through demo (real impl: cytoscape vertical menu).
        created.on('cxttap', (evt: EventObject): void => {
            if (evt.target === created) {
                flashLog('right-click → canvas context menu would open here')
            } else if ((evt.target as NodeSingular).data?.('isFolderNode')) {
                flashLog('right-click → folder body passed through to canvas')
            } else {
                flashLog(`right-click → node ${(evt.target as NodeSingular).id()}`)
            }
        })

        // Sync cy viewport (pan/zoom) back into the singleton layoutStore so
        // every consumer that reads `getLayout().zoom / .pan` (HoverEditor,
        // anchored-editor positioning, floating-window overlay transform) stays
        // aligned with the real cy viewport. Without this the harness's
        // cy.fit() updates cy but the store keeps reporting `{zoom:1, pan:0}`,
        // so editors render at the wrong place. Production wires this from
        // VoiceTreeGraphView; the playground needs the same hook.
        layoutProjection = mountLayoutProjection(created, getLayoutStoreSingleton())

        // Real chevron chip overlay (handles collapse from the expanded TL
        // chip). Re-expansion mirrors production's setupBasicCytoscapeEventListeners:
        // double-tap any folder body (incl. collapsed pills) toggles state.
        setupFolderHandles(created)
        created.on('dbltap', 'node[?isFolderNode]', (evt: EventObject): void => {
            void toggleFolderCollapse(created, (evt.target as NodeSingular).id())
        })

        // Real floating editor stack — hover spawns a HoverEditor backed by
        // CodeMirror reading content via getGraph()/getNode() (electronApiStub).
        // Double-click promotes to a pinned AnchoredEditor. Writes are no-ops
        // (applyGraphDelta* stubs return null), so edits are local to the
        // CodeMirror buffer and do NOT round-trip into the graph.
        setupCommandHover(created)
        // Single-tap a FILE node → pin an AnchoredEditor (production-parity).
        // Folders are deliberately excluded here even though
        // setupCytoscape.ts:47-56 matches all nodes: in production the
        // chevron-tap and tap-to-pin handlers both fire for a single chevron
        // click, leaving a pinned folder-note editor after every collapse.
        // The playground exposes folder content via hover (HoverEditor) and
        // dbltap-to-toggle, so folder pinning is unnecessary noise here.
        created.on('tap', 'node[!isFolderNode]', (evt: EventObject): void => {
            const nodeId: string = (evt.target as NodeSingular).id()
            void applyNodeSelectionSideEffects({ cy: created, nodeId: nodeId as NodeIdAndFilePath })
        })

        const editorHost: HTMLElement = container.parentElement ?? container
        if (opts.onCyReady) opts.onCyReady(created, editorHost)
        return created
    }

    function applyProjection(graph: ProjectedGraph): void {
        applyGraphDeltaToUI(cy, graph)
        // Real editor sync — close/open/refresh editors so the open editor set
        // tracks the projection (collapsing a folder closes its child editors).
        updateFloatingEditorsFromProjectedGraph(cy, graph, lastProjection)
        lastProjection = graph
        cy.fit(undefined, 60)
    }

    function reproject(): void {
        applyProjection(daemon.getProjection())
    }

    function destroyCy(): void {
        if (!cy) return
        layoutProjection?.unmount()
        layoutProjection = null
        cy.off('position bounds add remove data render pan zoom')
        closeAllEditors(cy)
        lastProjection = null
        cy.destroy()
        container.innerHTML = ''
        document.querySelectorAll('.vt-folder-handle-overlay').forEach((node): void => node.remove())
    }

    function rebuildForTheme(): void {
        destroyCy()
        cy = buildCy()
        ;(window as unknown as { cy: Core }).cy = cy
        // No new subscription needed — the existing hostAPI subscription
        // is still wired to the same daemon and will push on demand. Re-fit
        // the current projection synchronously so the new cy is non-empty.
        applyProjection(daemon.getProjection())
    }

    function subscribeProjection(): void {
        // Mirror production's subscribeToGraphUpdates: every projection emit
        // from the daemon flows through applyGraphDeltaToUI. The initial
        // hydration fires via queueMicrotask inside installElectronApiStub.
        // The real folderCollapse also applies its return value optimistically
        // — this duplicate apply is idempotent and matches production's
        // optimistic-then-SSE-reconcile cadence.
        window.hostAPI?.graph.onProjectedGraphUpdate?.((graph: ProjectedGraph): void => {
            applyProjection(graph)
            const collapsedCount: number = graph.nodes.filter((n) => n.kind === 'folder-collapsed').length
            flashLog(`projection → ${graph.nodes.length} nodes, ${collapsedCount} collapsed folders`)
        })
    }

    cy = buildCy()
    ;(window as unknown as { cy: Core }).cy = cy
    subscribeProjection()

    resetBtn.addEventListener('click', (): void => {
        // Editors live in document.body, not inside cy — they survive a daemon
        // swap. Close them so the rebuilt projection starts from a clean slate.
        closeAllEditors(cy)
        lastProjection = null
        const freshFixture = buildPlaygroundFixture()
        daemon = createInBrowserDaemon({
            project: freshFixture.project,
            graph: freshFixture.graph,
            folderTree: freshFixture.folderTree,
            initialCollapsedFolderIds: freshFixture.initialCollapsedFolderIds,
            positions: freshFixture.positions,
        })
        installElectronApiStub(daemon)
        subscribeProjection()
        flashLog('reset graph — fresh daemon, initial projection re-applied')
    })

    themeBtn.addEventListener('click', (): void => {
        isDark = !isDark
        document.documentElement.classList.toggle('dark', isDark)
        document.body.classList.toggle('dark', isDark)
        rebuildForTheme()
    })

    return {
        getCy: (): Core => cy,
        getDaemon: (): InBrowserDaemon => daemon,
        reproject,
        teardown: (): void => {
            destroyCy()
            opts.root.replaceChildren()
        },
        flashLog,
    }
}
