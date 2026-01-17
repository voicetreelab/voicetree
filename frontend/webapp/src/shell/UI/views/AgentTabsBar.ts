/**
 * AgentTabsBar - Renders open terminal/agent tabs in top-right of title bar
 *
 * Features:
 * - Pinned section (90px tabs with title + status dot) and unpinned section (24px status dot only)
 * - Status indicators: ◌ running (dotted border animated), ● done (green filled)
 * - Positioned in macOS title bar area (right: 80px, mirroring RecentNodeTabsBar)
 * - Clicking a tab navigates to and focuses that terminal
 * - Highlights currently active terminal
 * - Drag-and-drop reordering within pinned section
 */

// todo, this file is awful, it has state mixed with rendering. Must be split into pure, state @ edge, and ui view

import type { TerminalId } from '@/shell/edge/UI-edge/floating-windows/types'
import { getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types'
import { getTerminals } from '@/shell/edge/UI-edge/state/TerminalStore'
// Import to make Window.electronAPI type available
import type {} from '@/shell/electron'
import type {TerminalData} from "@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType";

const TAB_WIDTH_PINNED: number = 90
const TAB_WIDTH_UNPINNED: number = 24
// Duration to suppress terminal data events after zoom (to ignore resize-triggered redraws)
const ZOOM_SUPPRESSION_MS: number = 800
// Inactivity tracking: check every 5 seconds, mark inactive after 10 seconds of no output
const CHECK_INTERVAL_MS: number = 5000
const INACTIVITY_THRESHOLD_MS: number = 10000

interface AgentTabsBarState {
    container: HTMLElement | null
    pinnedContainer: HTMLElement | null
    unpinnedContainer: HTMLElement | null
    dividerElement: HTMLElement | null
    activeTerminalId: TerminalId | null
    // Track terminal "done" status: true = inactive for threshold, false or missing = running
    terminalDone: Map<TerminalId, boolean>
    // Track pinned state per terminal (terminals start pinned by default)
    pinnedTerminals: Set<TerminalId>
    // User-defined display order (for drag-and-drop reordering within pinned section)
    displayOrder: TerminalId[]
    // Cached for re-render after drag-drop
    lastTerminals: TerminalData[]
    lastOnSelect: ((terminal: TerminalData) => void) | null
    // Ghost element shown during drag to preview drop position
    ghostElement: HTMLElement | null
    // Index of tab currently being dragged (for self-hover detection)
    draggingFromIndex: number | null
    // Target index where ghost is positioned (where dragged tab will be inserted)
    ghostTargetIndex: number | null
    // Timestamp when zoom suppression started (ignore terminal data during resize)
    zoomSuppressionUntil: number
    // Track last output time per terminal for inactivity detection
    lastOutputTime: Map<TerminalId, number>
    // Interval ID for inactivity check
    inactivityCheckInterval: ReturnType<typeof setInterval> | null
    // Track count of unacknowledged activity per terminal (each new node adds a dot)
    terminalActivityCount: Map<TerminalId, number>
}

// Module state for the single instance
const state: AgentTabsBarState = {
    container: null,
    pinnedContainer: null,
    unpinnedContainer: null,
    dividerElement: null,
    activeTerminalId: null,
    terminalDone: new Map(),
    pinnedTerminals: new Set(),
    displayOrder: [],
    lastTerminals: [],
    lastOnSelect: null,
    ghostElement: null,
    draggingFromIndex: null,
    ghostTargetIndex: null,
    zoomSuppressionUntil: 0,
    lastOutputTime: new Map(),
    inactivityCheckInterval: null,
    terminalActivityCount: new Map()
}

/**
 * Sync displayOrder with actual terminals (handle add/remove)
 * Preserves existing order, removes stale IDs, appends new terminals at end
 * Also ensures new terminals are added to pinnedTerminals by default
 */
function syncDisplayOrder(terminals: TerminalData[]): TerminalId[] {
    const terminalIds: Set<TerminalId> = new Set(terminals.map(t => getTerminalId(t)))

    // Remove stale IDs (terminals that no longer exist)
    const filtered: TerminalId[] = state.displayOrder.filter(id => terminalIds.has(id))

    // Clean up stale entries from terminalDone and pinnedTerminals
    for (const id of state.terminalDone.keys()) {
        if (!terminalIds.has(id)) {
            state.terminalDone.delete(id)
        }
    }
    for (const id of state.pinnedTerminals) {
        if (!terminalIds.has(id)) {
            state.pinnedTerminals.delete(id)
        }
    }

    // Append new terminals at end and mark them as pinned by default
    for (const t of terminals) {
        const id: TerminalId = getTerminalId(t)
        if (!filtered.includes(id)) {
            filtered.push(id)
            // New terminals start pinned by default
            state.pinnedTerminals.add(id)
        }
    }
    return filtered
}

/**
 * Reorder terminal after drag-drop and trigger re-render
 */
function reorderTerminal(fromIndex: number, toIndex: number): void {
    // Only reorder within pinned terminals
    const pinnedIds: TerminalId[] = state.displayOrder.filter(id => state.pinnedTerminals.has(id))
    if (fromIndex < 0 || fromIndex >= pinnedIds.length || toIndex < 0 || toIndex > pinnedIds.length) {
        return
    }

    const [moved] = pinnedIds.splice(fromIndex, 1)
    pinnedIds.splice(toIndex, 0, moved)

    // Rebuild displayOrder: pinned first in new order, then unpinned
    const unpinnedIds: TerminalId[] = state.displayOrder.filter(id => !state.pinnedTerminals.has(id))
    state.displayOrder = [...pinnedIds, ...unpinnedIds]

    // Re-render with cached data
    if (state.lastOnSelect) {
        renderAgentTabs(state.lastTerminals, state.activeTerminalId, state.lastOnSelect)
    }
}

/**
 * Get the current display order for pinned terminals (for GraphNavigationService cycling)
 * Only returns pinned terminals as they are navigable via keyboard
 */
export function getDisplayOrder(): TerminalId[] {
    return state.displayOrder.filter(id => state.pinnedTerminals.has(id))
}

/**
 * Create a ghost element to show drop preview position
 */
function createGhostElement(): HTMLElement {
    const ghost: HTMLElement = document.createElement('div')
    ghost.className = 'agent-tab-ghost'
    return ghost
}

/**
 * Remove the ghost element from DOM and reset target index
 */
function removeGhostElement(): void {
    if (state.ghostElement && state.ghostElement.parentNode) {
        state.ghostElement.parentNode.removeChild(state.ghostElement)
    }
    state.ghostElement = null
    state.ghostTargetIndex = null
}

/**
 * Update divider visibility based on whether both sections have content
 */
function updateDividerVisibility(): void {
    if (!state.dividerElement) return

    const hasPinned: boolean = state.displayOrder.some(id => state.pinnedTerminals.has(id))
    const hasUnpinned: boolean = state.displayOrder.some(id => !state.pinnedTerminals.has(id))

    state.dividerElement.style.display = (hasPinned && hasUnpinned) ? 'block' : 'none'
}

function startTerminalDataActivityPolling() : void {
    window.electronAPI?.terminal.onData((terminalId: string, _data: string) => {
        const now: number = Date.now()
        // Skip inactivity updates during zoom suppression window (resize-triggered redraws)
        if (now < state.zoomSuppressionUntil) {
            return
        }
        state.lastOutputTime.set(terminalId as TerminalId, now)
        // Terminal became active - remove inactive class immediately
        updateInactivityClass(terminalId as TerminalId, false)
        // Activity means "running" again for the done indicator
        setTerminalDone(terminalId as TerminalId, false)
    })

    // Start interval to check for inactive terminals
    state.inactivityCheckInterval = setInterval(() => {
        checkTerminalInactivity()
    }, CHECK_INTERVAL_MS)
}

/**
 * Create and mount the agent tabs bar into a parent container
 *
 * @param parentContainer - The container to mount the tabs bar into
 * @returns cleanup function to dispose the tabs bar
 */
export function createAgentTabsBar(parentContainer: HTMLElement): () => void {
    // Clean up any existing instance
    disposeAgentTabsBar()

    // Create main container (positioned in title bar area, right side)
    state.container = document.createElement('div')
    state.container.className = 'agent-tabs-bar'
    state.container.setAttribute('data-testid', 'agent-tabs-bar')

    // Create pinned tabs container
    state.pinnedContainer = document.createElement('div')
    state.pinnedContainer.className = 'agent-tabs-pinned'

    // Container-level drag handlers for dropping at the end of the pinned list
    state.pinnedContainer.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault()
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move'
        }
        // Only show ghost at end if mouse is past all tabs (in empty space)
        if (state.ghostElement && state.pinnedContainer && state.draggingFromIndex !== null) {
            const tabs: HTMLCollectionOf<Element> = state.pinnedContainer.getElementsByClassName('agent-tab')
            if (tabs.length > 0) {
                const lastTab: Element = tabs[tabs.length - 1]
                const lastTabRect: DOMRect = lastTab.getBoundingClientRect()
                // If mouse is past the right edge of the last tab, show ghost at end
                if (e.clientX > lastTabRect.right) {
                    state.pinnedContainer.appendChild(state.ghostElement)
                    const pinnedCount: number = state.displayOrder.filter(id => state.pinnedTerminals.has(id)).length
                    state.ghostTargetIndex = pinnedCount
                }
            }
        }
    })

    state.pinnedContainer.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault()
        const fromIndex: number = parseInt(e.dataTransfer?.getData('text/plain') ?? '-1')
        const targetIndex: number | null = state.ghostTargetIndex
        removeGhostElement()
        state.draggingFromIndex = null

        if (fromIndex >= 0 && targetIndex !== null && fromIndex !== targetIndex) {
            // Calculate the actual insertion index after removal
            const adjustedTarget: number = fromIndex < targetIndex ? targetIndex - 1 : targetIndex
            reorderTerminal(fromIndex, adjustedTarget)
        }
    })

    // Create divider
    state.dividerElement = document.createElement('div')
    state.dividerElement.className = 'agent-tabs-divider'
    state.dividerElement.style.display = 'none' // Hidden initially

    // Create unpinned tabs container
    state.unpinnedContainer = document.createElement('div')
    state.unpinnedContainer.className = 'agent-tabs-unpinned'

    state.container.appendChild(state.pinnedContainer)
    state.container.appendChild(state.dividerElement)
    state.container.appendChild(state.unpinnedContainer)
    parentContainer.appendChild(state.container)

    // Initially hidden until we have terminals
    state.container.style.display = 'none'

    // Subscribe to terminal data events for inactivity tracking
    startTerminalDataActivityPolling();



    return disposeAgentTabsBar
}

