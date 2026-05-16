// mountMockupHarness — bootstrap a browser-only cytoscape sandbox with the
// real VoiceTree renderer (styles, colors, folder-handle chip) + stubbed
// editors. Use this from any mockup's main.ts to get a working canvas in
// ~10 lines without re-deriving the boilerplate.
//
// Wires:
//   - cy bootstrap with getDefaultNodeStyles + getGraphColors (real shipped code)
//   - sample graph (folders, leaves, edges, collapsed pills)
//   - setupFolderHandles (real shipped chip service)
//   - toggleFolderCollapse routed via the folderCollapse alias stub
//   - setupNodeEditors (stubbed hover + anchored editors)
//   - theme toggle, reset button, cursor readout, event log
//
// What's NOT wired (mockups can layer on via `onCyReady`):
//   - presentation cards / image viewers
//   - drag-to-create, right-click menus, context selection
//   - any window.electronAPI surface beyond the folderCollapse alias

import './harness.css'

import cytoscape, { type Core, type EventObject, type NodeSingular } from 'cytoscape'

import { setupFolderHandles } from '@/shell/UI/cytoscape-graph-ui/services/folder-handle/FolderHandleService'
import { getDefaultNodeStyles } from '@/shell/UI/cytoscape-graph-ui/services/styles/defaultNodeStyles'
import { getGraphColors } from '@/shell/UI/cytoscape-graph-ui/services/styles/themeColors'
import { toggleFolderCollapse as toggleFolderCollapseRef } from '@/shell/edge/UI-edge/graph/view/folderCollapse'

import { buildSampleGraph } from './sampleGraph'
import { setupNodeEditors, closeAllNodeEditors } from './nodeEditors'

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
    /** Folder ids that should boot collapsed. Defaults to `['retros']`. */
    initialCollapsedFolders?: readonly string[]
    /** Footer hint text on the right of the buttons. */
    footerHint?: string
    /** Start in dark mode. Defaults to true (matches the existing folder-handle mockup). */
    startDark?: boolean
    /**
     * Hook to extend / replace the sample graph. Receives the default elements
     * and must return the final element list.
     */
    extendGraph?: (defaults: cytoscape.ElementDefinition[]) => cytoscape.ElementDefinition[]
    /**
     * Hook called after each cy build (initial + every rebuild). Use for extra
     * event wiring, custom listeners, presentation-card setup, etc.
     */
    onCyReady?: (cy: Core, host: HTMLElement) => void
}

export interface HarnessHandle {
    /** Current cy instance. Replaced on rebuild. */
    getCy(): Core
    /** Tear down and rebuild cy from scratch (preserves collapse state). */
    rebuild(): void
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

    // Header
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

    // Canvas host
    const canvasHost: HTMLDivElement = el('div', 'vt-harness__canvas-host')
    const container: HTMLDivElement = el('div', 'vt-harness__cy')
    const cursorReadout: HTMLDivElement = el('div', 'vt-harness__cursor-readout')
    cursorReadout.textContent = 'cursor: default'
    const eventLog: HTMLDivElement = el('div', 'vt-harness__event-log')
    canvasHost.appendChild(container)
    canvasHost.appendChild(cursorReadout)
    canvasHost.appendChild(eventLog)
    page.appendChild(canvasHost)

