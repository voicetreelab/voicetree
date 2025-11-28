/**
 * RecentNodeTabsBarV2 - Renders up to 5 recently added/modified nodes as clickable tabs
 *
 * Unlike V1, this version:
 * - Shows recently ADDED/MODIFIED nodes (from GraphDelta), not visited nodes
 * - Has no internal state - receives data and renders
 * - No localStorage persistence
 *
 * Features:
 * - Fixed width tabs with horizontally scrollable text
 * - Positioned in macOS title bar area (left: 80px for window controls)
 * - Clicking a tab navigates to that node
 */

import type { RecentNodeHistory, RecentNodeEntry } from '@/pure/graph/recentNodeHistoryV2'

const TAB_WIDTH = 120

interface RecentNodeTabsBarV2State {
    container: HTMLElement | null
    tabsContainer: HTMLElement | null
}

// Module state for the single instance
const state: RecentNodeTabsBarV2State = {
    container: null,
    tabsContainer: null
}

/**
 * Create and mount the tabs bar into a parent container
 *
 * @param parentContainer - The container to mount the tabs bar into
 * @returns cleanup function to dispose the tabs bar
 */
export function createRecentNodeTabsBarV2(parentContainer: HTMLElement): () => void {
    // Clean up any existing instance
    disposeRecentNodeTabsBarV2()

    // Create main container (positioned in title bar area)
    state.container = document.createElement('div')
    state.container.className = 'recent-tabs-bar'
    state.container.setAttribute('data-testid', 'recent-tabs-bar-v2')

    // Create scrollable tabs container
    state.tabsContainer = document.createElement('div')
    state.tabsContainer.className = 'recent-tabs-scroll'

    state.container.appendChild(state.tabsContainer)
    parentContainer.appendChild(state.container)

    // Initially hidden until we have data
    state.container.style.display = 'none'

    return disposeRecentNodeTabsBarV2
}

/**
 * Render tabs from the recent node history
 *
 * This is a pure render function - it receives the current state and a callback,
 * and updates the DOM accordingly.
 *
 * @param history - The current recent node history
 * @param onNavigate - Callback when a tab is clicked
 */
export function renderRecentNodeTabsV2(
    history: RecentNodeHistory,
    onNavigate: (nodeId: string) => void
): void {
    if (!state.tabsContainer || !state.container) {
        console.warn('[RecentNodeTabsBarV2] Not mounted, cannot render')
        return
    }

    // Clear existing tabs
    state.tabsContainer.innerHTML = ''

    // Create tab for each recent node
    for (const entry of history) {
        const tab = createTab(entry, onNavigate)
        state.tabsContainer.appendChild(tab)
    }

    // Update visibility based on whether we have entries
    state.container.style.display = history.length > 0 ? 'flex' : 'none'
}

/**
 * Create a single tab element
 */
function createTab(
    entry: RecentNodeEntry,
    onNavigate: (nodeId: string) => void
): HTMLElement {
    const tab = document.createElement('button')
    tab.className = 'recent-tab'
    tab.setAttribute('data-node-id', entry.nodeId)
    tab.title = entry.label // Full title on hover
    tab.style.width = `${TAB_WIDTH}px`

    // Create text span for horizontal scrolling within tab
    const textSpan = document.createElement('span')
    textSpan.className = 'recent-tab-text'
    textSpan.textContent = entry.label

    tab.appendChild(textSpan)

    // Click handler - navigate to node
    tab.addEventListener('click', () => {
        onNavigate(entry.nodeId)
    })

    return tab
}

/**
 * Clean up the tabs bar
 */
export function disposeRecentNodeTabsBarV2(): void {
    if (state.container && state.container.parentNode) {
        state.container.parentNode.removeChild(state.container)
    }

    state.container = null
    state.tabsContainer = null
}

/**
 * Check if tabs bar is currently mounted
 */
export function isTabsBarV2Mounted(): boolean {
    return state.container !== null && state.container.parentNode !== null
}