/**
 * Render tabs from the terminals map
 *
 * @param terminals - Array of terminal data
 * @param activeTerminalId - Currently active terminal ID (from cycling)
 * @param onSelect - Callback when a tab is clicked
 */
export function renderAgentTabs(
    terminals: TerminalData[],
    activeTerminalId: TerminalId | null,
    onSelect: (terminal: TerminalData) => void
): void {
    if (!state.pinnedContainer || !state.unpinnedContainer || !state.container) {
        console.warn('[AgentTabsBar] Not mounted, cannot render')
        return
    }

    state.activeTerminalId = activeTerminalId
    // Cache for re-render after drag-drop
    state.lastTerminals = terminals
    state.lastOnSelect = onSelect

    // Clear existing tabs
    state.pinnedContainer.innerHTML = ''
    state.unpinnedContainer.innerHTML = ''

    // Sync display order with actual terminals (preserves user ordering)
    state.displayOrder = syncDisplayOrder(terminals)

    // Split terminals into pinned and unpinned
    const pinnedIds: TerminalId[] = state.displayOrder.filter(id => state.pinnedTerminals.has(id))
    const unpinnedIds: TerminalId[] = state.displayOrder.filter(id => !state.pinnedTerminals.has(id))

    // Find the index of the active terminal in pinned display order (for shortcuts)
    const activeIndex: number = activeTerminalId && state.pinnedTerminals.has(activeTerminalId)
        ? pinnedIds.indexOf(activeTerminalId)
        : -1

    // Create pinned tabs
    for (let i: number = 0; i < pinnedIds.length; i++) {
        const terminalId: TerminalId = pinnedIds[i]
        const terminal: TerminalData | undefined = terminals.find(t => getTerminalId(t) === terminalId)
        if (terminal) {
            const tab: HTMLElement = createPinnedTab(terminal, activeTerminalId, onSelect, i, activeIndex, pinnedIds.length)
            state.pinnedContainer.appendChild(tab)
        }
    }

    // Create unpinned tabs
    for (const terminalId of unpinnedIds) {
        const terminal: TerminalData | undefined = terminals.find(t => getTerminalId(t) === terminalId)
        if (terminal) {
            const tab: HTMLElement = createUnpinnedTab(terminal, onSelect)
            state.unpinnedContainer.appendChild(tab)
        }
    }

    // Update divider visibility
    updateDividerVisibility()

    // Update visibility based on whether we have terminals
    state.container.style.display = terminals.length > 0 ? 'flex' : 'none'
}