    // Footer
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
 * Mount a browser-only cytoscape harness with the real VoiceTree renderer.
 * Returns a handle for rebuild / teardown / flashLog.
 */
export function mountMockupHarness(opts: MountHarnessOptions): HarnessHandle {
    const dom = buildDom(opts)
    const { container, cursorReadout, eventLog, resetBtn, themeBtn } = dom

    // Track collapse state across rebuilds (theme toggle, reset, expand re-render).
    const collapsedFolderIds: Set<string> = new Set<string>(opts.initialCollapsedFolders ?? ['retros'])

    let isDark: boolean = opts.startDark ?? true
    document.documentElement.classList.toggle('dark', isDark)
    document.body.classList.toggle('dark', isDark)

    let cy: Core
    let editorTeardown: () => void = (): void => {}

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
        const elements: cytoscape.ElementDefinition[] = buildSampleGraph({ initialCollapsed: collapsedFolderIds })
        const finalElements: cytoscape.ElementDefinition[] = opts.extendGraph ? opts.extendGraph(elements) : elements

        const created: Core = cytoscape({
            container,
            elements: finalElements,
            style: getDefaultNodeStyles(colors, 'Inter, system-ui, sans-serif', isDark) as cytoscape.StylesheetCSS[],
            layout: { name: 'preset' },
            wheelSensitivity: 0.2,
        })

        // Mirrors applyGraphDeltaToUI: expanded folders ungrabify, collapsed pills stay grabbable.
        created.nodes('node[?isFolderNode]').forEach((n: NodeSingular): void => {
            if (n.data('collapsed') === true) n.grabify()
            else n.ungrabify()
        })
        created.on('add', 'node[?isFolderNode]', (evt: EventObject): void => {
            const n: NodeSingular = evt.target
            if (n.data('collapsed') === true) n.grabify()
            else n.ungrabify()
        })

        // Mirrors setupBasicCytoscapeEventListeners: folder body is input-inert.
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

        // dbltap on a folder toggles collapse via the same path the chevron uses.
        created.on('dbltap', 'node[?isFolderNode]', (evt: EventObject): void => {
            const folderId: string = (evt.target as NodeSingular).id()
            void toggleFolderCollapseRef(created, folderId)
        })

        // Single click on a collapsed folder pill → expand (UX call-out from the openspec).
        created.on('tap', 'node[?isFolderNode][?collapsed]', (evt: EventObject): void => {
            const folderId: string = (evt.target as NodeSingular).id()
            void toggleFolderCollapseRef(created, folderId)
        })

        // Right-click pass-through demo (real impl: cytoscape vertical menu fires).
        created.on('cxttap', (evt: EventObject): void => {
            if (evt.target === created) {
                flashLog('right-click → canvas context menu would open here')
            } else if ((evt.target as NodeSingular).data?.('isFolderNode')) {
                flashLog('right-click → folder body passed through to canvas')
            } else {
                flashLog(`right-click → node ${(evt.target as NodeSingular).id()}`)
            }
        })

        // Keep collapsedFolderIds in sync with cy state so rebuild preserves user choices.
        created.on('data', 'node[?isFolderNode]', (evt: EventObject): void => {
            const id: string = (evt.target as NodeSingular).id()
            if ((evt.target as NodeSingular).data('collapsed') === true) collapsedFolderIds.add(id)
            else collapsedFolderIds.delete(id)
        })

        // Wire the REAL FolderHandleService.
        setupFolderHandles(created, container)

        // Stubbed hover + anchored editors. Mount onto the canvas-host so the
        // editor sits in the same coordinate space as the rendered bbox.
        const editorHost: HTMLElement = container.parentElement ?? container
        editorTeardown = setupNodeEditors(created, editorHost)

        // User hook for extra wiring.
        if (opts.onCyReady) opts.onCyReady(created, editorHost)

        created.fit(undefined, 60)
        return created
    }

    function rebuild(): void {
        // Drop chip listeners before destroying cy. Without this, an in-flight
        // tap/dbltap on the soon-to-be-dead cy can drive positionChip (which
        // reads compound bounds) into the bbox-emit recursion documented in
        // folderCollapseStub.ts. Chips come back via the next setupFolderHandles.
        if (cy) {
            cy.off('position bounds add remove data render pan zoom')
            editorTeardown()
            closeAllNodeEditors()
            cy.destroy()
        }
        container.innerHTML = ''
        document.querySelectorAll('.vt-folder-handle-overlay').forEach((el): void => el.remove())
        document.querySelectorAll('.vt-mockup-editor').forEach((el): void => el.remove())
        cy = buildCy()
        ;(window as unknown as { cy: Core }).cy = cy
    }

    cy = buildCy()
    ;(window as unknown as { cy: Core }).cy = cy

    // Hook the stub's expand path: re-render cy from a clean state with this
    // folder marked expanded. Same approach the folder-handle mockup uses to
    // dodge the compound-bounds re-entrancy in the shipped chip listener.
    ;(window as unknown as { __mockupExpandFolderRebuild?: (id: string) => void })
        .__mockupExpandFolderRebuild = (folderId: string): void => {
        collapsedFolderIds.delete(folderId)
        rebuild()
        flashLog(`expand → rebuilt cy with /${folderId} expanded (stub workaround)`)
    }

    resetBtn.addEventListener('click', (): void => {
        collapsedFolderIds.clear()
        for (const id of opts.initialCollapsedFolders ?? ['retros']) collapsedFolderIds.add(id)
        rebuild()
    })

    themeBtn.addEventListener('click', (): void => {
        isDark = !isDark
        document.documentElement.classList.toggle('dark', isDark)
        document.body.classList.toggle('dark', isDark)
        rebuild()
    })

    return {
        getCy: (): Core => cy,
        rebuild,
        teardown: (): void => {
            editorTeardown()
            closeAllNodeEditors()
            if (cy) cy.destroy()
            opts.root.replaceChildren()
        },
        flashLog,
    }
}
