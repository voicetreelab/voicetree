/**
 * AgentTabsBar - Renders open terminal/agent tabs in top-right of title bar
 *
 * Features:
 * - Fixed width tabs with truncated titles
 * - Positioned in macOS title bar area (right: 80px, mirroring RecentNodeTabsBar)
 * - Clicking a tab navigates to and focuses that terminal
 * - Highlights currently active terminal
 */

import type { TerminalData, TerminalId } from '@/shell/edge/UI-edge/floating-windows/types'
import { getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types'
import { getTerminals } from '@/shell/edge/UI-edge/state/TerminalStore'

const TAB_WIDTH: number = 90
const INACTIVITY_THRESHOLD_MS: number = 10000 // 10 seconds
const CHECK_INTERVAL_MS: number = 1000 // Check every second

interface AgentTabsBarState {
    container: HTMLElement | null
    tabsContainer: HTMLElement | null
    activeTerminalId: TerminalId | null
    // Track count of activity per terminal (each new node adds a dot, dots persist)
    terminalActivityCount: Map<TerminalId, number>
    // User-defined display order (for drag-and-drop reordering)
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
    // Inactivity tracking - last output time per terminal
    lastOutputTime: Map<TerminalId, number>
    // Interval for checking inactivity
    inactivityCheckInterval: ReturnType<typeof setInterval> | null
}

// Module state for the single instance
const state: AgentTabsBarState = {
    container: null,
    tabsContainer: null,
    activeTerminalId: null,
    terminalActivityCount: new Map(),
    displayOrder: [],
    lastTerminals: [],
    lastOnSelect: null,
    ghostElement: null,
    draggingFromIndex: null,
    ghostTargetIndex: null,
    lastOutputTime: new Map(),
    inactivityCheckInterval: null
}

/**
 * Sync displayOrder with actual terminals (handle add/remove)
 * Preserves existing order, removes stale IDs, appends new terminals at end
 */
function syncDisplayOrder(terminals: TerminalData[]): TerminalId[] {
    const terminalIds: Set<TerminalId> = new Set(terminals.map(t => getTerminalId(t)))

    // Remove stale IDs (terminals that no longer exist)
    const filtered: TerminalId[] = state.displayOrder.filter(id => terminalIds.has(id))

    // Append new terminals at end
    for (const t of terminals) {
        const id: TerminalId = getTerminalId(t)
        if (!filtered.includes(id)) {
            filtered.push(id)
        }
    }
    return filtered
}

/**
 * Reorder terminal after drag-drop and trigger re-render
 */
function reorderTerminal(fromIndex: number, toIndex: number): void {
    const [moved] = state.displayOrder.splice(fromIndex, 1)
    state.displayOrder.splice(toIndex, 0, moved)

    // Re-render with cached data
    if (state.lastOnSelect) {
        renderAgentTabs(state.lastTerminals, state.activeTerminalId, state.lastOnSelect)
    }
}

/**
 * Get the current display order (for GraphNavigationService cycling)
 */
export function getDisplayOrder(): TerminalId[] {
    return [...state.displayOrder]
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

    // Create scrollable tabs container
    state.tabsContainer = document.createElement('div')
    state.tabsContainer.className = 'agent-tabs-scroll'

    // Container-level drag handlers for dropping at the end of the list
    state.tabsContainer.addEventListener('dragover', (e: DragEvent) => {
        e.preventDefault()
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move'
        }
        // Only show ghost at end if mouse is past all tabs (in empty space)
        if (state.ghostElement && state.tabsContainer && state.draggingFromIndex !== null) {
            const tabs: HTMLCollectionOf<Element> = state.tabsContainer.getElementsByClassName('agent-tab')
            if (tabs.length > 0) {
                const lastTab: Element = tabs[tabs.length - 1]
                const lastTabRect: DOMRect = lastTab.getBoundingClientRect()
                // If mouse is past the right edge of the last tab, show ghost at end
                if (e.clientX > lastTabRect.right) {
                    state.tabsContainer.appendChild(state.ghostElement)
                    state.ghostTargetIndex = state.displayOrder.length
                }
            }
        }
    })

    state.tabsContainer.addEventListener('drop', (e: DragEvent) => {
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

    state.container.appendChild(state.tabsContainer)
    parentContainer.appendChild(state.container)

    // Initially hidden until we have terminals
    state.container.style.display = 'none'

    // Subscribe to terminal data events for inactivity tracking
    window.electronAPI.terminal.onData((terminalId: string, _data: string) => {
        const now: number = Date.now()
        state.lastOutputTime.set(terminalId as TerminalId, now)
        // Terminal became active - remove inactive class immediately
        updateInactivityClass(terminalId as TerminalId, false)
    })

    // Start interval to check for inactive terminals
    state.inactivityCheckInterval = setInterval(() => {
        checkTerminalInactivity()
    }, CHECK_INTERVAL_MS)

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
    if (!state.tabsContainer || !state.container) {
        console.warn('[AgentTabsBar] Not mounted, cannot render')
        return
    }

    state.activeTerminalId = activeTerminalId
    // Cache for re-render after drag-drop
    state.lastTerminals = terminals
    state.lastOnSelect = onSelect

    // Clear existing tabs
    state.tabsContainer.innerHTML = ''

    // Sync display order with actual terminals (preserves user ordering)
    state.displayOrder = syncDisplayOrder(terminals)

    // Map display order to terminal data
    const orderedTerminals: TerminalData[] = state.displayOrder
        .map(id => terminals.find(t => getTerminalId(t) === id))
        .filter((t): t is TerminalData => t !== undefined)

    // Create tab for each terminal
    for (let i = 0; i < orderedTerminals.length; i++) {
        const terminal: TerminalData = orderedTerminals[i]
        const tab: HTMLElement = createTab(terminal, activeTerminalId, onSelect, i)
        state.tabsContainer.appendChild(tab)
    }

    // Update visibility based on whether we have terminals
    state.container.style.display = terminals.length > 0 ? 'flex' : 'none'
}

/**
 * Update which terminal is highlighted as active
 */
export function setActiveTerminal(terminalId: TerminalId | null): void {
    state.activeTerminalId = terminalId

    if (!state.tabsContainer) return

    // Update active class on all tabs
    const tabs: HTMLCollectionOf<Element> = state.tabsContainer.getElementsByClassName('agent-tab')
    for (const tab of tabs) {
        const tabTerminalId: string | null = tab.getAttribute('data-terminal-id')
        if (tabTerminalId === terminalId) {
            tab.classList.add('agent-tab-active')
        } else {
            tab.classList.remove('agent-tab-active')
        }
    }
}

/**
 * Create a single tab element with drag-and-drop support
 */
function createTab(
    terminal: TerminalData,
    activeTerminalId: TerminalId | null,
    onSelect: (terminal: TerminalData) => void,
    index: number
): HTMLElement {
    const terminalId: TerminalId = getTerminalId(terminal)
    const fullTitle: string = terminal.title
    // Truncate to ~15 chars for 70px width at 9px font
    const displayTitle: string = fullTitle.length > 15 ? fullTitle.slice(0, 15) + '…' : fullTitle

    const tab: HTMLButtonElement = document.createElement('button')
    tab.className = 'agent-tab'
    if (terminalId === activeTerminalId) {
        tab.classList.add('agent-tab-active')
    }
    tab.setAttribute('data-terminal-id', terminalId)
    tab.setAttribute('data-index', String(index))
    tab.style.width = `${TAB_WIDTH}px`

    // Create text span for horizontal scrolling within tab
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
        clearActivityForTerminal(terminalId)
        onSelect(terminal)
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
        // Set effectAllowed to 'move' to prevent browser showing copy icon (green +)
        if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move'
        }
        // Track source index and create ghost element for drop preview
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
        // Set dropEffect to match effectAllowed
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move'
        }
        // Skip ghost insertion when hovering over the source tab
        if (state.draggingFromIndex === index) {
            return
        }
        // Detect which half of tab mouse is over and position ghost accordingly
        if (state.ghostElement && state.tabsContainer) {
            const rect: DOMRect = tab.getBoundingClientRect()
            const midpoint: number = rect.left + rect.width / 2
            const isRightHalf: boolean = e.clientX > midpoint

            if (isRightHalf) {
                // Insert ghost AFTER this tab
                const nextSibling: Element | null = tab.nextElementSibling
                if (nextSibling && !nextSibling.classList.contains('agent-tab-ghost')) {
                    state.tabsContainer.insertBefore(state.ghostElement, nextSibling)
                } else if (!nextSibling) {
                    state.tabsContainer.appendChild(state.ghostElement)
                }
                state.ghostTargetIndex = index + 1
            } else {
                // Insert ghost BEFORE this tab (left half)
                state.tabsContainer.insertBefore(state.ghostElement, tab)
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
            // Calculate the actual insertion index after removal
            // If dragging from before the target, the target shifts down by 1 after removal
            const adjustedTarget: number = fromIndex < targetIndex ? targetIndex - 1 : targetIndex
            reorderTerminal(fromIndex, adjustedTarget)
        }
    })

    // Native tooltip for keyboard shortcut hint (appears after ~500ms delay)
    tab.title = '⌘[ or ⌘] to cycle • Drag to reorder'

    return tab
}