/**
 * Update which terminal is highlighted as active
 */
export function setActiveTerminal(terminalId: TerminalId | null): void {
    state.activeTerminalId = terminalId

    if (!state.pinnedContainer || !state.unpinnedContainer) return

    const pinnedIds: TerminalId[] = state.displayOrder.filter(id => state.pinnedTerminals.has(id))
    const activeIndex: number = terminalId && state.pinnedTerminals.has(terminalId)
        ? pinnedIds.indexOf(terminalId)
        : -1
    const totalPinnedTabs: number = pinnedIds.length

    // Update active class on pinned tabs and shortcut hints
    const pinnedWrappers: HTMLCollectionOf<Element> = state.pinnedContainer.getElementsByClassName('agent-tab-wrapper')
    for (let i: number = 0; i < pinnedWrappers.length; i++) {
        const wrapper: Element = pinnedWrappers[i]
        const tab: Element | null = wrapper.querySelector('.agent-tab')
        const tabTerminalId: string | null = wrapper.getAttribute('data-terminal-id')

        if (tab) {
            if (tabTerminalId === terminalId) {
                tab.classList.add('agent-tab-active')
            } else {
                tab.classList.remove('agent-tab-active')
            }
        }

        // Update shortcut hint based on new active terminal
        const existingHint: Element | null = wrapper.querySelector('.agent-tab-shortcut-hint')
        if (existingHint) {
            existingHint.remove()
        }

        const shortcutText: string | null = getShortcutHintForTab(i, activeIndex, totalPinnedTabs)
        if (shortcutText !== null) {
            const shortcutHint: HTMLSpanElement = document.createElement('span')
            shortcutHint.className = 'agent-tab-shortcut-hint'
            shortcutHint.textContent = shortcutText
            wrapper.appendChild(shortcutHint)
        }
    }

    // Update active class on unpinned tabs (no shortcuts for unpinned)
    const unpinnedTabs: HTMLCollectionOf<Element> = state.unpinnedContainer.getElementsByClassName('agent-tab-unpinned')
    for (let i: number = 0; i < unpinnedTabs.length; i++) {
        const tab: Element = unpinnedTabs[i]
        const tabTerminalId: string | null = tab.getAttribute('data-terminal-id')

        if (tabTerminalId === terminalId) {
            tab.classList.add('agent-tab-active')
        } else {
            tab.classList.remove('agent-tab-active')
        }
    }
}

