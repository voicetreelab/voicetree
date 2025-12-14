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

import type { RecentNodeHistory } from '@/pure/graph/recentNodeHistoryV2'
import type { UpsertNodeDelta } from '@/pure/graph'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'

const TAB_WIDTH: number = 90

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
export function createRecentNodeTabsBar(parentContainer: HTMLElement): () => void {
    // Clean up any existing instance
    disposeRecentNodeTabsBar()

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

    return disposeRecentNodeTabsBar
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
    for (let index = 0; index < history.length; index++) {
        const entry = history[index]
        const tab: HTMLElement = createTab(entry, onNavigate, index)
        state.tabsContainer.appendChild(tab)
    }

    // Update visibility based on whether we have entries
    state.container.style.display = history.length > 0 ? 'flex' : 'none'
}

/**
 * Create a single tab element
 */
function createTab(
    entry: UpsertNodeDelta,
    onNavigate: (nodeId: string) => void,
    index: number
): HTMLElement {
    const nodeId: string = entry.nodeToUpsert.relativeFilePathIsID
    const label: string = getNodeTitle(entry.nodeToUpsert)
    const shortcutNumber: number = index + 1

    // Create wrapper container for tab + hint
    const wrapper: HTMLDivElement = document.createElement('div')
    wrapper.className = 'recent-tab-wrapper'

    const tab: HTMLButtonElement = document.createElement('button')
    tab.className = 'recent-tab'
    tab.setAttribute('data-node-id', nodeId)
    tab.title = label // Full title on hover
    tab.style.width = `${TAB_WIDTH}px`

    // Create text span for horizontal scrolling within tab
    const textSpan: HTMLSpanElement = document.createElement('span')
    textSpan.className = 'recent-tab-text'
    textSpan.textContent = label

    tab.appendChild(textSpan)

    // Create shortcut hint element (shown on hover)
    const shortcutHint: HTMLSpanElement = document.createElement('span')
    shortcutHint.className = 'recent-tab-shortcut-hint'
    shortcutHint.innerHTML = `⌘${shortcutNumber}`

    wrapper.appendChild(tab)
    wrapper.appendChild(shortcutHint)

    // Click handler - navigate to node
    tab.addEventListener('click', () => {
        onNavigate(nodeId)
    })

    return wrapper
}

/**
 * Clean up the tabs bar
 */
export function disposeRecentNodeTabsBar(): void {
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