/**
 * Clean up the tabs bar
 */
export function disposeAgentTabsBar(): void {
    removeGhostElement()

    // Clean up inactivity check interval
    if (state.inactivityCheckInterval !== null) {
        clearInterval(state.inactivityCheckInterval)
        state.inactivityCheckInterval = null
    }

    // Remove terminal:data event listener
    window.electronAPI.removeAllListeners('terminal:data')

    if (state.container && state.container.parentNode) {
        state.container.parentNode.removeChild(state.container)
    }

    state.container = null
    state.tabsContainer = null
    state.activeTerminalId = null
    state.terminalActivityCount.clear()
    state.displayOrder = []
    state.lastTerminals = []
    state.lastOnSelect = null
    state.draggingFromIndex = null
    state.ghostTargetIndex = null
    state.lastOutputTime.clear()
}

/**
 * Check if tabs bar is currently mounted
 */
export function isAgentTabsBarMounted(): boolean {
    return state.container !== null && state.container.parentNode !== null
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
    if (!state.tabsContainer) return

    const tab: HTMLElement | null = state.tabsContainer.querySelector(`[data-terminal-id="${terminalId}"]`)
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
    }
}

/**
 * Update the inactive CSS class on a specific terminal tab
 */
function updateInactivityClass(terminalId: TerminalId, isInactive: boolean): void {
    if (!state.tabsContainer) return

    const tab: HTMLElement | null = state.tabsContainer.querySelector(`[data-terminal-id="${terminalId}"]`)
    if (!tab) return

    if (isInactive) {
        tab.classList.add('agent-tab-inactive')
    } else {
        tab.classList.remove('agent-tab-inactive')
    }
}