/**
 * Calculate which shortcut key to show for reaching a tab from the active terminal.
 * Returns '⌘[' if the tab is to the left, '⌘]' if to the right, or null if it's the active tab.
 */
function getShortcutHintForTab(tabIndex: number, activeIndex: number, totalTabs: number): string | null {
    if (tabIndex === activeIndex || totalTabs <= 1) {
        return null // No hint for active tab or single tab
    }

    // Calculate shortest path direction (accounting for wrap-around)
    const leftDistance: number = (activeIndex - tabIndex + totalTabs) % totalTabs
    const rightDistance: number = (tabIndex - activeIndex + totalTabs) % totalTabs

    // If distances are equal, prefer right (])
    return leftDistance <= rightDistance ? '⌘[' : '⌘]'
}

/**
 * Create a pinned tab element (90px with title + status dot)
 */
function createPinnedTab(
    terminal: TerminalData,
    activeTerminalId: TerminalId | null,
    onSelect: (terminal: TerminalData) => void,
    index: number,
    activeIndex: number,
    totalTabs: number
): HTMLElement {
    const terminalId: TerminalId = getTerminalId(terminal)
    const fullTitle: string = terminal.title
    // Truncate to ~12 chars to leave room for status dot
    const displayTitle: string = fullTitle.length > 12 ? fullTitle.slice(0, 12) + '…' : fullTitle

    // Create wrapper container for tab + hint
    const wrapper: HTMLDivElement = document.createElement('div')
    wrapper.className = 'agent-tab-wrapper'
    wrapper.setAttribute('data-terminal-id', terminalId)

    const tab: HTMLButtonElement = document.createElement('button')
    tab.className = 'agent-tab'
    if (terminalId === activeTerminalId) {
        tab.classList.add('agent-tab-active')
    }
    tab.setAttribute('data-terminal-id', terminalId)
    tab.setAttribute('data-index', String(index))
    tab.style.width = `${TAB_WIDTH_PINNED}px`

    // Create status dot
    const statusDot: HTMLSpanElement = document.createElement('span')
    const isDone: boolean = state.terminalDone.get(terminalId) ?? false
    statusDot.className = isDone ? 'agent-tab-status-done' : 'agent-tab-status-running'
    tab.appendChild(statusDot)

    // Create text span for title
    const textSpan: HTMLSpanElement = document.createElement('span')
    textSpan.className = 'agent-tab-text'
    textSpan.textContent = displayTitle
    tab.appendChild(textSpan)

    // Add activity dots for each unacknowledged node produced
    const activityCount: number = state.terminalActivityCount.get(terminalId) ?? 0
    for (let i: number = 0; i < activityCount; i++) {
        const dot: HTMLSpanElement = document.createElement('span')
        dot.className = 'agent-tab-activity-dot'
        dot.style.left = `${4 + i * 12}px` // Offset each dot horizontally
        tab.appendChild(dot)
    }

    // Click handler - navigate to terminal and clear activity dots for this terminal
    tab.addEventListener('click', () => {
        onSelect(terminal)
    })

    // Double-click handler - unpin the tab
    tab.addEventListener('dblclick', (e: MouseEvent) => {
        e.stopPropagation()
        unpinTerminal(terminalId)
    })

    // Drag-and-drop for reordering
    tab.draggable = true

    // Prevent graph from capturing mousedown (which would start panning)
    tab.addEventListener('mousedown', (e: MouseEvent) => {
        e.stopPropagation()
    })

    tab.addEventListener('dragstart', (e: DragEvent) => {
        e.stopPropagation()
        tab.classList.add('agent-tab-dragging')
        e.dataTransfer?.setData('text/plain', String(index))
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move'
        }
        state.draggingFromIndex = index
        state.ghostElement = createGhostElement()
    })

    tab.addEventListener('dragend', (e: DragEvent) => {
        e.stopPropagation()
        tab.classList.remove('agent-tab-dragging')
        removeGhostElement()
        state.draggingFromIndex = null
    })

    tab.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move'
        }
        if (state.draggingFromIndex === index) {
            return
        }
        if (state.ghostElement && state.pinnedContainer) {
            const rect: DOMRect = wrapper.getBoundingClientRect()
            const midpoint: number = rect.left + rect.width / 2
            const isRightHalf: boolean = e.clientX > midpoint

            if (isRightHalf) {
                const nextSibling: Element | null = wrapper.nextElementSibling
                if (nextSibling && !nextSibling.classList.contains('agent-tab-ghost')) {
                    state.pinnedContainer.insertBefore(state.ghostElement, nextSibling)
                } else if (!nextSibling) {
                    state.pinnedContainer.appendChild(state.ghostElement)
                }
                state.ghostTargetIndex = index + 1
            } else {
                state.pinnedContainer.insertBefore(state.ghostElement, wrapper)
                state.ghostTargetIndex = index
            }
        }
    })

    tab.addEventListener('dragleave', (e: DragEvent) => {
        e.stopPropagation()
    })

    tab.addEventListener('drop', (e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        const fromIndex: number = parseInt(e.dataTransfer?.getData('text/plain') ?? '-1')
        const targetIndex: number | null = state.ghostTargetIndex
        removeGhostElement()
        state.draggingFromIndex = null

        if (fromIndex >= 0 && targetIndex !== null && fromIndex !== targetIndex) {
            const adjustedTarget: number = fromIndex < targetIndex ? targetIndex - 1 : targetIndex
            reorderTerminal(fromIndex, adjustedTarget)
        }
    })

    wrapper.appendChild(tab)

    // Create shortcut hint element
    const shortcutText: string | null = getShortcutHintForTab(index, activeIndex, totalTabs)
    if (shortcutText !== null) {
        const shortcutHint: HTMLSpanElement = document.createElement('span')
        shortcutHint.className = 'agent-tab-shortcut-hint'
        shortcutHint.textContent = shortcutText
        wrapper.appendChild(shortcutHint)
    }

    return wrapper
}

