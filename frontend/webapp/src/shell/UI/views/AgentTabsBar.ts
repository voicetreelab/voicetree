/**
 * AgentTabsBar - Renders open terminal/agent tabs in top-right of title bar
 *
 * Features:
 * - Fixed width tabs with horizontally scrollable text
 * - Positioned in macOS title bar area (right: 80px, mirroring RecentNodeTabsBar)
 * - Clicking a tab navigates to and focuses that terminal
 * - Tooltip on hover shows "⌘[ / ⌘] to cycle"
 * - Highlights currently active terminal
 */

import type { TerminalData, TerminalId } from '@/shell/edge/UI-edge/floating-windows/types'
import { getTerminalId } from '@/shell/edge/UI-edge/floating-windows/types'
import { getTerminals } from '@/shell/edge/UI-edge/state/TerminalStore'

const TAB_WIDTH: number = 90

interface AgentTabsBarState {
    container: HTMLElement | null
    tabsContainer: HTMLElement | null
    tooltip: HTMLElement | null
    activeTerminalId: TerminalId | null
    // Track count of activity per terminal (each new node adds a dot, dots persist)
    terminalActivityCount: Map<TerminalId, number>
}

// Module state for the single instance
const state: AgentTabsBarState = {
    container: null,
    tabsContainer: null,
    tooltip: null,
    activeTerminalId: null,
    terminalActivityCount: new Map()
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

    // Create shared tooltip element
    state.tooltip = document.createElement('div')
    state.tooltip.className = 'agent-tab-tooltip'
    state.tooltip.textContent = '⌘[ or ⌘] to cycle'
    state.tooltip.style.display = 'none'

    state.container.appendChild(state.tabsContainer)
    state.container.appendChild(state.tooltip)
    parentContainer.appendChild(state.container)

    // Initially hidden until we have terminals
    state.container.style.display = 'none'

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

    // Clear existing tabs
    state.tabsContainer.innerHTML = ''

    // Sort terminals by ID for consistent ordering (same as GraphNavigationService)
    const sortedTerminals: TerminalData[] = [...terminals].sort((a, b) =>
        getTerminalId(a).localeCompare(getTerminalId(b))
    )

    // Create tab for each terminal
    for (const terminal of sortedTerminals) {
        const tab: HTMLElement = createTab(terminal, activeTerminalId, onSelect)
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
 * Create a single tab element
 */
function createTab(
    terminal: TerminalData,
    activeTerminalId: TerminalId | null,
    onSelect: (terminal: TerminalData) => void
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
    tab.title = fullTitle // Full title on hover (native tooltip)
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
        dot.style.left = `${4 + i * 8}px` // Offset each dot horizontally (scaled for smaller tabs)
        tab.appendChild(dot)
    }

    // Click handler - navigate to terminal (dots persist, not cleared on click)
    tab.addEventListener('click', () => {
        onSelect(terminal)
    })

    // Hover handlers for tooltip
    tab.addEventListener('mouseenter', (e: MouseEvent) => {
        showTooltip(e.currentTarget as HTMLElement)
    })

    tab.addEventListener('mouseleave', () => {
        hideTooltip()
    })

    return tab
}

/**
 * Show tooltip near the hovered tab
 */
function showTooltip(tabElement: HTMLElement): void {
    if (!state.tooltip || !state.container) return

    const tabRect: DOMRect = tabElement.getBoundingClientRect()
    const containerRect: DOMRect = state.container.getBoundingClientRect()

    // Position tooltip below the tab
    state.tooltip.style.display = 'block'
    state.tooltip.style.left = `${tabRect.left - containerRect.left + tabRect.width / 2}px`
    state.tooltip.style.top = `${tabRect.height + 4}px`
    state.tooltip.style.transform = 'translateX(-50%)'
}

/**
 * Hide the tooltip
 */
function hideTooltip(): void {
    if (!state.tooltip) return
    state.tooltip.style.display = 'none'
}

/**
 * Clean up the tabs bar
 */
export function disposeAgentTabsBar(): void {
    if (state.container && state.container.parentNode) {
        state.container.parentNode.removeChild(state.container)
    }

    state.container = null
    state.tabsContainer = null
    state.tooltip = null
    state.activeTerminalId = null
    state.terminalActivityCount.clear()
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
        dot.style.left = `${8 + i * 14}px`
        tab.appendChild(dot)
    }
}
