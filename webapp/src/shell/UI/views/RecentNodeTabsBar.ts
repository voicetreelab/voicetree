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
 * - TWO sections: pinned editors (left) and recent nodes (right)
 */

import type { RecentNodeHistory } from '@/pure/graph/recentNodeHistoryV2'
import type { UpsertNodeDelta } from '@/pure/graph'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'
import { getPinnedEditors } from '@/shell/edge/UI-edge/state/EditorStore'
import { Pin, createElement } from 'lucide'
import { formatShortcut } from '@/pure/utils/keyboardShortcutDisplay'

const TAB_WIDTH: number = 90

interface RecentNodeTabsBarV2State {
    container: HTMLElement | null
    pinnedSection: HTMLElement | null
    tabsContainer: HTMLElement | null
}

// Module state for the single instance
const state: RecentNodeTabsBarV2State = {
    container: null,
    pinnedSection: null,
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

    // Create pinned section (left side)
    state.pinnedSection = document.createElement('div')
    state.pinnedSection.className = 'recent-tabs-pinned-section'
    state.pinnedSection.setAttribute('data-testid', 'pinned-tabs-section')

    // Create scrollable tabs container for recent nodes (right side)
    state.tabsContainer = document.createElement('div')
    state.tabsContainer.className = 'recent-tabs-scroll'

    state.container.appendChild(state.pinnedSection)
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
 * @param getNodeLabel - Optional callback to get node label by nodeId (for pinned editors)
 */
export function renderRecentNodeTabsV2(
    history: RecentNodeHistory,
    onNavigate: (nodeId: string) => void,
    getNodeLabel?: (nodeId: string) => string | undefined
): void {
    if (!state.tabsContainer || !state.container || !state.pinnedSection) {
        console.warn('[RecentNodeTabsBarV2] Not mounted, cannot render')
        return
    }

    // Clear existing tabs in both sections
    state.pinnedSection.innerHTML = ''
    state.tabsContainer.innerHTML = ''

    // Get pinned editors
    const pinnedEditors: ReadonlySet<string> = getPinnedEditors()

    // Render pinned tabs (left section)
    for (const nodeId of pinnedEditors) {
        const label: string = getNodeLabel?.(nodeId) ?? nodeId.split('/').pop() ?? nodeId
        const tab: HTMLElement = createPinnedTab(nodeId, label, onNavigate)
        state.pinnedSection.appendChild(tab)
    }

    // Create tab for each recent node (right section)
    for (let index: number = 0; index < history.length; index++) {
        const entry: UpsertNodeDelta = history[index]
        const tab: HTMLElement = createTab(entry, onNavigate, index)
        state.tabsContainer.appendChild(tab)
    }

    // Update visibility based on whether we have any entries (pinned or recent)
    const hasContent: boolean = pinnedEditors.size > 0 || history.length > 0
    state.container.style.display = hasContent ? 'flex' : 'none'
}

/**
 * Create a single tab element
 */
function createTab(
    entry: UpsertNodeDelta,
    onNavigate: (nodeId: string) => void,
    index: number
): HTMLElement {
    const nodeId: string = entry.nodeToUpsert.absoluteFilePathIsID
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
    shortcutHint.innerHTML = formatShortcut(shortcutNumber.toString())

    wrapper.appendChild(tab)
    wrapper.appendChild(shortcutHint)

    // Click handler - navigate to node
    tab.addEventListener('click', () => {
        onNavigate(nodeId)
    })

    return wrapper
}

/**
 * Create a pinned tab element with pin icon
 */
function createPinnedTab(
    nodeId: string,
    label: string,
    onNavigate: (nodeId: string) => void
): HTMLElement {
    // Create wrapper container for tab + hint
    const wrapper: HTMLDivElement = document.createElement('div')
    wrapper.className = 'recent-tab-wrapper'

    const tab: HTMLButtonElement = document.createElement('button')
    tab.className = 'recent-tab'
    tab.setAttribute('data-node-id', nodeId)
    tab.setAttribute('data-pinned', 'true')
    tab.title = label // Full title on hover
    tab.style.width = `${TAB_WIDTH}px`

    // Create pin icon
    const pinIcon: SVGSVGElement = createElement(Pin) as unknown as SVGSVGElement
    pinIcon.classList.add('pinned-tab-icon')

    // Create text span for horizontal scrolling within tab
    const textSpan: HTMLSpanElement = document.createElement('span')
    textSpan.className = 'recent-tab-text'
    textSpan.textContent = label

    tab.appendChild(pinIcon)
    tab.appendChild(textSpan)

    // Create shortcut hint element (shown on hover) - pinned tabs don't have shortcuts for now
    // We could add Cmd+Shift+1-5 in the future if needed
    const shortcutHint: HTMLSpanElement = document.createElement('span')
    shortcutHint.className = 'recent-tab-shortcut-hint'
    shortcutHint.innerHTML = `pinned`

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
    state.pinnedSection = null
    state.tabsContainer = null
}

/**
 * Check if tabs bar is currently mounted
 */
export function isTabsBarV2Mounted(): boolean {
    return state.container !== null && state.container.parentNode !== null
}