/**
 * Create an unpinned tab element (24px with status dot only)
 */
function createUnpinnedTab(
    terminal: TerminalData,
    onSelect: (terminal: TerminalData) => void
): HTMLElement {
    const terminalId: TerminalId = getTerminalId(terminal)

    const tab: HTMLButtonElement = document.createElement('button')
    tab.className = 'agent-tab-unpinned'
    tab.setAttribute('data-terminal-id', terminalId)
    tab.style.width = `${TAB_WIDTH_UNPINNED}px`
    tab.style.height = `${TAB_WIDTH_UNPINNED}px`
    tab.title = terminal.title // Show full title on hover

    // Create status dot (centered)
    const statusDot: HTMLSpanElement = document.createElement('span')
    const isDone: boolean = state.terminalDone.get(terminalId) ?? false
    statusDot.className = isDone ? 'agent-tab-status-done' : 'agent-tab-status-running'
    tab.appendChild(statusDot)

    // Click handler - re-pin and navigate to terminal
    tab.addEventListener('click', () => {
        pinTerminal(terminalId)
        onSelect(terminal)
    })

    // Prevent graph from capturing mousedown
    tab.addEventListener('mousedown', (e: MouseEvent) => {
        e.stopPropagation()
    })

    return tab
}

/**
 * Unpin a terminal (move from pinned to unpinned section)
 * Exported for use by terminal traffic light buttons
 */
export function unpinTerminal(terminalId: TerminalId): void {
    state.pinnedTerminals.delete(terminalId)

    // Re-render with cached data
    if (state.lastOnSelect) {
        renderAgentTabs(state.lastTerminals, state.activeTerminalId, state.lastOnSelect)
    }
}

/**
 * Pin a terminal (move from unpinned to pinned section)
 */
function pinTerminal(terminalId: TerminalId): void {
    state.pinnedTerminals.add(terminalId)

    // Re-render with cached data
    if (state.lastOnSelect) {
        renderAgentTabs(state.lastTerminals, state.activeTerminalId, state.lastOnSelect)
    }
}

/**
 * Update the status dot for a specific terminal
 */
function updateStatusDot(terminalId: TerminalId): void {
    const isDone: boolean = state.terminalDone.get(terminalId) ?? false

    // Check pinned container
    if (state.pinnedContainer) {
        const pinnedTab: HTMLElement | null = state.pinnedContainer.querySelector(`.agent-tab[data-terminal-id="${terminalId}"]`)
        if (pinnedTab) {
            const dot: HTMLElement | null = pinnedTab.querySelector('.agent-tab-status-running, .agent-tab-status-done')
            if (dot) {
                dot.className = isDone ? 'agent-tab-status-done' : 'agent-tab-status-running'
            }
        }
    }

    // Check unpinned container
    if (state.unpinnedContainer) {
        const unpinnedTab: HTMLElement | null = state.unpinnedContainer.querySelector(`.agent-tab-unpinned[data-terminal-id="${terminalId}"]`)
        if (unpinnedTab) {
            const dot: HTMLElement | null = unpinnedTab.querySelector('.agent-tab-status-running, .agent-tab-status-done')
            if (dot) {
                dot.className = isDone ? 'agent-tab-status-done' : 'agent-tab-status-running'
            }
        }
    }
}

/**
 * Clean up the tabs bar
 */
export function disposeAgentTabsBar(): void {
    removeGhostElement()

    // Clear inactivity check interval
    if (state.inactivityCheckInterval !== null) {
        clearInterval(state.inactivityCheckInterval)
        state.inactivityCheckInterval = null
    }

    // Remove terminal event listeners
    window.electronAPI?.removeAllListeners('terminal:exit')
    window.electronAPI?.removeAllListeners('terminal:data')

    if (state.container && state.container.parentNode) {
        state.container.parentNode.removeChild(state.container)
    }

    state.container = null
    state.pinnedContainer = null
    state.unpinnedContainer = null
    state.dividerElement = null
    state.activeTerminalId = null
    state.terminalDone.clear()
    state.pinnedTerminals.clear()
    state.displayOrder = []
    state.lastTerminals = []
    state.lastOnSelect = null
    state.draggingFromIndex = null
    state.ghostTargetIndex = null
    state.lastOutputTime.clear()
    state.terminalActivityCount.clear()
}

/**
 * Check if tabs bar is currently mounted
 */
export function isAgentTabsBarMounted(): boolean {
    return state.container !== null && state.container.parentNode !== null
}

/**
 * Suppress inactivity tracking for a brief period during zoom/resize.
 * Terminal resize triggers shell redraws which emit data, but this isn't real activity.
 * Called from zoom event handlers to prevent false "active" detection.
 */
export function suppressInactivityDuringZoom(): void {
    state.zoomSuppressionUntil = Date.now() + ZOOM_SUPPRESSION_MS
}

/**
 * Mark a terminal as having activity (produced a node).
 * Called from applyGraphDeltaToUI when a context node gets a new outgoing edge.
 *
 * @param contextNodeId - The node ID of the context node that produced a new edge
 */
export function markTerminalActivityForContextNode(contextNodeId: string): void {
    // Find terminal attached to this context node
    const terminals: Map<TerminalId, TerminalData> = getTerminals()
    for (const [terminalId, terminal] of terminals) {
        if (terminal.attachedToNodeId === contextNodeId) {
            const currentCount: number = state.terminalActivityCount.get(terminalId) ?? 0
            state.terminalActivityCount.set(terminalId, currentCount + 1)
            updateActivityDots(terminalId)
            console.log(`[AgentTabsBar] Marked activity for terminal ${terminalId}, count: ${currentCount + 1}`)
            return
        }
    }
}

/**
 * Update the activity dots for a specific terminal tab based on count
 */
function updateActivityDots(terminalId: TerminalId): void {
    if (!state.pinnedContainer) return

    // Find the tab button (not the wrapper) by querying for .agent-tab with the terminal ID
    const tab: HTMLElement | null = state.pinnedContainer.querySelector(`.agent-tab[data-terminal-id="${terminalId}"]`)
    if (!tab) return

    // Remove all existing dots
    const existingDots: NodeListOf<HTMLElement> = tab.querySelectorAll('.agent-tab-activity-dot')
    existingDots.forEach((dot: HTMLElement) => dot.remove())

    // Add new dots based on count
    const count: number = state.terminalActivityCount.get(terminalId) ?? 0
    for (let i: number = 0; i < count; i++) {
        const dot: HTMLSpanElement = document.createElement('span')
        dot.className = 'agent-tab-activity-dot'
        dot.style.left = `${4 + i * 12}px`
        tab.appendChild(dot)
    }
}

/**
 * Clear activity dots for a specific terminal.
 * Called when user clicks the tab OR when cycling to this terminal via hotkey.
 */
export function clearActivityForTerminal(terminalId: TerminalId): void {
    state.terminalActivityCount.set(terminalId, 0)
    updateActivityDots(terminalId)
}

/**
 * Check all tracked terminals for inactivity and update CSS classes
 */
function checkTerminalInactivity(): void {
    const now: number = Date.now()
    for (const [terminalId, lastTime] of state.lastOutputTime.entries()) {
        const elapsed: number = now - lastTime
        const isInactive: boolean = elapsed >= INACTIVITY_THRESHOLD_MS
        updateInactivityClass(terminalId, isInactive)
        setTerminalDone(terminalId, isInactive)
    }
}

/**
 * Update the inactive CSS class on a specific terminal tab
 */
function updateInactivityClass(terminalId: TerminalId, isInactive: boolean): void {
    if (!state.pinnedContainer) return

    // Find the tab button (not the wrapper) by querying for .agent-tab with the terminal ID
    const tab: HTMLElement | null = state.pinnedContainer.querySelector(`.agent-tab[data-terminal-id="${terminalId}"]`)
    if (!tab) return

    if (isInactive) {
        tab.classList.add('agent-tab-inactive')
    } else {
        tab.classList.remove('agent-tab-inactive')
    }
}

/**
 * Update the done indicator based on inactivity state.
 */
function setTerminalDone(terminalId: TerminalId, isDone: boolean): void {
    const previous: boolean = state.terminalDone.get(terminalId) ?? false
    if (previous === isDone) {
        return
    }
    state.terminalDone.set(terminalId, isDone)
    updateStatusDot(terminalId)
}
